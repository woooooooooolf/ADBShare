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
        let script = format!("$names=@({names}); $exe={}; $rules=(New-Object -ComObject HNetCfg.FwPolicy2).Rules; $ids=@($rules | Where-Object {{ $_.Name -match '^ADBShare-[0-9a-fA-F]{{8}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{12}}(?:-v[46])?$' -and ($names -contains $_.Name.Substring(0,45) -or $_.ApplicationName -eq $exe) }} | ForEach-Object {{ $_.Name.Substring(9,36) }}); ConvertTo-Json -InputObject $ids -Compress",quote(&exe.to_string_lossy()));
        let ids: BTreeSet<String> = serde_json::from_str(&powershell(&script)?)
            .map_err(|e| format!("防火墙查询结果无效：{e}"))?;
        validate_ids(&ids)?;
        Ok(ids)
    }
    fn apply(&self, group: &Group) -> Result<(), String> {
        elevate(&format!(
            "--firewall-helper add {} {} {} {}",
            group.id,
            group
                .addresses()
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join(","),
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

fn remote_addresses(sources: &str, v6: bool) -> Result<Option<String>, String> {
    let ranges = sources
        .split(',')
        .map(Network::parse)
        .collect::<Result<Vec<_>, _>>()?;
    let ranges: Vec<_> = ranges
        .into_iter()
        .filter(|n| n.is_ipv6() == v6)
        // Windows rejects IPv6 loopback/unspecified-only ranges. They cannot
        // admit an off-host TCP peer, and loopback is handled in the gateway.
        .filter(|n| !matches!(n.canonical().as_str(), "::1/128" | "::/128" | "::/127"))
        .collect();
    if ranges.is_empty() {
        return Ok(None);
    }
    // A wildcard is safe only because each rule is constrained to one concrete
    // local address of the same family. Never combine both local families.
    if ranges.iter().any(Network::is_all) {
        return Ok(Some(if v6 { "::/0" } else { "*" }.into()));
    }
    Ok(Some(
        ranges
            .iter()
            .map(Network::canonical)
            .collect::<Vec<_>>()
            .join(","),
    ))
}

fn removals(id: &str) -> String {
    ["", "-v4", "-v6"]
        .iter()
        .map(|suffix| {
            format!(
                "$rules.Remove({});",
                quote(&format!("ADBShare-{id}{suffix}"))
            )
        })
        .collect()
}

/// Elevated helper: exact validated UUIDs only. COM Remove is idempotent for a
/// missing rule but propagates permission and policy errors (unlike ignored netsh exits).
pub fn helper(args: &[String]) -> Result<(), String> {
    if args.get(1).is_some_and(|s| s == "remove") && args.len() == 3 {
        let ids: BTreeSet<String> = args[2].split(',').map(str::to_owned).collect();
        validate_ids(&ids)?;
        let removals = ids.iter().map(|id| removals(id)).collect::<String>();
        powershell(&format!(
            "$rules=(New-Object -ComObject HNetCfg.FwPolicy2).Rules; {removals}"
        ))?;
        return Ok(());
    }
    if args.len() != 6 || args[1] != "add" {
        return Err("Invalid firewall arguments".into());
    }
    validate_ids(&BTreeSet::from([args[2].clone()]))?;
    let addresses = args[3]
        .split(',')
        .map(str::parse::<std::net::IpAddr>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Invalid IP")?;
    let port: u16 = args[4].parse().map_err(|_| "Invalid port")?;
    if port == 0
        || addresses.is_empty()
        || addresses.len() > 2
        || addresses.iter().any(|ip| {
            ip.is_unspecified()
                || ip.is_multicast()
                || matches!(ip, std::net::IpAddr::V6(v) if v.to_ipv4_mapped().is_some())
        })
        || (addresses.len() == 2 && addresses[0].is_ipv6() == addresses[1].is_ipv6())
    {
        return Err("Invalid endpoint".into());
    }
    // Validate and construct every rule before removing existing ones.
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut script =
        String::from("$rules=(New-Object -ComObject HNetCfg.FwPolicy2).Rules; $newRules=@(); ");
    for address in addresses {
        let sources = remote_addresses(&args[5], address.is_ipv6())?;
        if !args[5]
            .split(',')
            .any(|source| Network::parse(source).is_ok_and(|n| n.is_ipv6() == address.is_ipv6()))
        {
            return Err("Missing sources for listener family".into());
        }
        let Some(sources) = sources else {
            continue;
        };
        if address.is_loopback() {
            continue;
        }
        let suffix = if address.is_ipv6() { "-v6" } else { "-v4" };
        let name = quote(&format!("ADBShare-{}{suffix}", args[2]));
        script.push_str(&format!("$rule=New-Object -ComObject HNetCfg.FWRule; $rule.Name={name}; $rule.Description='Managed by ADBShare'; $rule.ApplicationName={}; $rule.Protocol=6; $rule.LocalPorts='{port}'; $rule.LocalAddresses='{address}'; $rule.RemoteAddresses={}; $rule.Direction=1; $rule.Action=1; $rule.Profiles=3; $rule.InterfaceTypes='LAN,Wireless'; $rule.Enabled=$true; $newRules+=,$rule; ", quote(&exe.to_string_lossy()), quote(&sources)));
    }
    script.push_str(&removals(&args[2]));
    script.push_str("try { foreach ($rule in $newRules) { $rules.Add($rule) } } catch { ");
    script.push_str(&removals(&args[2]));
    script.push_str("throw }; ");
    powershell(&script)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::remote_addresses;

    #[test]
    fn sources_stay_within_each_rule_family() {
        assert_eq!(
            remote_addresses("203.0.113.10/32,198.51.100.0/24", false)
                .unwrap()
                .unwrap(),
            "203.0.113.10/32,198.51.100.0/24"
        );
        assert_eq!(
            remote_addresses("0.0.0.0/0,fd00::/64", false)
                .unwrap()
                .unwrap(),
            "*"
        );
        assert_eq!(
            remote_addresses("0.0.0.0/0,fd00::/64", true)
                .unwrap()
                .unwrap(),
            "fd00::/64"
        );
        assert_eq!(
            remote_addresses("::/0,192.168.1.0/24", true)
                .unwrap()
                .unwrap(),
            "::/0"
        );
        assert_eq!(
            remote_addresses("::/0,192.168.1.0/24", false)
                .unwrap()
                .unwrap(),
            "192.168.1.0/24"
        );
        assert!(remote_addresses("::/0", false).unwrap().is_none());
        assert!(remote_addresses("::1", true).unwrap().is_none());
        assert_eq!(
            remote_addresses("::1,fd00::/64", true).unwrap().unwrap(),
            "fd00::/64"
        );
        assert!(remote_addresses("0.0.0.0/0,invalid", false).is_err());
        assert!(remote_addresses("*", false).is_err());
    }
}
