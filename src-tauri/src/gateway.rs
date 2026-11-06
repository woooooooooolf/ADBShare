use crate::history::Logs;
use crate::{
    model::{Group, Network},
    protocol::{self as adb, Result},
};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    net::IpAddr,
    pin::Pin,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    task::{Context, Poll},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf},
    net::{TcpListener, TcpStream},
    sync::{watch, Semaphore},
    task::{JoinHandle, JoinSet},
};
use tokio_util::sync::CancellationToken;
mod host;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: u64,
    pub peer: String,
    pub serial: String,
    pub since: u64,
}
pub type Sessions = Arc<Mutex<BTreeMap<u64, Session>>>;
pub struct Running {
    pub cancel: CancellationToken,
    pub task: JoinHandle<()>,
    pub sessions: Sessions,
    access: Access,
    inventory: watch::Sender<String>,
}
type Access = Arc<Mutex<BTreeMap<String, CancellationToken>>>;
impl Running {
    pub fn set_device_enabled(&self, serial: &str, enabled: bool) {
        let mut access = self.access.lock().unwrap();
        if enabled {
            access.entry(serial.into()).or_default();
        } else if let Some(token) = access.remove(serial) {
            token.cancel();
        }
        drop(access);
        self.inventory.send_modify(|_| {});
    }

    pub async fn stop(self) {
        self.cancel.cancel();
        let _ = self.task.await;
    }
}
struct SessionGuard(Sessions, u64, Logs, String);
impl Drop for SessionGuard {
    fn drop(&mut self) {
        if let Some(session) = self.0.lock().unwrap().remove(&self.1) {
            self.2.lock().unwrap().event(
                Some(&self.3),
                if session.serial == "协商中" {
                    None
                } else {
                    Some(&session.serial)
                },
                Some(self.1),
                "disconnect",
                session.peer,
            );
        }
    }
}

