use crate::{
    model::{Group, Network},
    platform::command,
};
use std::{collections::BTreeSet, path::PathBuf, sync::Arc};

pub trait Backend: Send + Sync {
    /// Return existing candidate rules, plus orphaned ADBShare rules owned by this EXE.
    fn existing(&self, candidates: &BTreeSet<String>) -> Result<BTreeSet<String>, String>;
    fn apply(&self, group: &Group) -> Result<(), String>;
    fn remove(&self, ids: &BTreeSet<String>) -> Result<(), String>;
}

pub struct Firewall {
    pub ledger: PathBuf,
    pub backend: Arc<dyn Backend>,
}
impl Firewall {
    fn pending(&self) -> Result<BTreeSet<String>, String> {
        if !self.ledger.exists() {
            return Ok(BTreeSet::new());
        }
        let ids: BTreeSet<String> =
            serde_json::from_slice(&std::fs::read(&self.ledger).map_err(|e| e.to_string())?)
                .map_err(|e| format!("防火墙清理记录无法读取：{e}"))?;
        validate_ids(&ids)?;
        Ok(ids)
    }
    fn persist(&self, ids: &BTreeSet<String>) -> Result<(), String> {
        if ids.is_empty() && !self.ledger.exists() {
            return Ok(());
        }
        let dir = self.ledger.parent().ok_or("无效清理记录路径")?;
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let mut file = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
        use std::io::Write;
        file.write_all(&serde_json::to_vec_pretty(ids).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.as_file().sync_all().map_err(|e| e.to_string())?;
        file.persist(&self.ledger).map_err(|e| e.to_string())?;
        Ok(())
    }
    fn reconcile(
        &self,
        candidates: &BTreeSet<String>,
    ) -> Result<(BTreeSet<String>, BTreeSet<String>), String> {
        let mut pending = self.pending()?;
        let candidates = candidates.union(&pending).cloned().collect();
        let existing = self.backend.existing(&candidates)?;
        validate_ids(&existing)?;
        pending.extend(existing.iter().cloned());
        self.persist(&pending)?;
        Ok((pending, existing))
    }
    pub fn apply(&self, group: &Group) -> Result<(), String> {
        validate_ids(&BTreeSet::from([group.id.clone()]))?;
        let mut pending = self.pending()?;
        pending.insert(group.id.clone());
        // Write before mutation so interrupted/failed elevation remains recoverable.
        self.persist(&pending)?;
        self.backend.apply(group)
    }
    pub fn remove_group(&self, id: &str) -> Result<(), String> {
        let targets = BTreeSet::from([id.to_owned()]);
        validate_ids(&targets)?;
        let (mut pending, existing) = self.reconcile(&targets)?;
        if existing.contains(id) {
            self.remove_verified(&targets)?;
        }
        pending.remove(id);
        self.persist(&pending)
    }
    pub fn cleanup(&self, groups: &[Group]) -> Result<(), String> {
        let candidates = groups.iter().map(|g| g.id.clone()).collect();
        let (_, existing) = self.reconcile(&candidates)?;
        // One UAC request handles all rules; no elevation if no matching rules exist.
        if !existing.is_empty() {
            self.remove_verified(&existing)?;
        }
        self.persist(&BTreeSet::new())
    }
    fn remove_verified(&self, ids: &BTreeSet<String>) -> Result<(), String> {
        self.backend.remove(ids)?;
        let remaining = self.backend.existing(ids)?;
        if !remaining.is_disjoint(ids) {
            return Err("防火墙仍存在待清理规则，请重试".into());
        }
        Ok(())
    }
}
fn validate_ids(ids: &BTreeSet<String>) -> Result<(), String> {
    for id in ids {
        uuid::Uuid::parse_str(id).map_err(|_| "无效防火墙规则标识")?;
    }
    Ok(())
}
fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}
fn powershell(script: &str) -> Result<String, String> {
    let script = format!("$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); {script}");
    let output = command("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "防火墙操作失败：{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .trim()
        .trim_start_matches('\u{feff}')
        .to_owned())
}
pub struct Windows;
impl Backend for Windows {
    fn existing(&self, candidates: &BTreeSet<String>) -> Result<BTreeSet<String>, String> {
        if !cfg!(windows) {
            return Ok(BTreeSet::new());
        }
        validate_ids(candidates)?;
        let names = candidates
            .iter()
            .map(|id| quote(&format!("ADBShare-{id}")))
            .collect::<Vec<_>>()
            .join(",");
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let script = format!("$names=@({names}); $exe={}; $rules=(New-Object -ComObject HNetCfg.FwPolicy2).Rules; $ids=@($rules | Where-Object {{ $_.Name -match '^ADBShare-[0-9a-fA-F]{{8}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{12}}$' -and ($names -contains $_.Name -or $_.ApplicationName -eq $exe) }} | ForEach-Object {{ $_.Name.Substring(9) }}); ConvertTo-Json -InputObject $ids -Compress",quote(&exe.to_string_lossy()));
        let ids: BTreeSet<String> = serde_json::from_str(&powershell(&script)?)
            .map_err(|e| format!("防火墙查询结果无效：{e}"))?;
        validate_ids(&ids)?;
        Ok(ids)
    }
    fn apply(&self, group: &Group) -> Result<(), String> {
        elevate(&format!(
            "--firewall-helper add {} {} {} {}",
            group.id,
            group.address,
            group.port,
            group.sources.join(",")
        ))
    }
    fn remove(&self, ids: &BTreeSet<String>) -> Result<(), String> {
        validate_ids(ids)?;
        elevate(&format!(
            "--firewall-helper remove {}",
            ids.iter().cloned().collect::<Vec<_>>().join(",")
        ))
    }
}
fn elevate(args: &str) -> Result<(), String> {
    if !cfg!(windows) {
        return Err("此原型仅实现 Windows 防火墙配置".into());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    powershell(&format!("$p=Start-Process -FilePath {} -ArgumentList {} -Verb RunAs -WindowStyle Hidden -Wait -PassThru; if ($p.ExitCode -ne 0) {{ throw '防火墙辅助进程未完成操作，请重试。' }}",quote(&exe.to_string_lossy()),quote(args)))?;
    Ok(())
}

/// Elevated helper: exact validated UUIDs only. COM Remove is idempotent for a
/// missing rule but propagates permission and policy errors (unlike ignored netsh exits).
pub fn helper(args: &[String]) -> Result<(), String> {
    if args.get(1).is_some_and(|s| s == "remove") && args.len() == 3 {
        let ids: BTreeSet<String> = args[2].split(',').map(str::to_owned).collect();
        validate_ids(&ids)?;
        let removals = ids
            .iter()
            .map(|id| format!("$rules.Remove({});", quote(&format!("ADBShare-{id}"))))
            .collect::<String>();
        powershell(&format!(
            "$rules=(New-Object -ComObject HNetCfg.FwPolicy2).Rules; {removals}"
        ))?;
        return Ok(());
    }
    if args.len() != 6 || args[1] != "add" {
        return Err("Invalid firewall arguments".into());
    }
    validate_ids(&BTreeSet::from([args[2].clone()]))?;
    let address: std::net::Ipv4Addr = args[3].parse().map_err(|_| "Invalid IPv4")?;
    let port: u16 = args[4].parse().map_err(|_| "Invalid port")?;
    if port == 0 || address.is_unspecified() {
        return Err("Invalid endpoint".into());
    }
    for source in args[5].split(',') {
        Network::parse(source)?;
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let name = quote(&format!("ADBShare-{}", args[2]));
    powershell(&format!("$rules=(New-Object -ComObject HNetCfg.FwPolicy2).Rules; $rules.Remove({name}); $rule=New-Object -ComObject HNetCfg.FWRule; $rule.Name={name}; $rule.Description='Managed by ADBShare'; $rule.ApplicationName={}; $rule.Protocol=6; $rule.LocalPorts='{port}'; $rule.LocalAddresses='{address}'; $rule.RemoteAddresses={}; $rule.Direction=1; $rule.Action=1; $rule.Profiles=3; $rule.InterfaceTypes='LAN,Wireless'; $rule.Enabled=$true; $rules.Add($rule);",quote(&exe.to_string_lossy()),quote(&args[5])))?;
    Ok(())
}
