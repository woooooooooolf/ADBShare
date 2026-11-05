use serde::{Deserialize, Serialize};
use std::{collections::HashSet, net::Ipv4Addr, path::Path};

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
    pub address: Ipv4Addr,
    pub port: u16,
    pub sources: Vec<String>,
    pub members: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_members: Vec<String>,
}
#[derive(Clone, Copy, Debug)]
pub struct Network {
    base: u32,
    mask: u32,
}
impl Network {
    pub fn parse(value: &str) -> Result<Self, String> {
        let (ip, prefix) = value.split_once('/').unwrap_or((value, "32"));
        let ip: Ipv4Addr = ip.parse().map_err(|_| format!("无效 IPv4：{value}"))?;
        let prefix: u32 = prefix.parse().map_err(|_| format!("无效 CIDR：{value}"))?;
        if prefix > 32 {
            return Err(format!("无效 CIDR：{value}"));
        }
        let mask = u32::MAX.checked_shl(32 - prefix).unwrap_or(0);
        let base = u32::from(ip) & mask;
        let end = base | !mask;
        let private = [
            (0x0a000000, 0x0affffff),
            (0xac100000, 0xac1fffff),
            (0xc0a80000, 0xc0a8ffff),
            (0x7f000000, 0x7fffffff),
        ];
        if !private.iter().any(|(a, b)| base >= *a && end <= *b) {
            return Err("来源范围须位于私有 IPv4 或回环地址内".into());
        }
        Ok(Self { base, mask })
    }
    pub fn contains(&self, ip: Ipv4Addr) -> bool {
        u32::from(ip) & self.mask == self.base
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
                || g.address.is_unspecified()
                || g.address.is_multicast()
            {
                return Err("请填写组名、有效网卡 IPv4 和独立端口".into());
            }
            if g.sources.is_empty() {
                return Err("至少需要一个允许的来源地址或网段".into());
            }
            for s in &g.sources {
                Network::parse(s)?;
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
            if self.groups[i + 1..]
                .iter()
                .any(|b| a.address == b.address && a.port == b.port)
            {
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
    fn source_ranges_are_bounded() {
        assert!(Network::parse("192.168.1.20/24")
            .unwrap()
            .contains("192.168.1.99".parse().unwrap()));
        assert!(!Network::parse("192.168.1.0/24")
            .unwrap()
            .contains("192.168.2.1".parse().unwrap()));
        for s in [
            "0.0.0.0/0",
            "8.8.8.8",
            "10.0.0.1/7",
            "172.16.0.0/11",
            "10.0.0.1/33",
        ] {
            assert!(Network::parse(s).is_err());
        }
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
