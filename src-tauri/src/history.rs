use crate::{model::Group, protocol::Device};
use serde::Serialize;
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

pub const PER_SCOPE_LIMIT: usize = 512;
pub const TOTAL_LIMIT: usize = 8192;
pub const PAYLOAD_LIMIT: usize = 512;
pub type Logs = Arc<Mutex<History>>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: u64,
    pub time: u64,
    pub group_id: Option<String>,
    pub serial: Option<String>,
    pub session: Option<u64>,
    pub kind: String,
    pub message: String,
    pub bytes: usize,
    pub hex: String,
    pub text: String,
}
#[derive(Default)]
pub struct History {
    records: VecDeque<Record>,
    next: u64,
    dropped: BTreeMap<(Option<String>, Option<String>), u64>,
    states: BTreeMap<String, String>,
    members: BTreeMap<String, Vec<String>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub records: Vec<Record>,
    pub dropped: u64,
    pub states: BTreeMap<String, String>,
    pub per_scope_limit: usize,
    pub payload_limit: usize,
}
impl History {
    pub fn configure(&mut self, groups: &[Group]) {
        self.members = groups
            .iter()
            .map(|g| (g.id.clone(), g.members.clone()))
            .collect();
        let members = &self.members;
        let keep = |group: &Option<String>, serial: &Option<String>| {
            group.as_ref().is_none_or(|g| {
                members
                    .get(g)
                    .is_some_and(|list| serial.as_ref().is_none_or(|s| list.contains(s)))
            })
        };
        self.records.retain(|r| keep(&r.group_id, &r.serial));
        self.dropped.retain(|(g, s), _| keep(g, s));
        self.states
            .retain(|s, _| members.values().any(|list| list.contains(s)));
    }
    pub fn register(&mut self, group: &Group) {
        self.members.insert(group.id.clone(), group.members.clone());
    }
    pub fn event(
        &mut self,
        group: Option<&str>,
        serial: Option<&str>,
        session: Option<u64>,
        kind: &str,
        message: impl Into<String>,
    ) {
        self.push(Record {
            id: 0,
            time: 0,
            group_id: group.map(str::to_owned),
            serial: serial.map(str::to_owned),
            session,
            kind: kind.into(),
            message: message.into(),
            bytes: 0,
            hex: String::new(),
            text: String::new(),
        });
    }
    pub fn payload(
        &mut self,
        group: &str,
        serial: &str,
        session: u64,
        direction: &str,
        data: &[u8],
    ) {
        let sample = &data[..data.len().min(PAYLOAD_LIMIT)];
        self.push(Record {
            id: 0,
            time: 0,
            group_id: Some(group.into()),
            serial: Some(serial.into()),
            session: Some(session),
            kind: direction.into(),
            message: String::new(),
            bytes: data.len(),
            hex: sample
                .iter()
                .map(|b| format!("{b:02X} "))
                .collect::<String>()
                .trim_end()
                .into(),
            text: String::from_utf8_lossy(sample)
                .chars()
                .map(|c| {
                    if c.is_control() && c != '\n' && c != '\t' {
                        '·'
                    } else {
                        c
                    }
                })
                .collect(),
        });
    }
    fn push(&mut self, mut record: Record) {
        if let Some(g) = &record.group_id {
            if !self
                .members
                .get(g)
                .is_some_and(|list| record.serial.as_ref().is_none_or(|s| list.contains(s)))
            {
                return;
            }
        }
        self.next += 1;
        record.id = self.next;
        record.time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        // Event text is bounded as well as binary captures.
        record.message = record.message.chars().take(1024).collect();
        let scope = (record.group_id.clone(), record.serial.clone());
        if self
            .records
            .iter()
            .filter(|r| r.group_id == scope.0 && r.serial == scope.1)
            .count()
            >= PER_SCOPE_LIMIT
        {
            let index = self
                .records
                .iter()
                .position(|r| r.group_id == scope.0 && r.serial == scope.1)
                .unwrap();
            self.records.remove(index);
            *self.dropped.entry(scope).or_default() += 1;
        }
        if self.records.len() >= TOTAL_LIMIT {
            let r = self.records.pop_front().unwrap();
            *self.dropped.entry((r.group_id, r.serial)).or_default() += 1;
        }
        self.records.push_back(record);
    }
    pub fn observe(&mut self, devices: &[Device]) {
        let current: BTreeMap<_, _> = devices
            .iter()
            .map(|d| (d.serial.clone(), d.state.clone()))
            .collect();
        for (id, members) in self.members.clone() {
            for serial in members {
                let state = current.get(&serial).map_or("absent", String::as_str);
                if self.states.get(&serial).map(String::as_str) != Some(state) {
                    self.event(Some(&id), Some(&serial), None, "device-state", state);
                }
            }
        }
        self.states = self
            .members
            .values()
            .flatten()
            .map(|s| {
                (
                    s.clone(),
                    current.get(s).cloned().unwrap_or_else(|| "absent".into()),
                )
            })
            .collect();
    }
    pub fn view(&self, group: Option<&str>, serial: Option<&str>) -> View {
        let matches = |g: &Option<String>, s: &Option<String>| {
            group.is_none_or(|v| g.as_deref() == Some(v))
                && serial.is_none_or(|v| s.as_deref() == Some(v))
        };
        View {
            records: self
                .records
                .iter()
                .filter(|r| matches(&r.group_id, &r.serial))
                .cloned()
                .collect(),
            dropped: self
                .dropped
                .iter()
                .filter(|((g, s), _)| matches(g, s))
                .map(|(_, n)| n)
                .sum(),
            states: self.states.clone(),
            per_scope_limit: PER_SCOPE_LIMIT,
            payload_limit: PAYLOAD_LIMIT,
        }
    }
    pub fn reset(&mut self, group: Option<&str>, serial: Option<&str>) {
        let matches = |g: &Option<String>, s: &Option<String>| {
            group.is_none_or(|v| g.as_deref() == Some(v))
                && serial.is_none_or(|v| s.as_deref() == Some(v))
        };
        self.records.retain(|r| !matches(&r.group_id, &r.serial));
        self.dropped.retain(|(g, s), _| !matches(g, s));
    }
}
pub fn log(logs: &Logs, message: impl Into<String>) {
    logs.lock()
        .unwrap()
        .event(None, None, None, "system", message);
}

