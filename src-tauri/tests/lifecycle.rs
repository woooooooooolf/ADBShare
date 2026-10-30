use adbshare::{
    app::{App, Inner},
    firewall::{Backend, Firewall},
    gateway,
    model::{self, Config, Group},
    protocol,
};
use std::{
    collections::{BTreeSet, HashMap},
    sync::{
        atomic::{AtomicBool, AtomicU16, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::net::{TcpListener, TcpStream};

#[derive(Default)]
struct Fake {
    rules: Mutex<BTreeSet<String>>,
    batches: Mutex<Vec<BTreeSet<String>>>,
    fail: AtomicBool,
    ignore_remove: AtomicBool,
    stopped_port: AtomicU16,
}
impl Backend for Fake {
    fn existing(&self, _: &BTreeSet<String>) -> Result<BTreeSet<String>, String> {
        Ok(self.rules.lock().unwrap().clone())
    }
    fn apply(&self, g: &Group) -> Result<(), String> {
        self.rules.lock().unwrap().insert(g.id.clone());
        Ok(())
    }
    fn remove(&self, ids: &BTreeSet<String>) -> Result<(), String> {
        let port = self.stopped_port.load(Ordering::SeqCst);
        if port != 0 {
            assert!(
                std::net::TcpStream::connect(("127.0.0.1", port)).is_err(),
                "listener must stop before firewall cleanup"
            );
        }
        self.batches.lock().unwrap().push(ids.clone());
        if self.fail.load(Ordering::SeqCst) {
            return Err("UAC canceled (simulated)".into());
        }
        if !self.ignore_remove.load(Ordering::SeqCst) {
            self.rules.lock().unwrap().retain(|id| !ids.contains(id));
        }
        Ok(())
    }
}
fn group() -> Group {
    Group {
        id: uuid::Uuid::new_v4().to_string(),
        name: "Test".into(),
        address: "127.0.0.1".parse().unwrap(),
        port: 15037,
        sources: vec!["127.0.0.1".into()],
        members: vec!["A".into()],
    }
}
fn app(dir: &std::path::Path, groups: Vec<Group>, backend: Arc<Fake>) -> App {
    let config = Config {
        groups,
        ..Default::default()
    };
    let path = dir.join("config.json");
    model::save(&path, &config).unwrap();
    App {
        path,
        inner: tokio::sync::Mutex::new(Inner {
            config,
            running: HashMap::new(),
        }),
        logs: Default::default(),
        config_error: None,
        firewall: Arc::new(Firewall {
            ledger: dir.join("firewall-rules.json"),
            backend,
        }),
        shutting_down: AtomicBool::new(false),
        shutdown_complete: AtomicBool::new(false),
    }
}
#[tokio::test]
async fn delete_stops_listener_before_cleanup_and_removes_config() {
    let dir = tempfile::tempdir().unwrap();
    let backend = Arc::new(Fake::default());
    let mut g = group();
    let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    g.port = probe.local_addr().unwrap().port();
    drop(probe);
    let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = upstream.local_addr().unwrap().port();
    let upstream_task = tokio::spawn(async move {
        loop {
            let (mut s, _) = upstream.accept().await.unwrap();
            tokio::spawn(async move {
                let request = protocol::read_frame(&mut s).await.unwrap();
                let _ = protocol::okay_frame(
                    &mut s,
                    if request == "host:version" {
                        "0029"
                    } else {
                        ""
                    },
                )
                .await;
            });
        }
    });
    let app = app(dir.path(), vec![g.clone()], backend.clone());
    app.firewall.apply(&g).unwrap();
    let r = gateway::start(g.clone(), port, Default::default())
        .await
        .unwrap();
    let sessions = r.sessions.clone();
    app.inner.lock().await.running.insert(g.id.clone(), r);
    let mut c = TcpStream::connect((g.address, g.port)).await.unwrap();
    tokio::time::timeout(Duration::from_secs(2), async {
        while sessions.lock().unwrap().is_empty() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    backend.stopped_port.store(g.port, Ordering::SeqCst);
    app.delete_group(&g.id).await.unwrap();
    use tokio::io::AsyncReadExt;
    let mut byte = [0];
    assert_eq!(c.read(&mut byte).await.unwrap(), 0);
    assert!(backend.rules.lock().unwrap().is_empty());
    assert!(model::load(&app.path).unwrap().groups.is_empty());
    assert!(sessions.lock().unwrap().is_empty());
    upstream_task.abort();
}
#[tokio::test]
async fn failed_delete_keeps_group_and_cleanup_record_for_retry() {
    let dir = tempfile::tempdir().unwrap();
    let backend = Arc::new(Fake::default());
    let g = group();
    let app = app(dir.path(), vec![g.clone()], backend.clone());
    app.firewall.apply(&g).unwrap();
    backend.fail.store(true, Ordering::SeqCst);
    assert!(app
        .delete_group(&g.id)
        .await
        .unwrap_err()
        .contains("共享组已保留"));
    assert_eq!(model::load(&app.path).unwrap().groups[0].id, g.id);
    let ids: BTreeSet<String> =
        serde_json::from_slice(&std::fs::read(&app.firewall.ledger).unwrap()).unwrap();
    assert!(ids.contains(&g.id));
    backend.fail.store(false, Ordering::SeqCst);
    app.delete_group(&g.id).await.unwrap();
    assert!(model::load(&app.path).unwrap().groups.is_empty());
}
#[tokio::test]
async fn exit_batches_all_rules_including_legacy_orphans_and_keeps_groups() {
    let dir = tempfile::tempdir().unwrap();
    let backend = Arc::new(Fake::default());
    let a = group();
    let mut b = group();
    b.port += 1;
    let app = app(dir.path(), vec![a.clone(), b.clone()], backend.clone());
    app.firewall.apply(&a).unwrap();
    // Legacy/unrecorded rules returned by the backend must also be recovered.
    backend.rules.lock().unwrap().insert(b.id.clone());
    let orphan = uuid::Uuid::new_v4().to_string();
    backend.rules.lock().unwrap().insert(orphan);
    app.cleanup().await.unwrap();
    assert!(backend.rules.lock().unwrap().is_empty());
    assert_eq!(backend.batches.lock().unwrap().len(), 1);
    assert_eq!(model::load(&app.path).unwrap().groups.len(), 2);
    assert_eq!(backend.batches.lock().unwrap()[0].len(), 3);
}
#[tokio::test]
async fn failed_exit_remains_recoverable_after_restart() {
    let dir = tempfile::tempdir().unwrap();
    let backend = Arc::new(Fake::default());
    let g = group();
    let first = app(dir.path(), vec![g.clone()], backend.clone());
    first.firewall.apply(&g).unwrap();
    backend.fail.store(true, Ordering::SeqCst);
    assert!(first.cleanup().await.is_err());
    drop(first);
    backend.fail.store(false, Ordering::SeqCst);
    let second = app(dir.path(), vec![g], backend.clone());
    second.cleanup().await.unwrap();
    assert!(backend.rules.lock().unwrap().is_empty());
}

#[tokio::test]
async fn deleting_one_group_keeps_other_groups_rules_and_configuration() {
    let dir = tempfile::tempdir().unwrap();
    let backend = Arc::new(Fake::default());
    let a = group();
    let mut b = group();
    b.port += 1;
    let app = app(dir.path(), vec![a.clone(), b.clone()], backend.clone());
    app.firewall.apply(&a).unwrap();
    app.firewall.apply(&b).unwrap();
    app.delete_group(&a.id).await.unwrap();
    assert_eq!(
        *backend.rules.lock().unwrap(),
        BTreeSet::from([b.id.clone()])
    );
    assert_eq!(model::load(&app.path).unwrap().groups[0].id, b.id);
}
#[test]
fn cleanup_skips_elevation_when_no_rules_exist() {
    let dir = tempfile::tempdir().unwrap();
    let backend = Arc::new(Fake::default());
    let f = Firewall {
        ledger: dir.path().join("rules.json"),
        backend: backend.clone(),
    };
    f.cleanup(&[group()]).unwrap();
    assert!(backend.batches.lock().unwrap().is_empty());
    assert!(!f.ledger.exists());
}
#[test]
fn reports_rules_still_present_after_false_success() {
    let dir = tempfile::tempdir().unwrap();
    let backend = Arc::new(Fake::default());
    let f = Firewall {
        ledger: dir.path().join("rules.json"),
        backend: backend.clone(),
    };
    let g = group();
    f.apply(&g).unwrap();
    backend.ignore_remove.store(true, Ordering::SeqCst);
    assert!(f.remove_group(&g.id).unwrap_err().contains("仍存在"));
    let pending: BTreeSet<String> =
        serde_json::from_slice(&std::fs::read(&f.ledger).unwrap()).unwrap();
    assert!(pending.contains(&g.id));
}
#[test]
fn corrupt_cleanup_records_are_not_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("rules.json");
    std::fs::write(&path, b"broken").unwrap();
    let f = Firewall {
        ledger: path.clone(),
        backend: Arc::new(Fake::default()),
    };
    assert!(f.cleanup(&[]).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"broken");
}
#[test]
fn helper_rejects_unvalidated_rule_names_before_running_commands() {
    assert!(
        adbshare::firewall::helper(&["--firewall-helper".into(), "remove".into(), "*".into()])
            .is_err()
    );
}
