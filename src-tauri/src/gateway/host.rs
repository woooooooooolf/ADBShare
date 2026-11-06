use super::*;

#[derive(Clone)]
pub(super) enum Selector {
    Serial(String),
    Id(String),
    Kind(Option<&'static str>),
}

pub(super) fn device_request(request: &str, group: &Group) -> Option<(Selector, String)> {
    if let Some((serial, command)) = named(request, group) {
        return Some((Selector::Serial(serial.into()), command));
    }
    for prefix in ["host-transport-id:", "host:transport-id:"] {
        if let Some(suffix) = request.strip_prefix(prefix) {
            let (id, command) = suffix.split_once(':')?;
            return Some((Selector::Id(id.into()), command.into()));
        }
    }
    for (prefix, kind) in [
        ("host:", None),
        ("host-usb:", Some("usb")),
        ("host-local:", Some("local")),
    ] {
        if let Some(command) = request.strip_prefix(prefix) {
            if command.starts_with("transport") || command.starts_with("tport:") {
                return None;
            }
            return Some((Selector::Kind(kind), command.into()));
        }
    }
    None
}

pub(super) fn resolve(list: &str, selector: &Selector, access: &Access) -> Result<String> {
    let access = access.lock().unwrap();
    if let Selector::Serial(serial) = selector {
        if !access.contains_key(serial) {
            return Err("device is disabled or not assigned to this group".into());
        }
        return Ok(serial.clone());
    }
    let mut candidates = adb::devices(list)
        .into_iter()
        .filter(|device| access.contains_key(&device.serial) && matches_selector(device, selector));
    let device = candidates.next().ok_or("no matching assigned device")?;
    if candidates.next().is_some() {
        return Err("more than one matching assigned device; specify -s SERIAL".into());
    }
    Ok(device.serial)
}

pub(super) async fn resolve_current(
    upstream: u16,
    selector: &Selector,
    access: &Access,
) -> Result<String> {
    let list = if matches!(selector, Selector::Serial(_)) {
        String::new()
    } else {
        adb::query(upstream, "host:devices-l").await?
    };
    resolve(&list, selector, access)
}

fn matches_selector(device: &adb::Device, selector: &Selector) -> bool {
    match selector {
        Selector::Serial(serial) => device.serial == *serial,
        Selector::Id(id) => device.transport_id == *id,
        Selector::Kind(kind) => kind.is_none_or(|kind| device.kind == kind),
    }
}

pub(super) struct WaitSpec<'a> {
    kind: Option<&'static str>,
    states: Vec<&'a str>,
}

pub(super) fn wait_spec(command: &str) -> Option<WaitSpec<'_>> {
    let suffix = command.strip_prefix("wait-for-")?;
    let (kind, states) = suffix.split_once('-')?;
    let kind = match kind {
        "any" => None,
        "usb" => Some("usb"),
        "local" => Some("local"),
        _ => return None,
    };
    let states: Vec<_> = states.split('-').collect();
    if !states.iter().all(|state| {
        matches!(
            *state,
            "device" | "recovery" | "rescue" | "sideload" | "bootloader" | "any" | "disconnect"
        )
    }) {
        return None;
    }
    Some(WaitSpec { kind, states })
}

pub(super) async fn wait(
    client: &mut TcpStream,
    upstream: u16,
    selector: &Selector,
    spec: &WaitSpec<'_>,
    access: &Access,
    mut inventory: watch::Receiver<String>,
) -> Result<()> {
    client.write_all(b"OKAY").await?;
    let selector = match selector {
        Selector::Kind(_) => Selector::Kind(spec.kind),
        other => other.clone(),
    };
    loop {
        // Do not treat an upstream query failure as a physical disconnect.
        let list = adb::query(upstream, "host:devices-l").await?;
        let candidates = {
            let enabled = access.lock().unwrap();
            if enabled.is_empty() {
                return Err("no enabled devices assigned to this group".into());
            }
            adb::devices(&list)
                .into_iter()
                .filter(|device| {
                    enabled.contains_key(&device.serial)
                        && matches_selector(device, &selector)
                        && spec.kind.is_none_or(|kind| device.kind == kind)
                })
                .collect::<Vec<_>>()
        };
        if candidates.len() > 1 {
            return Err("more than one matching assigned device; specify -s SERIAL".into());
        }
        let ready = spec.states.iter().any(|state| match *state {
            "disconnect" => candidates.is_empty(),
            "any" => !candidates.is_empty(),
            state => candidates
                .first()
                .is_some_and(|device| device.state == state),
        });
        if ready {
            client.write_all(b"OKAY").await?;
            return Ok(());
        }
        let mut eof = [0; 1];
        tokio::select! {
            result = inventory.changed() => { result?; }
            _ = tokio::time::sleep(Duration::from_millis(250)) => {}
            _ = client.read(&mut eof) => return Ok(()),
        }
    }
}

pub(super) async fn track_proto(
    client: &mut TcpStream,
    upstream: u16,
    text: bool,
    access: &Access,
    mut inventory: watch::Receiver<String>,
) -> Result<()> {
    let mut server = adb::connect(upstream).await?;
    adb::frame(&mut server, "host:track-devices-proto-binary").await?;
    adb::read_status(&mut server).await?;
    client.write_all(b"OKAY").await?;
    let mut latest = None;
    let mut previous = None;
    loop {
        let next = adb::read_stream_frame(&mut server);
        tokio::pin!(next);
        loop {
            let mut eof = [0; 1];
            tokio::select! {
                result = &mut next => { latest = Some(result?); break; }
                result = inventory.changed() => {
                    result?;
                    if let Some(payload) = &latest {
                        send_proto(client, payload, access, text, &mut previous).await?;
                    }
                }
                _ = client.read(&mut eof) => return Ok(()),
            }
        }
        send_proto(
            client,
            latest.as_deref().unwrap(),
            access,
            text,
            &mut previous,
        )
        .await?;
    }
}

async fn send_proto(
    client: &mut TcpStream,
    payload: &[u8],
    access: &Access,
    text: bool,
    previous: &mut Option<Vec<u8>>,
) -> Result<()> {
    let members = access.lock().unwrap().keys().cloned().collect::<Vec<_>>();
    let filtered = adb::tracker::filter(payload, &members, text)?;
    if previous.as_ref() != Some(&filtered) {
        adb::frame_bytes(client, &filtered).await?;
        *previous = Some(filtered);
    }
    Ok(())
}