#[cfg(test)]
mod tests {
    use super::*;
    fn group(id: &str, members: &[&str]) -> Group {
        Group {
            id: id.into(),
            name: id.into(),
            address: "127.0.0.1".parse().unwrap(),
            port: 15037,
            sources: vec![],
            members: members.iter().map(|s| s.to_string()).collect(),
            disabled_members: vec![],
        }
    }
    #[test]
    fn bounded_binary_capture_reset_and_membership_cleanup_are_scoped() {
        let mut h = History::default();
        let a = group("a", &["A", "B"]);
        let b = group("b", &["A"]);
        h.configure(&[a.clone(), b.clone()]);
        for _ in 0..600 {
            h.payload("a", "A", 1, "receive", &vec![255; 1000]);
        }
        let v = h.view(Some("a"), Some("A"));
        assert_eq!(v.records.len(), 512);
        assert_eq!(v.dropped, 88);
        assert_eq!(v.records[0].bytes, 1000);
        assert_eq!(v.records[0].hex.split_whitespace().count(), 512);
        h.event(Some("b"), Some("A"), None, "enabled", "");
        h.reset(Some("a"), Some("A"));
        assert!(h.view(Some("a"), None).records.is_empty());
        assert_eq!(h.view(Some("b"), None).records.len(), 1);
        h.event(Some("a"), Some("B"), None, "enabled", "");
        h.configure(&[group("a", &["B"]), b]);
        h.payload("a", "A", 1, "receive", b"late");
        assert!(h.view(Some("a"), Some("A")).records.is_empty());
        assert_eq!(h.view(None, None).records.len(), 2);
    }
    #[test]
    fn state_changes_are_logged_once_for_every_group_sharing_a_device() {
        let mut h = History::default();
        h.configure(&[group("a", &["A"]), group("b", &["A"])]);
        h.observe(&[]);
        h.observe(&[]);
        assert_eq!(h.view(None, None).records.len(), 2);
    }
}
