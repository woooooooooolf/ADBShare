use crate::{
    gateway::{self, Logs, Running, Session},
    model::{self, Config},
    protocol,
};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::{Emitter, Manager, State};
use tokio::sync::Mutex;

pub struct App {
    pub path: PathBuf,
    pub inner: Mutex<Inner>,
    pub logs: Logs,
    pub config_error: Option<String>,
    pub firewall: Arc<crate::firewall::Firewall>,
    pub shutting_down: AtomicBool,
    pub shutdown_complete: AtomicBool,
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
    config_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    name: &'static str,
    version: &'static str,
    build_timestamp: u64,
    author: &'static str,
    license: &'static str,
}
#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "ADBShare",
        version: env!("CARGO_PKG_VERSION"),
        build_timestamp: env!("ADB_SHARE_BUILD_TIMESTAMP").parse().unwrap(),
        author: env!("CARGO_PKG_AUTHORS"),
        license: env!("CARGO_PKG_LICENSE"),
    }
}
fn third_party_sections() -> impl Iterator<Item = &'static str> {
    include_str!("../../THIRD_PARTY_NOTICES.txt")
        .split("\n============================================================================\n")
        .skip(1)
}
#[tauri::command]
pub fn third_party_components() -> Vec<ThirdPartyComponent> {
    third_party_sections()
        .filter_map(|section| {
            let mut lines = section.lines();
            let mut heading = lines.next()?.split_whitespace();
            Some(ThirdPartyComponent {
                name: heading.next()?,
                version: heading.next()?,
                license: lines.next()?.strip_prefix("License: ")?,
            })
        })
        .collect()
}
#[derive(Serialize)]
pub struct ThirdPartyComponent {
    name: &'static str,
    version: &'static str,
    license: &'static str,
}
#[tauri::command]
pub fn license_document() -> &'static str {
    include_str!("../../LICENSE")
}

#[cfg(test)]
mod license_tests {
    use super::*;

    #[test]
    fn component_table_covers_the_embedded_catalog_and_preserves_license_expressions() {
        let components = third_party_components();
        let expected: usize = include_str!("../../THIRD_PARTY_NOTICES.txt")
            .lines()
            .find_map(|line| line.strip_prefix("Components: "))
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(components.len(), expected);
        assert!(components
            .iter()
            .all(|c| !c.name.is_empty() && !c.version.is_empty() && !c.license.is_empty()));
        let api = components
            .iter()
            .find(|c| c.name == "@tauri-apps/api")
            .unwrap();
        assert_eq!(api.license, "Apache-2.0 OR MIT");
        let serialized = serde_json::to_value(&components).unwrap();
        assert!(serialized
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c.as_object().unwrap().len() == 3));
    }
}

