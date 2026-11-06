//! Adapter inventory and explicit, family-isolated TCP endpoints.
use crate::model::{Group, Network};
use serde::Serialize;
use socket2::{Domain, Protocol, Socket, Type};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, SocketAddrV6};
use tokio::net::TcpListener;

const LOOPBACK: &str = "loopback";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Interface {
    pub id: String,
    pub name: String,
    pub address: String,
    pub cidr: String,
    pub family: String,
    pub scope_id: u32,
    pub available: bool,
    /// Stable reason codes are translated by the UI.
    pub reason: Option<String>,
}

fn socket_address(ip: IpAddr, port: u16, index: u32) -> SocketAddr {
    match ip {
        IpAddr::V6(ip) if ip.is_unicast_link_local() => {
            SocketAddrV6::new(ip, port, 0, index).into()
        }
        _ => SocketAddr::new(ip, port),
    }
}

fn bind(address: SocketAddr) -> std::io::Result<Socket> {
    let socket = Socket::new(
        Domain::for_address(address),
        Type::STREAM,
        Some(Protocol::TCP),
    )?;
    if address.is_ipv6() {
        socket.set_only_v6(true)?;
    }
    #[cfg(unix)]
    socket.set_reuse_address(true)?;
    socket.set_nonblocking(true)?;
    socket.bind(&address.into())?;
    Ok(socket)
}

#[cfg(target_os = "linux")]
fn ipv6_address_usable(ip: Ipv6Addr, name: &str) -> bool {
    // getifaddrs does not expose Linux DAD/deprecation flags. Do not offer
    // tentative, DAD-failed or deprecated addresses as stable server endpoints.
    let Ok(table) = std::fs::read_to_string("/proc/net/if_inet6") else {
        return false;
    };
    let hex = format!("{:032x}", u128::from(ip));
    table.lines().any(|line| {
        let fields: Vec<_> = line.split_whitespace().collect();
        fields.len() == 6
            && fields[0] == hex
            && fields[5] == name
            && u32::from_str_radix(fields[4], 16)
                .is_ok_and(|flags| flags & (0x08 | 0x20 | 0x40) == 0)
    })
}

fn entry(
    id: String,
    name: String,
    ip: IpAddr,
    prefix: u8,
    index: u32,
    up: bool,
    preferred: bool,
) -> Interface {
    let reason = if !up {
        Some("adapterDown")
    } else if !preferred {
        Some("addressNotPreferred")
    } else if matches!(ip, IpAddr::V6(v) if v.is_unicast_link_local()) && index == 0 {
        Some("missingScope")
    } else if bind(socket_address(ip, 0, index)).is_err() {
        Some("protocolUnavailable")
    } else {
        None
    };
    Interface {
        id,
        name,
        address: ip.to_string(),
        cidr: Network::parse(&format!("{ip}/{prefix}"))
            .unwrap()
            .canonical(),
        family: if ip.is_ipv4() { "ipv4" } else { "ipv6" }.into(),
        scope_id: index,
        available: reason.is_none(),
        reason: reason.map(str::to_owned),
    }
}

pub fn interfaces() -> Result<Vec<Interface>, String> {
    let list = if_addrs::get_if_addrs().map_err(|e| format!("无法枚举网卡：{e}"))?;
    let mut result = vec![
        entry(
            LOOPBACK.into(),
            "Loopback".into(),
            Ipv4Addr::LOCALHOST.into(),
            8,
            0,
            true,
            true,
        ),
        entry(
            LOOPBACK.into(),
            "Loopback".into(),
            Ipv6Addr::LOCALHOST.into(),
            128,
            0,
            true,
            true,
        ),
    ];
    for interface in list {
        let ip = interface.ip();
        if ip.is_loopback()
            || ip.is_unspecified()
            || ip.is_multicast()
            || matches!(ip, IpAddr::V4(v) if v.is_broadcast())
            || matches!(ip, IpAddr::V6(v) if v.to_ipv4_mapped().is_some())
        {
            continue;
        }
        let up = interface.is_oper_up();
        #[cfg(windows)]
        let id = interface.adapter_name.clone();
        #[cfg(not(windows))]
        let id = interface.name.clone();
        // if-addrs already filters Windows unicast addresses to DAD Preferred.
        #[cfg(target_os = "linux")]
        let preferred = match ip {
            IpAddr::V6(ip) => ipv6_address_usable(ip, &interface.name),
            _ => true,
        };
        #[cfg(not(target_os = "linux"))]
        let preferred = true;
        let prefix = match interface.addr {
            if_addrs::IfAddr::V4(v) => v.prefixlen,
            if_addrs::IfAddr::V6(v) => v.prefixlen,
        };
        result.push(entry(
            id,
            interface.name,
            ip,
            prefix,
            interface.index.unwrap_or(0),
            up,
            preferred,
        ));
    }
    result.sort_by(|a, b| (&a.id, &a.family, &a.address).cmp(&(&b.id, &b.family, &b.address)));
    result.dedup_by(|a, b| a.id == b.id && a.address == b.address);
    Ok(result)
}

