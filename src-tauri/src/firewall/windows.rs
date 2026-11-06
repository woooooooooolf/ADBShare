use super::{validate_ids, Backend};
use crate::{
    model::{Group, Network},
    platform::command,
};
use std::collections::BTreeSet;

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
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    powershell(&format!("$p=Start-Process -FilePath {} -ArgumentList {} -Verb RunAs -WindowStyle Hidden -Wait -PassThru; if ($p.ExitCode -ne 0) {{ throw '防火墙辅助进程未完成操作，请重试。' }}",quote(&exe.to_string_lossy()),quote(args)))?;
    Ok(())
}

fn remote_addresses(sources: &str) -> Result<String, String> {
    let mut all = false;
    for source in sources.split(',') {
        all |= Network::parse(source)?.is_all();
    }
    // Windows Firewall rejects /0 in its address list. The local rule address
    // and gateway listener are IPv4, so "*" expresses the same source range.
    Ok(if all { "*".into() } else { sources.into() })
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
    let sources = remote_addresses(&args[5])?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let name = quote(&format!("ADBShare-{}", args[2]));
    powershell(&format!("$rules=(New-Object -ComObject HNetCfg.FwPolicy2).Rules; $rules.Remove({name}); $rule=New-Object -ComObject HNetCfg.FWRule; $rule.Name={name}; $rule.Description='Managed by ADBShare'; $rule.ApplicationName={}; $rule.Protocol=6; $rule.LocalPorts='{port}'; $rule.LocalAddresses='{address}'; $rule.RemoteAddresses={}; $rule.Direction=1; $rule.Action=1; $rule.Profiles=3; $rule.InterfaceTypes='LAN,Wireless'; $rule.Enabled=$true; $rules.Add($rule);",quote(&exe.to_string_lossy()),quote(&sources)))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::remote_addresses;

    #[test]
    fn public_sources_and_all_ipv4_are_validated_before_firewall_translation() {
        let sources = "203.0.113.10/32,198.51.100.0/24";
        assert_eq!(remote_addresses(sources).unwrap(), sources);
        assert_eq!(remote_addresses("0.0.0.0/0").unwrap(), "*");
        assert_eq!(remote_addresses("203.0.113.10/0,10.0.0.1").unwrap(), "*");
        assert!(remote_addresses("0.0.0.0/0,invalid").is_err());
        assert!(remote_addresses("*").is_err());
    }
}