impl App {
    pub async fn set_device_enabled(
        &self,
        id: &str,
        serial: &str,
        enabled: bool,
    ) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        self.ensure_open()?;
        if self.config_error.is_some() {
            return Err("请先修复配置读取错误".into());
        }
        let mut config = inner.config.clone();
        let group = config
            .groups
            .iter_mut()
            .find(|g| g.id == id)
            .ok_or("未找到分组")?;
        if !group.members.iter().any(|s| s == serial) {
            return Err("未找到设备".into());
        }
        group.disabled_members.retain(|s| s != serial);
        if !enabled {
            group.disabled_members.push(serial.into());
        }
        model::save(&self.path, &config)?;
        if let Some(r) = inner.running.get(id) {
            r.set_device_enabled(serial, enabled);
        }
        inner.config = config;
        self.logs.lock().unwrap().event(
            Some(id),
            Some(serial),
            None,
            if enabled {
                "device-enabled"
            } else {
                "device-disabled"
            },
            "",
        );
        Ok(())
    }

    pub async fn start_group(&self, id: &str) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        self.ensure_open()?;
        if inner.running.contains_key(id) {
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
        if !group.address.is_loopback() {
            let firewall = self.firewall.clone();
            let latest = group.clone();
            tokio::task::spawn_blocking(move || firewall.apply(&latest))
                .await
                .map_err(|e| e.to_string())??;
        }
        let running = gateway::start(group, inner.config.upstream_port, self.logs.clone())
            .await
            .map_err(|e| e.to_string())?;
        inner.running.insert(id.into(), running);
        Ok(())
    }
    pub async fn stop_group(&self, id: &str) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        if let Some(r) = inner.running.remove(id) {
            r.stop().await;
        }
        Ok(())
    }
    pub async fn update_firewall(&self, id: &str, remove: bool) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        self.ensure_open()?;
        let group = inner
            .config
            .groups
            .iter()
            .find(|g| g.id == id)
            .ok_or("未找到分组")?
            .clone();
        // Revocation happens even when elevation or rule removal subsequently fails.
        if remove {
            if let Some(r) = inner.running.remove(id) {
                r.stop().await;
            }
        } else if group.address.is_loopback() {
            return Err("仅本机模式不需要防火墙规则".into());
        }
        let firewall = self.firewall.clone();
        let group_id = id.to_owned();
        let id = id.to_owned();
        let result = tokio::task::spawn_blocking(move || {
            if remove {
                firewall.remove_group(&id)
            } else {
                firewall.apply(&group)
            }
        })
        .await
        .map_err(|e| e.to_string())?;
        self.logs.lock().unwrap().event(
            Some(&group_id),
            None,
            None,
            if result.is_err() {
                "error"
            } else if remove {
                "rules-removed"
            } else {
                "rules-applied"
            },
            result.as_ref().err().cloned().unwrap_or_default(),
        );
        result
    }

    pub fn ensure_open(&self) -> Result<(), String> {
        if self.shutting_down.load(Ordering::SeqCst) {
            return Err("正在退出并清理规则，请稍候".into());
        }
        Ok(())
    }
    pub async fn delete_group(&self, id: &str) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        self.ensure_open()?;
        if self.config_error.is_some() {
            return Err("请先修复配置读取错误".into());
        }
        if !inner.config.groups.iter().any(|g| g.id == id) {
            return Err("未找到分组".into());
        }
        if let Some(r) = inner.running.remove(id) {
            r.stop().await;
        }
        let firewall = self.firewall.clone();
        let target = id.to_owned();
        tokio::task::spawn_blocking(move || firewall.remove_group(&target))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| format!("共享已停止，但规则清理未完成；共享组已保留，可重试删除。{e}"))?;
        let mut config = inner.config.clone();
        config.groups.retain(|g| g.id != id);
        model::save(&self.path, &config)?;
        self.logs.lock().unwrap().configure(&config.groups);
        inner.config = config;
        Ok(())
    }
    pub async fn cleanup(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        for (_, r) in inner.running.drain() {
            r.stop().await;
        }
        let groups = inner.config.groups.clone();
        let firewall = self.firewall.clone();
        tokio::task::spawn_blocking(move || firewall.cleanup(&groups))
            .await
            .map_err(|e| e.to_string())?
    }
}

