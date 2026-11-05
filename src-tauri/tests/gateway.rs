use adbshare::{gateway, model::Group, protocol as adb};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    task::JoinHandle,
};

struct Lab {
    port: u16,
    task: JoinHandle<()>,
    list: Arc<Mutex<String>>,
    requests: Arc<Mutex<Vec<String>>>,
}
impl Drop for Lab {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn lab() -> Lab {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let list=Arc::new(Mutex::<String>::new("A device model:Phone transport_id:1\nB device model:Other transport_id:2\nemulator-5554 device transport_id:3\n".into()));
    let requests = Arc::new(Mutex::new(vec![]));
    let inventory = list.clone();
    let seen = requests.clone();
    let task = tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let inventory = inventory.clone();
            let seen = seen.clone();
            tokio::spawn(async move {
                let Ok(request) = adb::read_frame(&mut socket).await else {
                    return;
                };
                seen.lock().unwrap().push(request.clone());
                if request == "host:version" {
                    let _ = adb::okay_frame(&mut socket, "0029").await;
                } else if request.starts_with("host:devices") {
                    let value = inventory.lock().unwrap().clone();
                    let _ = adb::okay_frame(&mut socket, &value).await;
                } else if request.starts_with("host:transport:")
                    || request.starts_with("host:tport:serial:")
                {
                    socket.write_all(b"OKAY").await.unwrap();
                    if request.starts_with("host:tport:") {
                        socket.write_all(&1u64.to_le_bytes()).await.unwrap();
                    }
                    let Ok(service) = adb::read_frame(&mut socket).await else {
                        return;
                    };
                    seen.lock().unwrap().push(service);
                    if socket.write_all(b"OKAY").await.is_err() {
                        return;
                    }
                    let mut bytes = [0; 4096];
                    while let Ok(n) = socket.read(&mut bytes).await {
                        if n == 0 {
                            break;
                        }
                        if socket.write_all(&bytes[..n]).await.is_err() {
                            break;
                        }
                    }
                } else {
                    let _ = adb::fail(&mut socket, "unexpected upstream request").await;
                }
            });
        }
    });
    Lab {
        port,
        task,
        list,
        requests,
    }
}
fn group(members: &[&str]) -> Group {
    let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = probe.local_addr().unwrap().port();
    drop(probe);
    Group {
        id: uuid::Uuid::new_v4().to_string(),
        name: "Test".into(),
        address: "127.0.0.1".parse().unwrap(),
        port,
        sources: vec!["127.0.0.1".into()],
        disabled_members: vec![],
        members: members.iter().map(|s| s.to_string()).collect(),
    }
}
async fn open(g: &Group, request: &str) -> TcpStream {
    let mut client = TcpStream::connect((g.address, g.port)).await.unwrap();
    adb::frame(&mut client, request).await.unwrap();
    client
}
async fn shell(g: &Group, request: &str) -> TcpStream {
    let mut client = open(g, request).await;
    adb::read_status(&mut client).await.unwrap();
    if request.starts_with("host:tport:") {
        let mut tid = [0; 8];
        client.read_exact(&mut tid).await.unwrap();
        assert_eq!(u64::from_le_bytes(tid), 1);
    }
    adb::frame(&mut client, "shell:echo").await.unwrap();
    adb::read_status(&mut client).await.unwrap();
    client
}
#[tokio::test]
async fn filters_groups_denies_host_mutation_and_cross_group_access() {
    let lab = lab().await;
    let g = group(&["A"]);
    let r = gateway::start(g.clone(), lab.port, Default::default())
        .await
        .unwrap();
    let mut c = open(&g, "host:devices-l").await;
    adb::read_status(&mut c).await.unwrap();
    let payload = adb::read_frame(&mut c).await.unwrap();
    assert!(payload.contains("A device"));
    assert!(!payload.contains("B device"));
    for request in [
        "host:transport:B",
        "host:transport-id:2",
        "host:kill",
        "host:connect:example:5555",
        "host-serial:A:killforward-all",
        "host-serial:A:list-forward",
        "host-serial:B:features",
        "host:track-devices-proto-binary",
    ] {
        let mut c = open(&g, request).await;
        assert!(adb::read_status(&mut c).await.is_err(), "{request}");
    }
    let mut c = open(&g, "host:transport:A").await;
    adb::read_status(&mut c).await.unwrap();
    adb::frame(&mut c, "host:kill").await.unwrap();
    assert!(adb::read_status(&mut c).await.is_err());
    assert!(!lab
        .requests
        .lock()
        .unwrap()
        .iter()
        .any(|r| r == "host:kill" || r.contains("killforward")));
    r.stop().await;
}
#[tokio::test]
async fn concurrent_binary_streams_and_stop_revocation() {
    let lab = lab().await;
    let g = group(&["A"]);
    let r = gateway::start(g.clone(), lab.port, Default::default())
        .await
        .unwrap();
    let sessions = r.sessions.clone();
    let mut a = shell(&g, "host:tport:serial:A").await;
    let mut b = shell(&g, "host:transport-id:1").await;
    for c in [&mut a, &mut b] {
        c.write_all(&[0, 255, 12, 42]).await.unwrap();
        let mut bytes = [0; 4];
        c.read_exact(&mut bytes).await.unwrap();
        assert_eq!(bytes, [0, 255, 12, 42]);
    }
    assert_eq!(sessions.lock().unwrap().len(), 2);
    r.stop().await;
    let mut bytes = [0];
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(2), a.read(&mut bytes))
            .await
            .unwrap()
            .unwrap(),
        0
    );
    assert!(sessions.lock().unwrap().is_empty());
    assert!(TcpStream::connect((g.address, g.port)).await.is_err());
}
#[tokio::test]
async fn device_disable_revokes_only_its_streams_and_history_captures_binary_both_ways() {
    let lab = lab().await;
    let g = group(&["A", "B"]);
    let logs = adbshare::history::Logs::default();
    let r = gateway::start(g.clone(), lab.port, logs.clone())
        .await
        .unwrap();
    let mut a = shell(&g, "host:transport:A").await;
    let mut b = shell(&g, "host:transport:B").await;
    a.write_all(&[0, 255, 12, 42]).await.unwrap();
    let mut bytes = [0; 4];
    a.read_exact(&mut bytes).await.unwrap();
    assert_eq!(bytes, [0, 255, 12, 42]);
    {
        let history = logs.lock().unwrap().view(Some(&g.id), Some("A"));
        for direction in ["send", "receive"] {
            assert!(history
                .records
                .iter()
                .any(|r| r.kind == direction && r.hex.contains("00 FF 0C 2A")));
        }
        assert!(history
            .records
            .iter()
            .any(|r| r.kind == "service" && r.message == "shell:echo"));
    }
    r.set_device_enabled("A", false);
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(2), a.read(&mut bytes))
            .await
            .unwrap()
            .unwrap(),
        0
    );
    let mut denied = open(&g, "host:transport:A").await;
    assert!(adb::read_status(&mut denied).await.is_err());
    let mut list = open(&g, "host:devices-l").await;
    adb::read_status(&mut list).await.unwrap();
    let list = adb::read_frame(&mut list).await.unwrap();
    assert!(!list.contains("A device"));
    assert!(list.contains("B device"));
    b.write_all(b"live").await.unwrap();
    b.read_exact(&mut bytes).await.unwrap();
    assert_eq!(&bytes, b"live");
    assert!(logs
        .lock()
        .unwrap()
        .view(Some(&g.id), Some("A"))
        .records
        .iter()
        .any(|r| r.kind == "disconnect"));
    r.set_device_enabled("A", true);
    let mut a = shell(&g, "host:transport:A").await;
    a.write_all(b"back").await.unwrap();
    a.read_exact(&mut bytes).await.unwrap();
    assert_eq!(&bytes, b"back");
    r.stop().await;
    let mut remaining = g.clone();
    remaining.members.retain(|s| s != "A");
    logs.lock().unwrap().configure(&[remaining]);
    assert!(logs
        .lock()
        .unwrap()
        .view(None, None)
        .records
        .iter()
        .all(|r| r.serial.as_deref() != Some("A") && !r.message.contains("transport:A")));
}

