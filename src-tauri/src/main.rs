#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use adbshare::{
    app::{self, App, Inner},
    gateway, model,
};
use std::collections::HashMap;
use tauri::Manager;

fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|a| a == "--firewall-helper") {
        std::process::exit(if app::firewall_helper(&args).is_ok() {
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
    let path = app::config_path();
    // Corrupt configuration is surfaced to the user, never silently overwritten.
    let (config, error) = match model::load(&path) {
        Ok(c) => (c, None),
        Err(e) => (model::Config::default(), Some(e)),
    };
    let logs = gateway::Logs::default();
    if let Some(e) = &error {
        gateway::log(
            &logs,
            format!("配置加载失败，请检查 {}：{e}", path.display()),
        );
    }
    tauri::Builder::default()
        .manage(App {
            path,
            inner: tokio::sync::Mutex::new(Inner {
                config,
                running: HashMap::new(),
            }),
            logs,
            config_error: error,
        })
        .invoke_handler(tauri::generate_handler![
            app::snapshot,
            app::discover,
            app::save_config,
            app::start_group,
            app::stop_group,
            app::start_adb,
            app::firewall
        ])
        .build(tauri::generate_context!())
        .expect("创建 ADBShare 窗口失败")
        .run(|handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let app = handle.state::<App>();
                tauri::async_runtime::block_on(async {
                    let mut inner = app.inner.lock().await;
                    for (_, r) in inner.running.drain() {
                        r.stop().await;
                    }
                });
            }
        });
}
async fn headless(path: Option<&String>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let config = model::load(std::path::Path::new(
        path.ok_or("--headless requires config path")?,
    ))?;
    let mut running = vec![];
    let logs = gateway::Logs::default();
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
