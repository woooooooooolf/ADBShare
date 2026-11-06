use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    path::Path,
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub version: u32,
    pub adb_path: String,
    pub upstream_port: u16,
    pub groups: Vec<Group>,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            version: 1,
            adb_path: "adb".into(),
            upstream_port: 5037,
            groups: vec![],
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    pub address: IpAddr,
    /// A second, IPv6-only endpoint makes this a dual-protocol group.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ipv6_address: Option<Ipv6Addr>,
    /// Stable adapter identity (Windows GUID / Linux interface name).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interface_name: Option<String>,
    pub port: u16,
    pub sources: Vec<String>,
    pub members: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_members: Vec<String>,
}
#[derive(Clone, Copy, Debug)]
pub struct Network {
    base: u128,
    mask: u128,
    v6: bool,
}
impl Network {
    pub fn parse(value: &str) -> Result<Self, String> {
        let (ip, prefix) = value
            .split_once('/')
            .map_or((value, None), |(ip, p)| (ip, Some(p)));
        let ip: IpAddr = ip.parse().map_err(|_| format!("无效 IP：{value}"))?;
        if matches!(ip, IpAddr::V6(ip) if ip.to_ipv4_mapped().is_some()) {
            return Err(format!("不支持 IPv4 映射地址：{value}"));
        }
        let bits = if ip.is_ipv6() { 128 } else { 32 };
        let prefix: u32 = prefix
            .map_or(Ok(bits), str::parse)
            .map_err(|_| format!("无效 CIDR：{value}"))?;
        if prefix > bits {
            return Err(format!("无效 CIDR：{value}"));
        }
        let mask = u128::MAX.checked_shl(bits - prefix).unwrap_or(0)
            & if bits == 32 {
                u32::MAX as u128
            } else {
                u128::MAX
            };
        let base = match ip {
            IpAddr::V4(ip) => u32::from(ip) as u128,
            IpAddr::V6(ip) => u128::from(ip),
        } & mask;
        Ok(Self {
            base,
            mask,
            v6: ip.is_ipv6(),
        })
    }
    pub fn contains(&self, ip: IpAddr) -> bool {
        self.v6 == ip.is_ipv6()
            && match ip {
                IpAddr::V4(ip) => u32::from(ip) as u128,
                IpAddr::V6(ip) => u128::from(ip),
            } & self.mask
                == self.base
    }
    pub fn is_all(&self) -> bool {
        self.mask == 0
    }
    pub fn is_ipv6(&self) -> bool {
        self.v6
    }
    pub fn canonical(&self) -> String {
        let ip = if self.v6 {
            IpAddr::V6(Ipv6Addr::from(self.base))
        } else {
            IpAddr::V4(Ipv4Addr::from(self.base as u32))
        };
        format!("{ip}/{}", self.mask.count_ones())
    }
}
impl Group {
    pub fn addresses(&self) -> Vec<IpAddr> {
        let mut addresses = vec![self.address];
        if let Some(ip) = self.ipv6_address {
            addresses.push(ip.into());
        }
        addresses
    }
    pub fn is_loopback(&self) -> bool {
        self.addresses().iter().all(IpAddr::is_loopback)
    }
}
impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 || self.upstream_port == 0 {
            return Err("配置版本或上游端口无效".into());
        }
        let mut ids = HashSet::new();
        for g in &self.groups {
            if uuid::Uuid::parse_str(&g.id).is_err() || !ids.insert(&g.id) {
                return Err("分组 ID 无效或重复".into());
            }
            if g.name.trim().is_empty()
                || g.port == 0
                || g.port == self.upstream_port
                || g.addresses().iter().any(|ip| {
                    ip.is_unspecified()
                        || ip.is_multicast()
                        || matches!(ip, IpAddr::V4(ip) if ip.is_broadcast())
                        || matches!(ip, IpAddr::V6(ip) if ip.to_ipv4_mapped().is_some())
                })
                || (g.ipv6_address.is_some() && !g.address.is_ipv4())
                || g.addresses()
                    .iter()
                    .any(|ip| ip.is_loopback() != g.address.is_loopback())
            {
                return Err(
                    "请填写组名、有效网卡 IP 和独立端口；双协议地址必须属于同一网卡".into(),
                );
            }
            if g.sources.is_empty() {
                return Err("至少需要一个允许的来源地址或网段".into());
            }
            for s in &g.sources {
                Network::parse(s)?;
            }
            for ip in g.addresses() {
                if !g
                    .sources
                    .iter()
                    .any(|s| Network::parse(s).is_ok_and(|n| n.is_ipv6() == ip.is_ipv6()))
                {
                    return Err("每个监听协议至少需要一个同协议的来源地址或网段".into());
                }
            }
            if g.disabled_members.iter().any(|s| !g.members.contains(s)) {
                return Err("禁用设备必须属于当前组".into());
            }
            if g.members
                .iter()
                .any(|s| s.is_empty() || s.chars().any(char::is_whitespace))
            {
                return Err("设备序列号无效".into());
            }
        }
        for (i, a) in self.groups.iter().enumerate() {
            if self.groups[i + 1..].iter().any(|b| {
                a.port == b.port
                    && a.addresses().iter().any(|ip| {
                        b.addresses().contains(ip)
                            && (a.interface_name == b.interface_name
                                || a.interface_name.is_none()
                                || b.interface_name.is_none()
                                || !matches!(ip, IpAddr::V6(v) if v.is_unicast_link_local()))
                    })
            }) {
                return Err("共享组监听地址和端口重复".into());
            }
        }
        Ok(())
    }
}
pub fn load(path: &Path) -> Result<Config, String> {
    if !path.exists() {
        return Ok(Config::default());
    }
    let config: Config = serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("配置读取失败：{e}"))?;
    config.validate()?;
    Ok(config)
}
pub fn save(path: &Path, config: &Config) -> Result<(), String> {
    config.validate()?;
    let dir = path.parent().ok_or("无效配置路径")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    use std::io::Write;
    file.write_all(&serde_json::to_vec_pretty(config).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path)
        .map_err(|e| format!("配置保存失败：{e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ipv6_ranges_preserve_family_and_prefix_boundaries() {
        let subnet = Network::parse("fd12:3456:789a:1::1234/64").unwrap();
        assert_eq!(subnet.canonical(), "fd12:3456:789a:1::/64");
        assert!(subnet.contains("fd12:3456:789a:1:ffff:ffff:ffff:ffff".parse().unwrap()));
        assert!(!subnet.contains("fd12:3456:789a:2::".parse().unwrap()));
        let single = Network::parse("2001:db8::abcd").unwrap();
        assert!(single.contains("2001:db8::abcd".parse().unwrap()));
        assert!(!single.contains("2001:db8::abce".parse().unwrap()));
        let all = Network::parse("::/0").unwrap();
        assert!(all.is_all());
        assert!(all.contains("ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff".parse().unwrap()));
        assert!(!all.contains("192.168.1.1".parse().unwrap()));
        assert!(!Network::parse("0.0.0.0/0")
            .unwrap()
            .contains("::1".parse().unwrap()));
        for invalid in [
            "::/129",
            "::/-1",
            "::/64/1",
            "fe80::1%3",
            "[::1]",
            "::ffff:192.168.1.1",
            "::ffff:c0a8:101",
        ] {
            assert!(Network::parse(invalid).is_err(), "{invalid}");
        }
    }
    #[test]
    fn legacy_config_and_dual_family_source_requirements() {
        let mut config: Config = serde_json::from_value(serde_json::json!({"version":1,"adbPath":"adb","upstreamPort":5037,"groups":[{"id":uuid::Uuid::new_v4(),"name":"Legacy","address":"127.0.0.1","port":15037,"sources":["127.0.0.1"],"members":["A"]}]})).unwrap();
        config.validate().unwrap();
        assert!(config.groups[0].interface_name.is_none());
        config.groups[0].ipv6_address = Some(Ipv6Addr::LOCALHOST);
        assert!(config.validate().is_err());
        config.groups[0].sources.push("::1".into());
        config.validate().unwrap();
        let mut duplicate = config.groups[0].clone();
        duplicate.id = uuid::Uuid::new_v4().to_string();
        duplicate.address = Ipv6Addr::LOCALHOST.into();
        duplicate.ipv6_address = None;
        config.groups.push(duplicate);
        assert!(config.validate().unwrap_err().contains("重复"));
        config.groups.pop();
        config.groups[0].ipv6_address = Some("fd00::1".parse().unwrap());
        assert!(
            config.validate().is_err(),
            "cannot mix loopback and remote endpoints"
        );
    }
    #[test]
    fn source_ranges_accept_any_ipv4_but_enforce_cidr_boundaries() {
        assert!(Network::parse("192.168.1.20/24")
            .unwrap()
            .contains("192.168.1.99".parse().unwrap()));
        assert!(!Network::parse("192.168.1.0/24")
            .unwrap()
            .contains("192.168.2.1".parse().unwrap()));
        for s in ["8.8.8.8", "203.0.113.10/32", "10.0.0.1/7", "172.16.0.0/11"] {
            assert!(Network::parse(s).is_ok(), "{s}");
        }
        let public = Network::parse("203.0.113.10/24").unwrap();
        assert!(public.contains("203.0.113.255".parse().unwrap()));
        assert!(!public.contains("203.0.112.255".parse().unwrap()));
        assert!(!public.contains("203.0.114.0".parse().unwrap()));
        let single = Network::parse("203.0.113.10").unwrap();
        assert!(single.contains("203.0.113.10".parse().unwrap()));
        assert!(!single.contains("203.0.113.11".parse().unwrap()));
        let all = Network::parse("0.0.0.0/0").unwrap();
        assert!(all.is_all());
        assert!(!single.is_all());
        assert!(all.contains(Ipv4Addr::UNSPECIFIED.into()));
        assert!(all.contains(Ipv4Addr::BROADCAST.into()));
        for s in [
            "10.0.0.1/33",
            "1.2.3.4/-1",
            "1.2.3.4/24/1",
            "256.1.1.1",
            "localhost",
            "1.2.3.4:5037",
            "",
        ] {
            assert!(Network::parse(s).is_err(), "{s}");
        }
    }
    #[test]
    fn public_source_config_roundtrips_without_private_network_restrictions() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let config = Config {
            groups: vec![Group {
                id: uuid::Uuid::new_v4().to_string(),
                name: "Relay".into(),
                address: Ipv4Addr::LOCALHOST.into(),
                ipv6_address: None,
                interface_name: None,
                port: 15037,
                sources: vec![
                    "203.0.113.10/32".into(),
                    "198.51.100.0/24".into(),
                    "0.0.0.0/0".into(),
                ],
                members: vec!["A".into()],
                disabled_members: vec![],
            }],
            ..Config::default()
        };
        save(&path, &config).unwrap();
        assert_eq!(load(&path).unwrap(), config);
    }
    #[test]
    fn atomic_config_roundtrip_and_corruption() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        save(&path, &Config::default()).unwrap();
        save(&path, &Config::default()).unwrap();
        assert_eq!(load(&path).unwrap().version, 1);
        std::fs::write(&path, b"broken").unwrap();
        assert!(load(&path).is_err());
    }
}
