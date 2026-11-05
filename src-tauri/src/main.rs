#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use adbshare::{
    about,
    app::{self, App, Inner},
    gateway, history, model, platform,
};
#[cfg(windows)]
use std::sync::Arc;
use std::{
    collections::HashMap,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::Manager;

fn main() {
    if let Err(error) = platform::check_user() {
        eprintln!("{error}");
        std::process::exit(1);
    }
    let args: Vec<_> = std::env::args().skip(1).collect();
    #[cfg(windows)]
    if args.first().is_some_and(|a| a == "--firewall-helper") {
        std::process::exit(if adbshare::firewall::helper(&args).is_ok() {
            0
        } else {
            1
        });
    }
    if args.first().is_some_and(|a| a == "--headless") {
        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(headless(args.get(1)));
        if let Err(e) = result {
            eprintln!("{e}");
            std::process::exit(1);
        }
        return;
    }
    let mut builder = tauri::Builder::default();
    // Explicit data overrides are reserved for isolated tests/development profiles.
    // They must not focus or terminate a user's normal application instance.
    if std::env::var_os("ADB_SHARE_DATA_DIR").is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|handle, _, _| {
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            app::snapshot,
            app::discover,
            app::save_config,
            app::start_group,
            app::stop_group,
            app::start_adb,
            app::firewall,
            app::delete_group,
            app::request_exit,
            about::app_info,
            about::license_document,
            about::third_party_components,
            adbshare::fonts::chinese_font_support,
            app::history_view,
            app::reset_history,
            app::set_device_enabled,
            app::export_history
        ])
        .setup(|app| {
            let path = app::config_path(app.handle())?;
            // Corrupt configuration is surfaced to the user, never silently overwritten.
            let (config, error) = match model::load(&path) {
                Ok(c) => (c, None),
                Err(e) => (model::Config::default(), Some(e)),
            };
            let logs = history::Logs::default();
            logs.lock().unwrap().configure(&config.groups);
            if let Some(e) = &error {
                history::log(
                    &logs,
                    format!("配置加载失败，请检查 {}：{e}", path.display()),
                );
            }
            #[cfg(windows)]
            let firewall = Some(Arc::new(adbshare::firewall::Firewall {
                ledger: path.with_file_name("firewall-rules.json"),
                backend: Arc::new(adbshare::firewall::Windows),
            }));
            #[cfg(not(windows))]
            let firewall = None;
            app.manage(App {
                firewall,
                shutting_down: AtomicBool::new(false),
                shutdown_complete: AtomicBool::new(false),
                path,
                inner: tokio::sync::Mutex::new(Inner {
                    config,
                    running: HashMap::new(),
                }),
                logs,
                config_error: error,
            });
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let state = handle.state::<App>();
                    let port = state.inner.lock().await.config.upstream_port;
                    let result = adbshare::protocol::query(port, "host:devices-l").await;
                    let inner = state.inner.lock().await;
                    if inner.config.upstream_port == port {
                        state
                            .logs
                            .lock()
                            .unwrap()
                            .observe(&adbshare::protocol::devices(&result.unwrap_or_default()));
                    }
                    drop(inner);
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !window
                    .state::<App>()
                    .shutdown_complete
                    .load(Ordering::SeqCst)
                {
                    api.prevent_close();
                    app::begin_shutdown(window.app_handle().clone());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("创建 ADBShare 窗口失败")
        .run(|handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !handle
                    .state::<App>()
                    .shutdown_complete
                    .load(Ordering::SeqCst)
                {
                    api.prevent_exit();
                    app::begin_shutdown(handle.clone());
                }
            }
        });
}
async fn headless(path: Option<&String>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let config = model::load(std::path::Path::new(
        path.ok_or("--headless requires config path")?,
    ))?;
    let mut running = vec![];
    let logs = history::Logs::default();
    logs.lock().unwrap().configure(&config.groups);
    for group in config.groups {
        running.push(gateway::start(group, config.upstream_port, logs.clone()).await?);
    }
    println!("ADBShare READY");
    tokio::signal::ctrl_c().await?;
    for r in running {
        r.stop().await;
    }
    Ok(())
}