pub fn begin_shutdown(handle: tauri::AppHandle) {
    let app = handle.state::<App>();
    if app.shutting_down.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = handle.emit("shutdown-state", serde_json::json!({"error":null}));
    tauri::async_runtime::spawn(async move {
        let app = handle.state::<App>();
        match app.cleanup().await {
            Ok(()) => {
                app.shutdown_complete.store(true, Ordering::SeqCst);
                handle.exit(0);
            }
            Err(error) => {
                gateway::log(&app.logs, format!("退出清理失败：{error}"));
                app.shutting_down.store(false, Ordering::SeqCst);
                let _ = handle.emit("shutdown-state", serde_json::json!({"error":error}));
            }
        }
    });
}
#[tauri::command]
pub fn request_exit(handle: tauri::AppHandle) {
    begin_shutdown(handle);
}
#[tauri::command]
pub async fn delete_group(id: String, app: State<'_, App>) -> Result<(), String> {
    app.delete_group(&id).await
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
        config_error: app.config_error.clone(),
    })
}
#[tauri::command]
pub async fn discover(app: State<'_, App>) -> Result<Vec<protocol::Device>, String> {
    let port = app.inner.lock().await.config.upstream_port;
    let list = protocol::query(port, "host:devices-l")
        .await
        .map_err(|e| format!("无法连接本机 ADB Server (127.0.0.1:{port})：{e}"))?;
    let devices = protocol::devices(&list);
    app.logs.lock().unwrap().observe(&devices);
    Ok(devices)
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
    app.ensure_open()?;
    if inner
        .config
        .groups
        .iter()
        .any(|old| !config.groups.iter().any(|new| new.id == old.id))
    {
        return Err("请使用删除共享组操作，以自动清理规则".into());
    }
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
    {
        let mut history = app.logs.lock().unwrap();
        history.configure(&config.groups);
        for group in &config.groups {
            let before = inner.config.groups.iter().find(|g| g.id == group.id);
            for serial in &group.members {
                if before.is_none_or(|g| !g.members.contains(serial)) {
                    history.event(Some(&group.id), Some(serial), None, "device-added", "");
                }
            }
        }
    }
    inner.config = config;
    Ok(())
}
#[tauri::command]
pub async fn start_group(id: String, app: State<'_, App>) -> Result<(), String> {
    app.start_group(&id).await
}
#[tauri::command]
pub async fn stop_group(id: String, app: State<'_, App>) -> Result<(), String> {
    app.stop_group(&id).await
}
#[tauri::command]
pub async fn start_adb(app: State<'_, App>) -> Result<(), String> {
    let inner = app.inner.lock().await;
    app.ensure_open()?;
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

#[tauri::command]
pub async fn firewall(id: String, remove: bool, app: State<'_, App>) -> Result<(), String> {
    app.update_firewall(&id, remove).await
}

#[tauri::command]
pub async fn history_view(
    group_id: Option<String>,
    serial: Option<String>,
    app: State<'_, App>,
) -> Result<crate::history::View, String> {
    if serial.is_some() && group_id.is_none() {
        return Err("Device history requires a group".into());
    }
    Ok(app
        .logs
        .lock()
        .unwrap()
        .view(group_id.as_deref(), serial.as_deref()))
}
#[tauri::command]
pub async fn reset_history(
    group_id: Option<String>,
    serial: Option<String>,
    app: State<'_, App>,
) -> Result<(), String> {
    if serial.is_some() && group_id.is_none() {
        return Err("Device history requires a group".into());
    }
    app.logs
        .lock()
        .unwrap()
        .reset(group_id.as_deref(), serial.as_deref());
    Ok(())
}
#[tauri::command]
pub async fn set_device_enabled(
    id: String,
    serial: String,
    enabled: bool,
    app: State<'_, App>,
) -> Result<(), String> {
    app.set_device_enabled(&id, &serial, enabled).await
}
#[tauri::command]
pub async fn export_history(content: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        if content.len() > 64*1024*1024 { return Err("Export is too large".into()); }
        // The dialog chooses the destination; record contents never enter shell code.
        let script = r#"$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Windows.Forms; $owner=New-Object Windows.Forms.Form; $owner.TopMost=$true; $d=New-Object Windows.Forms.SaveFileDialog; $d.Filter='Text files (*.txt)|*.txt'; $d.FileName='ADBShare-history.txt'; try { if ($d.ShowDialog($owner) -eq 'OK') { [Console]::Write($d.FileName) } } finally { $d.Dispose(); $owner.Dispose() }"#;
        let output=command("powershell.exe").args(["-NoProfile","-NonInteractive","-STA","-Command",script]).output().map_err(|e|e.to_string())?;
        if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).into_owned()); }
        let path=String::from_utf8(output.stdout).map_err(|e|e.to_string())?;
        let path=path.trim_start_matches('\u{feff}');
        if path.is_empty() { return Ok(false); }
        std::fs::write(path,content).map_err(|e|e.to_string())?;
        Ok(true)
    }).await.map_err(|e|e.to_string())?
}