fn resolve(group: &Group, inventory: &[Interface]) -> Result<Vec<SocketAddr>, String> {
    let mut selected_id = group.interface_name.as_deref();
    let mut addresses = Vec::new();
    for ip in group.addresses() {
        let matches: Vec<_> = inventory
            .iter()
            .filter(|i| {
                (i.address == ip.to_string()
                    || (ip.is_loopback()
                        && i.id == LOOPBACK
                        && i.family == if ip.is_ipv4() { "ipv4" } else { "ipv6" }))
                    && selected_id.is_none_or(|id| i.id == id)
            })
            .collect();
        if matches.len() != 1 {
            return Err(format!(
                "网卡地址不可用或不唯一：{ip}；请刷新并重新选择网卡和地址"
            ));
        }
        let interface = matches[0];
        if !interface.available {
            return Err(format!(
                "网卡地址不可用：{ip} ({})；请检查网卡连接、协议栈和地址配置",
                interface.reason.as_deref().unwrap_or("unknown")
            ));
        }
        selected_id = Some(&interface.id);
        addresses.push(socket_address(ip, group.port, interface.scope_id));
    }
    Ok(addresses)
}

/// Reserve every endpoint before firewall mutation, without listening yet.
/// A partial failure drops all previously reserved sockets.
pub struct Prepared(Vec<Socket>);
pub fn check_group(group: &Group) -> Result<(), String> {
    resolve(group, &interfaces()?).map(|_| ())
}
pub fn prepare(group: &Group) -> Result<Prepared, String> {
    let addresses = resolve(group, &interfaces()?)?;
    let sockets = addresses
        .into_iter()
        .map(|address| {
            bind(address)
                .map_err(|e| format!("监听地址无法绑定：{address}：{e}；请检查协议栈、地址和端口"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Prepared(sockets))
}
impl Prepared {
    pub fn listen(self) -> std::io::Result<Vec<TcpListener>> {
        self.0
            .into_iter()
            .map(|socket| {
                socket.listen(128)?;
                TcpListener::from_std(socket.into())
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn group() -> Group {
        serde_json::from_value(serde_json::json!({"id":uuid::Uuid::new_v4(),"name":"Test","address":"127.0.0.1","ipv6Address":"::1","port":15037,"sources":["127.0.0.1","::1"],"members":[]})).unwrap()
    }
    #[test]
    fn dual_requires_both_families_on_the_same_available_adapter() {
        let mut rows = vec![
            entry(
                "a".into(),
                "A".into(),
                "192.0.2.1".parse().unwrap(),
                24,
                1,
                true,
                true,
            ),
            entry(
                "b".into(),
                "B".into(),
                "fd00::1".parse().unwrap(),
                64,
                2,
                true,
                true,
            ),
        ];
        // Pure selection test independent of host adapters and bind availability.
        for row in &mut rows {
            row.available = true;
            row.reason = None;
        }
        let mut g = group();
        g.address = "192.0.2.1".parse().unwrap();
        g.ipv6_address = Some("fd00::1".parse().unwrap());
        assert!(resolve(&g, &rows).is_err());
        rows[1].id = "a".into();
        assert_eq!(resolve(&g, &rows).unwrap().len(), 2);
        rows[1].available = false;
        assert!(resolve(&g, &rows).is_err());
        rows.pop();
        assert!(resolve(&g, &rows).is_err());
        g.ipv6_address = None;
        assert_eq!(resolve(&g, &rows).unwrap().len(), 1);
        g.interface_name = Some("gone".into());
        assert!(resolve(&g, &rows).is_err());
    }
    #[test]
    fn link_local_uses_current_interface_scope() {
        let ip = "fe80::1234".parse().unwrap();
        assert_eq!(
            socket_address(ip, 15037, 17).to_string(),
            "[fe80::1234%17]:15037"
        );
    }
}
