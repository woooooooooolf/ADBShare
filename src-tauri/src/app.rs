use crate::{
    gateway::{self, Logs, Running, Session},
    model::{self, Config, Group},
    protocol,
};
use serde::Serialize;
use std::{collections::HashMap, path::PathBuf, process::Command};
use tauri::State;
use tokio::sync::Mutex;

pub struct App {
    pub path: PathBuf,
    pub inner: Mutex<Inner>,
    pub logs: Logs,
    pub config_error: Option<String>,
}
pub struct Inner {
    pub config: Config,
    pub running: HashMap<String, Running>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Interface {
    name: String,
    address: String,
    cidr: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Runtime {
    id: String,
    status: String,
    sessions: Vec<Session>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    config: Config,
    runtime: Vec<Runtime>,
    interfaces: Vec<Interface>,
    config_path: String,
    logs: Vec<String>,
    config_error: Option<String>,
}

pub fn interfaces() -> Vec<Interface> {
    let mut result = vec![Interface {
        name: "仅本机测试".into(),
        address: "127.0.0.1".into(),
        cidr: "127.0.0.0/8".into(),
    }];
    if let Ok(list) = if_addrs::get_if_addrs() {
        for i in list {
            if let if_addrs::IfAddr::V4(v) = i.addr {
                if v.ip.is_loopback() || v.ip.is_link_local() || v.ip.is_unspecified() {
                    continue;
                }
                result.push(Interface {
                    name: i.name,
                    address: v.ip.to_string(),
                    cidr: format!(
                        "{}/{}",
                        std::net::Ipv4Addr::from(u32::from(v.ip) & u32::from(v.netmask)),
                        u32::from(v.netmask).count_ones()
                    ),
                });
            }
        }
    }
    result.sort_by(|a, b| a.address.cmp(&b.address));
    result.dedup_by(|a, b| a.address == b.address);
    result
}
pub fn config_path() -> PathBuf {
    std::env::var_os("ADB_SHARE_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::current_exe()
                .unwrap()
                .parent()
                .unwrap()
                .join("data")
        })
        .join("config.json")
}
pub fn command(program: &str) -> Command {
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000);
    }
    c
}
#[tauri::command]
pub async fn snapshot(app: State<'_, App>) -> Result<Snapshot, String> {
    let inner = app.inner.lock().await;
    let runtime = inner
        .running
        .iter()
        .map(|(id, r)| Runtime {
            id: id.clone(),
            status: if r.task.is_finished() {
                "failed"
            } else {
                "running"
            }
            .into(),
            sessions: r.sessions.lock().unwrap().values().cloned().collect(),
        })
        .collect();
    Ok(Snapshot {
        config: inner.config.clone(),
        runtime,
        interfaces: interfaces(),
        config_path: app.path.display().to_string(),
        logs: app.logs.lock().unwrap().clone(),
        config_error: app.config_error.clone(),
    })
}
#[tauri::command]
pub async fn discover(app: State<'_, App>) -> Result<Vec<protocol::Device>, String> {
    let port = app.inner.lock().await.config.upstream_port;
    let list = protocol::query(port, "host:devices-l")
        .await
        .map_err(|e| format!("无法连接本机 ADB Server (127.0.0.1:{port})：{e}"))?;
    Ok(protocol::devices(&list))
}
#[tauri::command]
pub async fn save_config(config: Config, app: State<'_, App>) -> Result<(), String> {
    if let Some(error) = &app.config_error {
        return Err(format!(
            "原配置无法读取，为避免覆盖，请修复或移走 {} 后重启：{error}",
            app.path.display()
        ));
    }
    config.validate()?;
    let mut inner = app.inner.lock().await;
    if !inner.running.is_empty() && config.upstream_port != inner.config.upstream_port {
        return Err("请先停止全部共享，再修改上游端口".into());
    }
    for id in inner.running.keys() {
        let before = inner.config.groups.iter().find(|g| &g.id == id);
        let after = config.groups.iter().find(|g| &g.id == id);
        if serde_json::to_value(before).unwrap() != serde_json::to_value(after).unwrap() {
            return Err("请先停止该组，再修改或删除".into());
        }
    }
    model::save(&app.path, &config)?;
    inner.config = config;
    Ok(())
}
#[tauri::command]
pub async fn start_group(id: String, app: State<'_, App>) -> Result<(), String> {
    let mut inner = app.inner.lock().await;
    if inner.running.contains_key(&id) {
        return Err("该组已运行，请先停止".into());
    }
    let group = inner
        .config
        .groups
        .iter()
        .find(|g| g.id == id)
        .ok_or("未找到分组")?
        .clone();
    if group.members.is_empty() {
        return Err("请先选择至少一台设备".into());
    }
    let running = gateway::start(group, inner.config.upstream_port, app.logs.clone())
        .await
        .map_err(|e| e.to_string())?;
    inner.running.insert(id, running);
    Ok(())
}
#[tauri::command]
pub async fn stop_group(id: String, app: State<'_, App>) -> Result<(), String> {
    let mut inner = app.inner.lock().await;
    if let Some(r) = inner.running.remove(&id) {
        r.stop().await;
    }
    Ok(())
}
#[tauri::command]
pub async fn start_adb(app: State<'_, App>) -> Result<(), String> {
    let inner = app.inner.lock().await;
    let path = inner.config.adb_path.clone();
    let port = inner.config.upstream_port;
    drop(inner);
    let result = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        let mut cmd = tokio::process::Command::new(path);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        cmd.args(["-P", &port.to_string(), "start-server"])
            .kill_on_drop(true)
            .output()
            .await
    })
    .await
    .map_err(|_| "启动 ADB 超时".to_string())?
    .map_err(|e| e.to_string())?;
    if result.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&result.stderr).to_string())
    }
}
// Firewall management is explicit. The main UI and gateway remain unprivileged.
#[tauri::command]
pub async fn firewall(id: String, remove: bool, app: State<'_, App>) -> Result<(), String> {
    let inner = app.inner.lock().await;
    let group = inner
        .config
        .groups
        .iter()
        .find(|g| g.id == id)
        .ok_or("未找到分组")?
        .clone();
    drop(inner);
    if group.address.is_loopback() {
        return Err("仅本机模式不需要防火墙规则".into());
    }
    tokio::task::spawn_blocking(move || elevate_firewall(&group, remove))
        .await
        .map_err(|e| e.to_string())?
}
fn elevate_firewall(group: &Group, remove: bool) -> Result<(), String> {
    if !cfg!(windows) {
        return Err("此原型仅实现 Windows 防火墙配置".into());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let quote = |s: &str| format!("'{}'", s.replace('\'', "''"));
    let args = format!(
        "--firewall-helper {} {} {} {} {}",
        if remove { "remove" } else { "add" },
        group.id,
        group.address,
        group.port,
        group.sources.join(",")
    );
    let script=format!("$ErrorActionPreference='Stop'; try {{ $p=Start-Process -FilePath {} -ArgumentList {} -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode }} catch {{ Write-Error $_; exit 1 }}",quote(&exe.to_string_lossy()),quote(&args));
    let result = command("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|e| e.to_string())?;
    if result.status.success() {
        Ok(())
    } else {
        Err(format!(
            "防火墙配置未完成（可能取消了 UAC）：{}",
            String::from_utf8_lossy(&result.stderr)
        ))
    }
}
pub fn firewall_helper(args: &[String]) -> Result<(), String> {
    if args.len() != 6 {
        return Err("Invalid firewall arguments".into());
    }
    uuid::Uuid::parse_str(&args[2]).map_err(|e| e.to_string())?;
    let address: std::net::Ipv4Addr = args[3].parse().map_err(|_| "Invalid IPv4")?;
    let port: u16 = args[4].parse().map_err(|_| "Invalid port")?;
    if port == 0 || address.is_unspecified() {
        return Err("Invalid endpoint".into());
    }
    for source in args[5].split(',') {
        model::Network::parse(source)?;
    }
    let name = format!("name=ADBShare-{}", args[2]);
    let result = command("netsh.exe")
        .args(["advfirewall", "firewall", "delete", "rule", &name])
        .output()
        .map_err(|e| e.to_string())?;
    // netsh returns failure if no matching rule exists; replacement still proceeds.
    if args[1] == "remove" {
        let _ = result;
        return Ok(());
    }
    if args[1] != "add" {
        return Err("Invalid firewall operation".into());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let result = command("netsh.exe")
        .args([
            "advfirewall",
            "firewall",
            "add",
            "rule",
            &name,
            "dir=in",
            "action=allow",
            "protocol=TCP",
            &format!("localport={port}"),
            &format!("localip={address}"),
            &format!("remoteip={}", args[5]),
            &format!("program={}", exe.display()),
            "profile=private,domain",
            "enable=yes",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    if result.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&result.stdout).to_string())
    }
}