pub async fn start(group: Group, upstream: u16, logs: Logs) -> Result<Running> {
    logs.lock().unwrap().register(&group);
    let ranges: Vec<_> = group
        .sources
        .iter()
        .map(|s| Network::parse(s))
        .collect::<std::result::Result<_, _>>()?;
    // Verify upstream before opening the public listener.
    adb::query(upstream, "host:version").await?;
    let listener = TcpListener::bind((group.address, group.port)).await?;
    let cancel = CancellationToken::new();
    let stop = cancel.clone();
    let sessions = Sessions::default();
    let live = sessions.clone();
    let access: Access = Arc::new(Mutex::new(
        group
            .members
            .iter()
            .filter(|s| !group.disabled_members.contains(s))
            .map(|s| (s.clone(), CancellationToken::new()))
            .collect(),
    ));
    let live_access = access.clone();
    let (tx, rx) = watch::channel(String::new());
    let inventory = tx.clone();
    let task = tokio::spawn(async move {
        logs.lock().unwrap().event(
            Some(&group.id),
            None,
            None,
            "group-enabled",
            format!("{}:{}", group.address, group.port),
        );
        for serial in &group.members {
            if !group.disabled_members.contains(serial) {
                logs.lock().unwrap().event(
                    Some(&group.id),
                    Some(serial),
                    None,
                    "sharing-enabled",
                    "",
                );
            }
        }
        let mut jobs = JoinSet::new();
        let inventory_stop = stop.clone();
        jobs.spawn(async move {
            loop {tokio::select! {
                _=inventory_stop.cancelled()=>break,
                result=adb::query(upstream,"host:devices-l")=>{ let _=tx.send_if_modified(|value| {let next=result.unwrap_or_default();if *value==next {false}else{*value=next;true}}); }
            }
            tokio::select! {_=inventory_stop.cancelled()=>break,_=tokio::time::sleep(Duration::from_secs(1))=>{}}
            }
        });
        let limit = Arc::new(Semaphore::new(128));
        static COUNTER: AtomicU64 = AtomicU64::new(1);
        loop {
            tokio::select! {
                _=stop.cancelled()=>break,
                Some(_)=jobs.join_next()=>{},
                accepted=listener.accept()=>{
                    let (mut client,peer)=match accepted {Ok(v)=>v,Err(e)=>{logs.lock().unwrap().event(Some(&group.id),None,None,"error",e.to_string());break;}};
                    let allowed=match peer.ip() {IpAddr::V4(ip)=>ip.is_loopback() || ranges.iter().any(|r|r.contains(ip)),_=>false};
                    let permit=limit.clone().try_acquire_owned();
                    if !allowed || permit.is_err() {logs.lock().unwrap().event(Some(&group.id),None,None,"denied",peer.to_string());continue;}
                    let permit=permit.unwrap();let group=group.clone();let logs=logs.clone();let sessions=live.clone();let stop=stop.clone();let rx=rx.clone();
                    let id=COUNTER.fetch_add(1,Ordering::Relaxed);let access=live_access.clone();
                    jobs.spawn(async move {
                        let _permit=permit;
                        sessions.lock().unwrap().insert(id,Session {id,peer:peer.to_string(),serial:"协商中".into(),since:SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()});
                        let _guard=SessionGuard(sessions.clone(),id,logs.clone(),group.id.clone());
                        logs.lock().unwrap().event(Some(&group.id),None,Some(id),"connect",peer.to_string());
                        let result=tokio::select! {_=stop.cancelled()=>Ok(()),result=handle(&mut client,&group,upstream,rx,&sessions,id,&access,&logs)=>result};
                        if let Err(e)=result {let _=adb::fail(&mut client,&e.to_string()).await;let serial=sessions.lock().unwrap().get(&id).map(|s|s.serial.clone());logs.lock().unwrap().event(Some(&group.id),serial.as_deref().filter(|s|*s!="协商中"),Some(id),"error",format!("{peer}: {e}"));}
                    });
                }
            }
        }
        drop(listener);
        jobs.abort_all();
        while jobs.join_next().await.is_some() {}
        logs.lock()
            .unwrap()
            .event(Some(&group.id), None, None, "group-disabled", "");
        for serial in &group.members {
            logs.lock()
                .unwrap()
                .event(Some(&group.id), Some(serial), None, "sharing-disabled", "");
        }
    });
    Ok(Running {
        cancel,
        task,
        sessions,
        access,
        inventory,
    })
}
fn named<'a>(request: &str, group: &'a Group) -> Option<(&'a str, String)> {
    group
        .members
        .iter()
        .filter_map(|serial| {
            request
                .strip_prefix(&format!("host-serial:{serial}:"))
                .map(|command| (serial.as_str(), command.to_string()))
        })
        .max_by_key(|(s, _)| s.len())
}
fn allowed_command(command: &str) -> bool {
    matches!(
        command,
        "get-state" | "get-serialno" | "get-devpath" | "features" | "reconnect"
    ) || host::wait_spec(command).is_some()
}

