use adbshare::{gateway, model::Group, protocol as adb};
use prost::Message;
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
                } else if request == "host:host-features" {
                    let _ =
                        adb::okay_frame(&mut socket, "shell_v2,devicetracker_proto_format").await;
                } else if request == "host:mdns:check" {
                    let _ = adb::okay_frame(&mut socket, "mdns available").await;
                } else if request == "host:server-status" {
                    let _ = socket.write_all(b"OKAY").await;
                    let _ = adb::frame_bytes(&mut socket, &[8, 128, 1]).await;
                } else if request == "host:track-devices-proto-binary" {
                    if socket.write_all(b"OKAY").await.is_err() {
                        return;
                    }
                    let mut previous = None;
                    loop {
                        let value = inventory.lock().unwrap().clone();
                        if previous.as_ref() != Some(&value) {
                            let payload = tracker_payload(&value);
                            if adb::frame_bytes(&mut socket, &payload).await.is_err() {
                                break;
                            }
                            previous = Some(value);
                        }
                        let mut eof = [0; 1];
                        tokio::select! {
                            _ = socket.read(&mut eof) => break,
                            _ = tokio::time::sleep(Duration::from_millis(20)) => {}
                        }
                    }
                } else if request.starts_with("host:devices") {
                    let value = inventory.lock().unwrap().clone();
                    if let Some(error) = value.strip_prefix("FAIL:") {
                        let _ = adb::fail(&mut socket, error).await;
                    } else {
                        let _ = adb::okay_frame(&mut socket, &value).await;
                    }
                } else if request.starts_with("host-serial:") {
                    let list = inventory.lock().unwrap().clone();
                    let selected = adb::devices(&list).into_iter().find_map(|device| {
                        request
                            .strip_prefix(&format!("host-serial:{}:", device.serial))
                            .map(|command| (device, command.to_owned()))
                    });
                    if let Some((device, command)) = selected {
                        let value = match command.as_str() {
                            "get-state" => device.state,
                            "get-serialno" => device.serial,
                            "get-devpath" => "usb:1-1".into(),
                            "features" => "shell_v2,devicetracker_proto_format".into(),
                            "reconnect" => format!("reconnecting {}", device.serial),
                            _ => {
                                let _ = adb::fail(&mut socket, "unexpected host command").await;
                                return;
                            }
                        };
                        let _ = adb::okay_frame(&mut socket, &value).await;
                    } else {
                        let _ = adb::fail(&mut socket, "device not found").await;
                    }
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
fn tracker_payload(list: &str) -> Vec<u8> {
    adb::tracker::Devices {
        device: adb::devices(list)
            .into_iter()
            .map(|d| adb::tracker::Device {
                serial: d.serial,
                model: d.model,
                transport_id: d.transport_id.parse().unwrap_or(0),
                state: match d.state.as_str() {
                    "device" => 8,
                    "recovery" => 10,
                    _ => 6,
                },
                connection_type: if d.kind == "usb" { 1 } else { 2 },
                negotiated_speed: 480,
                max_speed: 5000,
                ..Default::default()
            })
            .collect(),
    }
    .encode_to_vec()
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
        "host:reconnect-offline",
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
async fn port_mapping_requests_are_explicitly_unsupported_and_never_reach_upstream() {
    let lab = lab().await;
    let g = group(&["A"]);
    let r = gateway::start(g.clone(), lab.port, Default::default())
        .await
        .unwrap();
    let message =
        "ADBShare does not support port mapping (adb forward/reverse: create, list, or remove)";
    let commands = [
        "forward:tcp:8000;tcp:9000",
        "forward:norebind:tcp:0;localabstract:example",
        "list-forward",
        "killforward:tcp:8000",
        "killforward-all",
    ];
    for prefix in [
        "host:",
        "host-usb:",
        "host-local:",
        "host-serial:A:",
        "host-transport-id:1:",
        "host:transport-id:1:",
    ] {
        for command in commands {
            let request = format!("{prefix}{command}");
            let mut c = open(&g, &request).await;
            assert_eq!(
                adb::read_status(&mut c).await.unwrap_err().to_string(),
                message,
                "{request}"
            );
        }
    }
    for transport in [
        "host:transport:A",
        "host:tport:serial:A",
        "host:transport-id:1",
    ] {
        for prefix in ["host:", "host-serial:A:", "reverse:"] {
            for command in commands {
                let mut c = open(&g, transport).await;
                adb::read_status(&mut c).await.unwrap();
                if transport.starts_with("host:tport:") {
                    let mut tid = [0; 8];
                    c.read_exact(&mut tid).await.unwrap();
                }
                let service = format!("{prefix}{command}");
                adb::frame(&mut c, &service).await.unwrap();
                assert_eq!(
                    adb::read_status(&mut c).await.unwrap_err().to_string(),
                    message,
                    "{transport} -> {service}"
                );
            }
        }
    }
    assert!(lab.requests.lock().unwrap().iter().all(|request| {
        request == "host:version"
            || request == "host:devices-l"
            || request == "host:transport:A"
            || request == "host:tport:serial:A"
    }));
    r.stop().await;
}

#[tokio::test]
async fn metadata_selection_and_reconnect_are_resolved_only_within_the_group() {
    let lab = lab().await;
    let g = group(&["A", "emulator-5554"]);
    let r = gateway::start(g.clone(), lab.port, Default::default())
        .await
        .unwrap();
    for (request, expected) in [
        ("host-usb:get-serialno", "A"),
        ("host-local:get-serialno", "emulator-5554"),
        ("host-transport-id:1:get-state", "device"),
        ("host-serial:A:get-devpath", "usb:1-1"),
        ("host-usb:features", "shell_v2,devicetracker_proto_format"),
        ("host-local:reconnect", "reconnecting emulator-5554"),
    ] {
        let mut c = open(&g, request).await;
        adb::read_status(&mut c).await.unwrap();
        assert_eq!(
            adb::read_frame(&mut c).await.unwrap(),
            expected,
            "{request}"
        );
    }
    for request in ["host:get-state", "host:features", "host:reconnect"] {
        let mut c = open(&g, request).await;
        assert!(adb::read_status(&mut c)
            .await
            .unwrap_err()
            .to_string()
            .contains("more than one"));
    }
    r.set_device_enabled("A", false);
    let mut c = open(&g, "host:get-serialno").await;
    adb::read_status(&mut c).await.unwrap();
    assert_eq!(adb::read_frame(&mut c).await.unwrap(), "emulator-5554");
    for request in [
        "host-usb:get-state",
        "host-transport-id:2:reconnect",
        "host-serial:B:reconnect",
    ] {
        let mut c = open(&g, request).await;
        assert!(adb::read_status(&mut c).await.is_err());
    }
    assert!(!lab
        .requests
        .lock()
        .unwrap()
        .iter()
        .any(|s| s == "host:features" || s == "host:reconnect" || s.starts_with("host-serial:B:")));
    r.stop().await;
}

#[tokio::test]
async fn read_only_diagnostics_preserve_binary_payloads() {
    let lab = lab().await;
    let g = group(&["A"]);
    let r = gateway::start(g.clone(), lab.port, Default::default())
        .await
        .unwrap();
    let mut c = open(&g, "host:server-status").await;
    adb::read_status(&mut c).await.unwrap();
    assert_eq!(adb::read_frame_bytes(&mut c).await.unwrap(), [8, 128, 1]);
    let mut c = open(&g, "host:mdns:check").await;
    adb::read_status(&mut c).await.unwrap();
    assert_eq!(adb::read_frame(&mut c).await.unwrap(), "mdns available");
    let mut c = open(&g, "host:host-features").await;
    adb::read_status(&mut c).await.unwrap();
    assert!(adb::read_frame(&mut c)
        .await
        .unwrap()
        .contains("devicetracker_proto_format"));
    r.stop().await;
}

#[tokio::test]
async fn waits_cover_standard_states_group_selection_disconnect_and_revocation() {
    let lab = lab().await;
    let g = group(&["A"]);
    let r = gateway::start(g.clone(), lab.port, Default::default())
        .await
        .unwrap();
    for (state, command) in [
        ("device", "host:wait-for-any-device-recovery"),
        ("bootloader", "host-usb:wait-for-usb-bootloader"),
        ("recovery", "host-serial:A:wait-for-any-recovery"),
        ("rescue", "host-transport-id:1:wait-for-any-rescue"),
        ("sideload", "host:wait-for-any-any"),
    ] {
        *lab.list.lock().unwrap() = format!("A {state} transport_id:1\nB device transport_id:2\n");
        let mut c = open(&g, command).await;
        adb::read_status(&mut c).await.unwrap();
        tokio::time::timeout(Duration::from_secs(3), adb::read_status(&mut c))
            .await
            .unwrap()
            .unwrap();
    }
    *lab.list.lock().unwrap() = "A offline transport_id:1\n".into();
    let mut c = open(&g, "host-serial:A:wait-for-any-disconnect").await;
    adb::read_status(&mut c).await.unwrap();
    assert!(tokio::time::timeout(Duration::from_millis(60), c.read_u8())
        .await
        .is_err());
    *lab.list.lock().unwrap() = "B device transport_id:2\n".into();
    tokio::time::timeout(Duration::from_secs(3), adb::read_status(&mut c))
        .await
        .unwrap()
        .unwrap();
    let mut c = open(&g, "host:wait-for-any-device").await;
    adb::read_status(&mut c).await.unwrap();
    assert!(tokio::time::timeout(Duration::from_millis(60), c.read_u8())
        .await
        .is_err());
    *lab.list.lock().unwrap() = "A device transport_id:1\nB device transport_id:2\n".into();
    tokio::time::timeout(Duration::from_secs(3), adb::read_status(&mut c))
        .await
        .unwrap()
        .unwrap();
    let mut c = open(&g, "host-serial:A:wait-for-any-recovery").await;
    adb::read_status(&mut c).await.unwrap();
    r.set_device_enabled("A", false);
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(2), c.read_u8())
            .await
            .unwrap()
            .unwrap_err()
            .kind(),
        std::io::ErrorKind::UnexpectedEof
    );
    r.set_device_enabled("A", true);
    *lab.list.lock().unwrap() = "FAIL:upstream unavailable".into();
    let mut c = open(&g, "host:wait-for-any-disconnect").await;
    adb::read_status(&mut c).await.unwrap();
    assert!(adb::read_status(&mut c)
        .await
        .unwrap_err()
        .to_string()
        .contains("upstream unavailable"));
    r.stop().await;
}