#[tokio::test]
async fn stopping_one_group_leaves_another_and_local_upstream_usable() {
    let lab = lab().await;
    let a = group(&["A"]);
    let b = group(&["A", "B"]);
    let r1 = gateway::start(a.clone(), lab.port, Default::default())
        .await
        .unwrap();
    let r2 = gateway::start(b.clone(), lab.port, Default::default())
        .await
        .unwrap();
    r1.stop().await;
    assert_eq!(adb::query(lab.port, "host:version").await.unwrap(), "0029");
    let mut c = shell(&b, "host:transport:A").await;
    c.write_all(b"still alive").await.unwrap();
    let mut bytes = [0; 11];
    c.read_exact(&mut bytes).await.unwrap();
    assert_eq!(&bytes, b"still alive");
    r2.stop().await;
}
#[tokio::test]
async fn transport_shortcuts_preserve_usb_and_local_semantics() {
    let lab = lab().await;
    let g = group(&["A", "emulator-5554"]);
    let r = gateway::start(g.clone(), lab.port, Default::default())
        .await
        .unwrap();
    let _a = shell(&g, "host:transport-usb").await;
    let _b = shell(&g, "host:transport-local").await;
    let mut ambiguous = open(&g, "host:transport-any").await;
    assert!(adb::read_status(&mut ambiguous).await.is_err());
    let requests = lab.requests.lock().unwrap().clone();
    assert!(requests.contains(&"host:transport:emulator-5554".into()));
    assert!(requests.contains(&"host:transport:A".into()));
    r.stop().await;
}
#[tokio::test]
async fn tracking_updates_on_device_loss_and_releases_disconnected_subscribers() {
    let lab = lab().await;
    let g = group(&["A"]);
    let r = gateway::start(g.clone(), lab.port, Default::default())
        .await
        .unwrap();
    let mut c = open(&g, "host:track-devices-l").await;
    adb::read_status(&mut c).await.unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if adb::read_frame(&mut c).await.unwrap().contains("A device") {
                break;
            }
        }
    })
    .await
    .unwrap();
    *lab.list.lock().unwrap() = "B device transport_id:2\n".into();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(3), adb::read_frame(&mut c))
            .await
            .unwrap()
            .unwrap(),
        ""
    );
    drop(c);
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if r.sessions.lock().unwrap().is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    r.stop().await;
}
#[tokio::test]
async fn occupied_port_fails_before_reporting_started() {
    let lab = lab().await;
    let g = group(&["A"]);
    let listener = TcpListener::bind((g.address, g.port)).await.unwrap();
    assert!(gateway::start(g, lab.port, Default::default())
        .await
        .is_err());
    drop(listener);
}