fn port_mapping_error(request: &str) -> Option<&'static str> {
    const MESSAGE: &str =
        "ADBShare does not support port mapping (adb forward/reverse: create, list, or remove)";
    if request.starts_with("reverse:") {
        return Some(MESSAGE);
    }
    let command = ["host:", "host-usb:", "host-local:"]
        .iter()
        .find_map(|prefix| request.strip_prefix(prefix))
        .unwrap_or(request);
    (matches!(command, "list-forward" | "killforward-all")
        || command.starts_with("forward:")
        || command.starts_with("killforward:"))
    .then_some(MESSAGE)
}
#[allow(clippy::too_many_arguments)]
async fn handle(
    client: &mut TcpStream,
    group: &Group,
    upstream: u16,
    mut inventory: watch::Receiver<String>,
    sessions: &Sessions,
    id: u64,
    access: &Access,
    logs: &Logs,
) -> Result<()> {
    client.set_nodelay(true)?;
    let request = adb::read_frame(client).await?;
    // Device requests are recorded only after resolving their device scope, so
    // removing a member also removes requests that contain its serial or transport id.
    if matches!(
        request.as_str(),
        "host:devices"
            | "host:devices-l"
            | "host:track-devices"
            | "host:track-devices-l"
            | "host:track-devices-proto-text"
            | "host:track-devices-proto-binary"
            | "host:version"
            | "host:host-features"
            | "host:server-status"
            | "host:mdns:check"
    ) {
        logs.lock()
            .unwrap()
            .event(Some(&group.id), None, Some(id), "request", request.clone());
    }
    if matches!(
        request.as_str(),
        "host:track-devices-proto-text" | "host:track-devices-proto-binary"
    ) {
        return host::track_proto(
            client,
            upstream,
            request.ends_with("-text"),
            access,
            inventory,
        )
        .await;
    }
    if matches!(request.as_str(), "host:devices" | "host:devices-l") {
        let payload = adb::query(upstream, &request).await?;
        let members = access.lock().unwrap().keys().cloned().collect::<Vec<_>>();
        return adb::okay_frame(client, &adb::filter(&payload, &members)).await;
    }
    if matches!(
        request.as_str(),
        "host:track-devices" | "host:track-devices-l"
    ) {
        let long = request.ends_with("-l");
        let mut previous = None;
        client.write_all(b"OKAY").await?;
        loop {
            let members = access.lock().unwrap().keys().cloned().collect::<Vec<_>>();
            let list = adb::filter(&inventory.borrow().clone(), &members);
            let list = if long {
                list
            } else {
                adb::devices(&list)
                    .iter()
                    .map(|d| format!("{}\t{}\n", d.serial, d.state))
                    .collect()
            };
            if previous.as_ref() != Some(&list) {
                adb::frame(client, &list).await?;
                previous = Some(list);
            }
            let mut eof = [0; 1];
            tokio::select! {r=inventory.changed()=>{r?;},_=client.read(&mut eof)=>return Ok(())}
        }
    }
    if matches!(
        request.as_str(),
        "host:version" | "host:host-features" | "host:server-status" | "host:mdns:check"
    ) {
        let mut server = adb::connect(upstream).await?;
        adb::frame(&mut server, &request).await?;
        adb::read_status(&mut server).await?;
        let result = adb::read_frame_bytes(&mut server).await?;
        client.write_all(b"OKAY").await?;
        return adb::frame_bytes(client, &result).await;
    }
    if let Some((selector, command)) = host::device_request(&request, group) {
        if !allowed_command(&command) {
            return Err(port_mapping_error(&command)
                .unwrap_or("host command denied by ADBShare")
                .into());
        }
        if let Some(spec) = host::wait_spec(&command) {
            let token = match &selector {
                host::Selector::Kind(_) => {
                    logs.lock().unwrap().event(
                        Some(&group.id),
                        None,
                        Some(id),
                        "request",
                        request.clone(),
                    );
                    None
                }
                _ => {
                    let serial = host::resolve_current(upstream, &selector, access).await?;
                    Some(select_device(
                        access, sessions, logs, group, &serial, id, &request,
                    )?)
                }
            };
            let wait = host::wait(client, upstream, &selector, &spec, access, inventory);
            return if let Some(token) = token {
                tokio::select! { _=token.cancelled()=>Ok(()), result=wait=>result }
            } else {
                wait.await
            };
        }
        let serial = host::resolve_current(upstream, &selector, access).await?;
        let token = select_device(access, sessions, logs, group, &serial, id, &request)?;
        return tokio::select! { _=token.cancelled()=>Ok(()), result=async {
            let mut server=adb::connect(upstream).await?;
            adb::frame(&mut server,&format!("host-serial:{serial}:{command}")).await?;
            relay(client,&mut server,logs,group,&serial,id,&token).await
        }=>result };
    }
    let modern = request.starts_with("host:tport:");
    let serial = if let Some(serial) = request
        .strip_prefix("host:transport:")
        .or_else(|| request.strip_prefix("host:tport:serial:"))
    {
        serial.to_owned()
    } else if request.starts_with("host:transport-id:") || request.starts_with("host-transport-id:")
    {
        let prefix = if request.starts_with("host:transport-id:") {
            "host:transport-id:"
        } else {
            "host-transport-id:"
        };
        let suffix = request.strip_prefix(prefix).unwrap();
        let list = adb::query(upstream, "host:devices-l").await?;
        let device = adb::devices(&list)
            .into_iter()
            .find(|d| d.transport_id == suffix && group.members.contains(&d.serial))
            .ok_or("transport id is not assigned to this group")?;
        device.serial
    } else if [
        "host:transport-any",
        "host:transport-usb",
        "host:transport-local",
        "host:tport:any",
        "host:tport:usb",
        "host:tport:local",
    ]
    .contains(&request.as_str())
    {
        let list = adb::query(upstream, "host:devices-l").await?;
        let kind = if request.ends_with("usb") {
            Some("usb")
        } else if request.ends_with("local") {
            Some("local")
        } else {
            None
        };
        host::resolve(&list, &host::Selector::Kind(kind), access)?
    } else {
        return Err(port_mapping_error(&request)
            .unwrap_or("host request denied or unsupported by ADBShare")
            .into());
    };
    if !group.members.contains(&serial) {
        return Err("device is not assigned to this group".into());
    }
    let token = select_device(access, sessions, logs, group, &serial, id, &request)?;
    tokio::select! {
        _ = token.cancelled() => Ok(()),
        result = async {
    let mut server = adb::connect(upstream).await?;
    adb::frame(
        &mut server,
        &format!(
            "{}{}",
            if modern {
                "host:tport:serial:"
            } else {
                "host:transport:"
            },
            serial
        ),
    )
    .await?;
    adb::read_status(&mut server).await?;
    client.write_all(b"OKAY").await?;
    if modern {
        let mut tid = [0; 8];
        tokio::time::timeout(Duration::from_secs(8), server.read_exact(&mut tid)).await??;
        client.write_all(&tid).await?;
    }
    // Inspect the service before entering byte-stream mode. Server host commands must
    // not bypass the group boundary through an already selected smart socket.
    let service = adb::read_frame(client).await?;
    if service.starts_with("host") || service.starts_with("reverse:") {
        let command = named(&service, group).map(|(_, command)| command);
        return Err(port_mapping_error(command.as_deref().unwrap_or(&service))
            .unwrap_or("service denied by ADBShare (host)")
            .into());
    }
    logs.lock().unwrap().event(Some(&group.id),Some(&serial),Some(id),"service",service.clone());
    adb::frame(&mut server, &service).await?;
    relay(client, &mut server, logs, group, &serial, id, &token).await?;
    Ok(())
        } => result
    }
}

