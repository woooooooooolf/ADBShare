#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::{helper, Windows};

use crate::model::Group;
use std::{collections::BTreeSet, path::PathBuf, sync::Arc};

pub trait Backend: Send + Sync {
    /// Return existing candidate rules, plus orphaned ADBShare rules owned by this EXE.
    fn existing(&self, candidates: &BTreeSet<String>) -> Result<BTreeSet<String>, String>;
    fn apply(&self, group: &Group) -> Result<(), String>;
    fn remove(&self, ids: &BTreeSet<String>) -> Result<(), String>;
}

pub struct Firewall {
    pub ledger: PathBuf,
    pub backend: Arc<dyn Backend>,
}
impl Firewall {
    fn pending(&self) -> Result<BTreeSet<String>, String> {
        if !self.ledger.exists() {
            return Ok(BTreeSet::new());
        }
        let ids: BTreeSet<String> =
            serde_json::from_slice(&std::fs::read(&self.ledger).map_err(|e| e.to_string())?)
                .map_err(|e| format!("防火墙清理记录无法读取：{e}"))?;
        validate_ids(&ids)?;
        Ok(ids)
    }
    fn persist(&self, ids: &BTreeSet<String>) -> Result<(), String> {
        if ids.is_empty() && !self.ledger.exists() {
            return Ok(());
        }
        let dir = self.ledger.parent().ok_or("无效清理记录路径")?;
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let mut file = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
        use std::io::Write;
        file.write_all(&serde_json::to_vec_pretty(ids).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.as_file().sync_all().map_err(|e| e.to_string())?;
        file.persist(&self.ledger).map_err(|e| e.to_string())?;
        Ok(())
    }
    fn reconcile(
        &self,
        candidates: &BTreeSet<String>,
    ) -> Result<(BTreeSet<String>, BTreeSet<String>), String> {
        let mut pending = self.pending()?;
        let candidates = candidates.union(&pending).cloned().collect();
        let existing = self.backend.existing(&candidates)?;
        validate_ids(&existing)?;
        pending.extend(existing.iter().cloned());
        self.persist(&pending)?;
        Ok((pending, existing))
    }
    pub fn apply(&self, group: &Group) -> Result<(), String> {
        validate_ids(&BTreeSet::from([group.id.clone()]))?;
        let mut pending = self.pending()?;
        pending.insert(group.id.clone());
        // Write before mutation so interrupted/failed elevation remains recoverable.
        self.persist(&pending)?;
        self.backend.apply(group)
    }
    pub fn remove_group(&self, id: &str) -> Result<(), String> {
        let targets = BTreeSet::from([id.to_owned()]);
        validate_ids(&targets)?;
        let (mut pending, existing) = self.reconcile(&targets)?;
        if existing.contains(id) {
            self.remove_verified(&targets)?;
        }
        pending.remove(id);
        self.persist(&pending)
    }
    pub fn cleanup(&self, groups: &[Group]) -> Result<(), String> {
        let candidates = groups.iter().map(|g| g.id.clone()).collect();
        let (_, existing) = self.reconcile(&candidates)?;
        // One UAC request handles all rules; no elevation if no matching rules exist.
        if !existing.is_empty() {
            self.remove_verified(&existing)?;
        }
        self.persist(&BTreeSet::new())
    }
    fn remove_verified(&self, ids: &BTreeSet<String>) -> Result<(), String> {
        self.backend.remove(ids)?;
        let remaining = self.backend.existing(ids)?;
        if !remaining.is_disjoint(ids) {
            return Err("防火墙仍存在待清理规则，请重试".into());
        }
        Ok(())
    }
}
fn validate_ids(ids: &BTreeSet<String>) -> Result<(), String> {
    for id in ids {
        uuid::Uuid::parse_str(id).map_err(|_| "无效防火墙规则标识")?;
    }
    Ok(())
}