#[tokio::test]
async fn source_policy_is_enforced_on_a_real_adapter_socket() {
    let ip = if_addrs::get_if_addrs()
        .unwrap()
        .into_iter()
        .find_map(|interface| {
            if let if_addrs::IfAddr::V4(v) = interface.addr {
                if v.ip.is_private() {
                    return Some(v.ip);
                }
            }
            None
        });
    let Some(ip) = ip else {
        eprintln!("SKIP: no private IPv4 adapter");
        return;
    };
    let lab = lab().await;
    let mut g = group(&["A"]);
    g.address = ip;
    // This exact source is intentionally different from the host address.
    g.sources = vec![if ip.to_string() == "10.254.254.254" {
        "10.254.254.253"
    } else {
        "10.254.254.254"
    }
    .into()];
    let r = gateway::start(g.clone(), lab.port, Default::default())
        .await
        .unwrap();
    let mut c = TcpStream::connect((g.address, g.port)).await.unwrap();
    let mut byte = [0];
    let denied = tokio::time::timeout(Duration::from_secs(3), c.read(&mut byte))
        .await
        .unwrap();
    assert!(
        matches!(denied, Ok(0) | Err(_)),
        "disallowed source must close without serving ADB"
    );
    r.stop().await;
    g.sources = vec![ip.to_string()];
    let r = gateway::start(g.clone(), lab.port, Default::default())
        .await
        .unwrap();
    let mut c = open(&g, "host:devices-l").await;
    adb::read_status(&mut c).await.unwrap();
    assert!(adb::read_frame(&mut c).await.unwrap().contains("A device"));
    r.stop().await;
}
