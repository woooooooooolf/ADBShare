use crate::{
    model::{Group, Network},
    protocol::{self as adb, Result},
};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    net::IpAddr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{watch, Semaphore},
    task::{JoinHandle, JoinSet},
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: u64,
    pub peer: String,
    pub serial: String,
    pub since: u64,
}
pub type Sessions = Arc<Mutex<BTreeMap<u64, Session>>>;
pub type Logs = Arc<Mutex<Vec<String>>>;
pub fn log(logs: &Logs, message: impl AsRef<str>) {
    let mut l = logs.lock().unwrap();
    l.push(format!(
        "{} {}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        message.as_ref()
    ));
    if l.len() > 200 {
        l.remove(0);
    }
}
pub struct Running {
    pub cancel: CancellationToken,
    pub task: JoinHandle<()>,
    pub sessions: Sessions,
}
impl Running {
    pub async fn stop(self) {
        self.cancel.cancel();
        let _ = self.task.await;
    }
}
struct SessionGuard(Sessions, u64);
impl Drop for SessionGuard {
    fn drop(&mut self) {
        self.0.lock().unwrap().remove(&self.1);
    }
}

pub async fn start(group: Group, upstream: u16, logs: Logs) -> Result<Running> {
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
    let task = tokio::spawn(async move {
        log(
            &logs,
            format!("{}：开始共享 {}:{}", group.name, group.address, group.port),
        );
        let (tx, rx) = watch::channel(String::new());
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
        let counter = AtomicU64::new(1);
        loop {
            tokio::select! {
                _=stop.cancelled()=>break,
                Some(_)=jobs.join_next()=>{},
                accepted=listener.accept()=>{
                    let (mut client,peer)=match accepted {Ok(v)=>v,Err(e)=>{log(&logs,format!("监听失败：{e}"));break;}};
                    let allowed=match peer.ip() {IpAddr::V4(ip)=>ip.is_loopback() || ranges.iter().any(|r|r.contains(ip)),_=>false};
                    let permit=limit.clone().try_acquire_owned();
                    if !allowed || permit.is_err() {log(&logs,format!("拒绝连接 {peer}"));continue;}
                    let permit=permit.unwrap();let group=group.clone();let logs=logs.clone();let sessions=live.clone();let stop=stop.clone();let rx=rx.clone();
                    let id=counter.fetch_add(1,Ordering::Relaxed);
                    jobs.spawn(async move {
                        let _permit=permit;
                        sessions.lock().unwrap().insert(id,Session {id,peer:peer.to_string(),serial:"协商中".into(),since:SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()});
                        let _guard=SessionGuard(sessions.clone(),id);
                        let result=tokio::select! {_=stop.cancelled()=>Ok(()),result=handle(&mut client,&group,upstream,rx,&sessions,id)=>result};
                        if let Err(e)=result {let _=adb::fail(&mut client,&e.to_string()).await;log(&logs,format!("{} · {peer}：{e}",group.name));}
                    });
                }
            }
        }
        drop(listener);
        jobs.abort_all();
        while jobs.join_next().await.is_some() {}
        log(&logs, format!("{}：已停止，连接已关闭", group.name));
    });
    Ok(Running {
        cancel,
        task,
        sessions,
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
        "get-state" | "get-serialno" | "get-devpath" | "features"
    ) || ["wait-for-any-", "wait-for-usb-", "wait-for-local-"]
        .iter()
        .any(|p| {
            command.strip_prefix(p).is_some_and(|s| {
                matches!(
                    s,
                    "device" | "recovery" | "rescue" | "sideload" | "disconnect"
                )
            })
        })
}
async fn handle(
    client: &mut TcpStream,
    group: &Group,
    upstream: u16,
    mut inventory: watch::Receiver<String>,
    sessions: &Sessions,
    id: u64,
) -> Result<()> {
    client.set_nodelay(true)?;
    let request = adb::read_frame(client).await?;
    if matches!(request.as_str(), "host:devices" | "host:devices-l") {
        let payload = adb::query(upstream, &request).await?;
        return adb::okay_frame(client, &adb::filter(&payload, &group.members)).await;
    }
    if matches!(
        request.as_str(),
        "host:track-devices" | "host:track-devices-l"
    ) {
        let long = request.ends_with("-l");
        let mut previous = None;
        client.write_all(b"OKAY").await?;
        loop {
            let list = adb::filter(&inventory.borrow().clone(), &group.members);
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
        "host:version" | "host:host-features" | "host:features"
    ) {
        let result = adb::query(upstream, &request).await?;
        let result = if request == "host:version" {
            result
        } else {
            result
                .split(',')
                .filter(|f| !f.contains("proto"))
                .collect::<Vec<_>>()
                .join(",")
        };
        return adb::okay_frame(client, &result).await;
    }
    if let Some((serial, command)) = named(&request, group) {
        if !allowed_command(&command) {
            return Err("host command denied by ADBShare".into());
        }
        sessions.lock().unwrap().get_mut(&id).unwrap().serial = serial.into();
        let mut server = adb::connect(upstream).await?;
        adb::frame(&mut server, &request).await?;
        tokio::io::copy_bidirectional(client, &mut server).await?;
        return Ok(());
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
        let (tid, command) = suffix
            .split_once(':')
            .map_or((suffix, None), |(a, b)| (a, Some(b)));
        let list = adb::query(upstream, "host:devices-l").await?;
        let device = adb::devices(&list)
            .into_iter()
            .find(|d| d.transport_id == tid && group.members.contains(&d.serial))
            .ok_or("transport id is not assigned to this group")?;
        if let Some(command) = command {
            if !allowed_command(command) {
                return Err("host command denied by ADBShare".into());
            }
            sessions.lock().unwrap().get_mut(&id).unwrap().serial = device.serial.clone();
            let mut server = adb::connect(upstream).await?;
            adb::frame(
                &mut server,
                &format!("host-serial:{}:{command}", device.serial),
            )
            .await?;
            tokio::io::copy_bidirectional(client, &mut server).await?;
            return Ok(());
        }
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
        let candidates: Vec<_> = adb::devices(&list)
            .into_iter()
            .filter(|d| group.members.contains(&d.serial) && kind.is_none_or(|k| d.kind == k))
            .collect();
        if candidates.len() != 1 {
            return Err("specify a serial: expected exactly one matching assigned device".into());
        }
        candidates[0].serial.clone()
    } else {
        return Err("host request denied or unsupported by ADBShare".into());
    };
    if !group.members.contains(&serial) {
        return Err("device is not assigned to this group".into());
    }
    sessions.lock().unwrap().get_mut(&id).unwrap().serial = serial.clone();
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
        return Err("service denied by ADBShare (host/reverse)".into());
    }
    adb::frame(&mut server, &service).await?;
    tokio::io::copy_bidirectional(client, &mut server).await?;
    Ok(())
}