#[allow(clippy::too_many_arguments)]
fn select_device(
    access: &Access,
    sessions: &Sessions,
    logs: &Logs,
    group: &Group,
    serial: &str,
    id: u64,
    request: &str,
) -> Result<CancellationToken> {
    let access = access.lock().unwrap();
    let token = access
        .get(serial)
        .ok_or("device is disabled or not assigned to this group")?
        .clone();
    sessions.lock().unwrap().get_mut(&id).unwrap().serial = serial.into();
    logs.lock()
        .unwrap()
        .event(Some(&group.id), Some(serial), Some(id), "request", request);
    Ok(token)
}

// Observe the original bytes without decoding, altering framing, or accumulating a full stream.
struct Observed<'a> {
    stream: &'a mut TcpStream,
    logs: &'a Logs,
    group: &'a str,
    serial: &'a str,
    id: u64,
    direction: &'a str,
}
impl AsyncRead for Observed<'_> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let before = buf.filled().len();
        let result = Pin::new(&mut *self.stream).poll_read(cx, buf);
        if let Poll::Ready(Ok(())) = &result {
            let bytes = &buf.filled()[before..];
            if !bytes.is_empty() {
                self.logs.lock().unwrap().payload(
                    self.group,
                    self.serial,
                    self.id,
                    self.direction,
                    bytes,
                );
            }
        }
        result
    }
}
impl AsyncWrite for Observed<'_> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut *self.stream).poll_write(cx, data)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut *self.stream).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut *self.stream).poll_shutdown(cx)
    }
}
#[allow(clippy::too_many_arguments)]
async fn relay(
    client: &mut TcpStream,
    server: &mut TcpStream,
    logs: &Logs,
    group: &Group,
    serial: &str,
    id: u64,
    token: &CancellationToken,
) -> Result<()> {
    let mut client = Observed {
        stream: client,
        logs,
        group: &group.id,
        serial,
        id,
        direction: "send",
    };
    let mut server = Observed {
        stream: server,
        logs,
        group: &group.id,
        serial,
        id,
        direction: "receive",
    };
    tokio::select! { _=token.cancelled()=>{}, result=tokio::io::copy_bidirectional(&mut client,&mut server)=>{result?;} }
    Ok(())
}