#[tokio::test]
async fn protobuf_tracking_filters_devices_updates_on_disable_and_survives_idle() {
    let lab = lab().await;
    let g = group(&["A"]);
    let r = gateway::start(g.clone(), lab.port, Default::default())
        .await
        .unwrap();
    let mut binary = open(&g, "host:track-devices-proto-binary").await;
    adb::read_status(&mut binary).await.unwrap();
    let payload = adb::read_frame_bytes(&mut binary).await.unwrap();
    let devices = adb::tracker::Devices::decode(payload.as_slice()).unwrap();
    assert_eq!(devices.device.len(), 1);
    assert_eq!(devices.device[0].serial, "A");
    assert_eq!(devices.device[0].max_speed, 5000);
    let mut text = open(&g, "host:track-devices-proto-text").await;
    adb::read_status(&mut text).await.unwrap();
    let payload = adb::read_frame(&mut text).await.unwrap();
    assert!(payload.contains("serial: \"A\"") && payload.contains("state: DEVICE"));
    assert!(!payload.contains("serial: \"B\""));
    // A tracker is allowed to be idle longer than an ordinary request timeout.
    tokio::time::sleep(Duration::from_secs(9)).await;
    r.set_device_enabled("A", false);
    assert!(adb::read_frame_bytes(&mut binary).await.unwrap().is_empty());
    assert_eq!(adb::read_frame(&mut text).await.unwrap(), "");
    r.set_device_enabled("A", true);
    assert!(!adb::read_frame_bytes(&mut binary).await.unwrap().is_empty());
    assert!(adb::read_frame(&mut text)
        .await
        .unwrap()
        .contains("serial: \"A\""));
    *lab.list.lock().unwrap() = "B device transport_id:2\n".into();
    assert!(adb::read_frame_bytes(&mut binary).await.unwrap().is_empty());
    assert_eq!(adb::read_frame(&mut text).await.unwrap(), "");
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
    // A public/non-private source is valid configuration, but does not admit this private peer.
    g.sources = vec!["203.0.113.10/32".into()];
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
    g.sources = vec!["0.0.0.0/0".into()];
    let r = gateway::start(g.clone(), lab.port, Default::default())
        .await
        .unwrap();
    let mut c = open(&g, "host:devices-l").await;
    adb::read_status(&mut c).await.unwrap();
    assert!(adb::read_frame(&mut c).await.unwrap().contains("A device"));
    r.stop().await;
}
