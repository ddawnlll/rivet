//! # praxis::ledger
//!
//! Append-only NDJSON evidence ledger with atomic writes, Merkle root verification,
//! and crash recovery.

use crate::merkle::root_from_records;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const LEDGER_SCHEMA: &str = "praxis-ledger/v1";
const HEADER_LINE_PREFIX: &str = "# ";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerRecord {
    #[serde(rename = "recordId")]
    pub record_id: String,
    #[serde(rename = "capturedAt")]
    pub captured_at: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerHeader {
    pub schema: String,
    #[serde(rename = "candidateId")]
    pub candidate_id: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "merkleRoot")]
    pub merkle_root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerState {
    pub header: LedgerHeader,
    pub records: Vec<LedgerRecord>,
    pub merkle_root: String,
}

#[derive(Debug, Clone)]
pub struct Ledger {
    path: PathBuf,
    state: LedgerState,
}

impl Ledger {
    /// Open an existing ledger or create a new one with a valid Merkle root
    pub fn open(path: impl AsRef<Path>, candidate_id: &str) -> Result<Self, String> {
        let path = path.as_ref().to_path_buf();
        if !path.exists() {
            let initial_root = hex::encode(root_from_records(&[]));
            let header = LedgerHeader {
                schema: LEDGER_SCHEMA.into(),
                candidate_id: candidate_id.into(),
                created_at: Utc::now().to_rfc3339(),
                merkle_root: initial_root.clone(),
            };
            let state = LedgerState {
                header,
                records: Vec::new(),
                merkle_root: initial_root,
            };
            let ledger = Self { path, state };
            ledger.persist_all()?;
            return Ok(ledger);
        }

        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let state = Self::parse_or_throw(&raw, candidate_id)?;
        Ok(Self { path, state })
    }

    /// Read-only inspection of a ledger
    pub fn open_read_only(path: impl AsRef<Path>, candidate_id: &str) -> Result<Self, String> {
        let path = path.as_ref().to_path_buf();
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let state = Self::parse_or_throw(&raw, candidate_id)?;
        Ok(Self { path, state })
    }

    pub fn current(&self) -> &LedgerState {
        &self.state
    }

    /// Append a new record to the ledger, recompute Merkle root, and persist atomically
    pub fn append(&mut self, record: LedgerRecord) -> Result<(usize, String), String> {
        if self
            .state
            .records
            .iter()
            .any(|r| r.record_id == record.record_id)
        {
            return Err(format!("duplicate recordId: {}", record.record_id));
        }

        self.state.records.push(record);
        let root = self.compute_merkle_root()?;
        self.state.merkle_root = root.clone();
        self.state.header.merkle_root = root.clone();
        self.persist_all()?;
        Ok((self.state.records.len() - 1, root))
    }

    /// Idempotent append: if record already exists, returns its index
    pub fn append_idempotent(
        &mut self,
        record: LedgerRecord,
    ) -> Result<(usize, String, bool), String> {
        if let Some(pos) = self
            .state
            .records
            .iter()
            .position(|r| r.record_id == record.record_id)
        {
            return Ok((pos, self.state.merkle_root.clone(), true));
        }
        let (idx, root) = self.append(record)?;
        Ok((idx, root, false))
    }

    /// Recover from trailing corruption / partial crashes
    pub fn recover(&mut self) -> Result<&LedgerState, String> {
        let raw = fs::read_to_string(&self.path).map_err(|e| e.to_string())?;
        let mut state = Self::parse_or_throw(&raw, &self.state.header.candidate_id)?;
        state.header.merkle_root = state.merkle_root.clone();
        self.state = state;
        self.persist_all()?;
        Ok(&self.state)
    }

    /// Verify cryptographic integrity of the ledger records against header Merkle root
    pub fn verify_integrity(&self) -> Result<(), String> {
        let computed = self.compute_merkle_root()?;
        if self.state.header.merkle_root != computed {
            return Err(format!(
                "header merkle root mismatch: header={} computed={}",
                self.state.header.merkle_root, computed
            ));
        }
        if self.state.merkle_root != computed {
            return Err(format!(
                "state merkle root mismatch: state={} computed={}",
                self.state.merkle_root, computed
            ));
        }
        Ok(())
    }

    fn compute_merkle_root(&self) -> Result<String, String> {
        let mut byte_records = Vec::new();
        for r in &self.state.records {
            let bytes = serde_json::to_vec(r).map_err(|e| e.to_string())?;
            byte_records.push(bytes);
        }
        let slices: Vec<&[u8]> = byte_records.iter().map(|b| b.as_slice()).collect();
        let root = root_from_records(&slices);
        Ok(hex::encode(root))
    }

    fn persist_all(&self) -> Result<(), String> {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let mut lines = Vec::new();
        let header_json = serde_json::to_string(&self.state.header).map_err(|e| e.to_string())?;
        lines.push(format!("{}{}", HEADER_LINE_PREFIX, header_json));

        for r in &self.state.records {
            let record_json = serde_json::to_string(r).map_err(|e| e.to_string())?;
            lines.push(record_json);
        }

        let data = lines.join("\n") + "\n";
        let count = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let staging_path = self
            .path
            .with_extension(format!("staging.{}.{}", std::process::id(), count));
        fs::write(&staging_path, data).map_err(|e| e.to_string())?;
        fs::rename(&staging_path, &self.path).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn parse_or_throw(raw: &str, expected_candidate_id: &str) -> Result<LedgerState, String> {
        let lines: Vec<&str> = raw.lines().collect();
        if lines.is_empty() || !lines[0].starts_with(HEADER_LINE_PREFIX) {
            return Err("missing schema header line".into());
        }

        let header_str = &lines[0][HEADER_LINE_PREFIX.len()..];
        let header: LedgerHeader = serde_json::from_str(header_str)
            .map_err(|e| format!("header not valid JSON: {}", e))?;

        if header.schema != LEDGER_SCHEMA {
            return Err(format!("unsupported schema: {}", header.schema));
        }
        if header.candidate_id != expected_candidate_id {
            return Err(format!(
                "candidateId mismatch: file={} expected={}",
                header.candidate_id, expected_candidate_id
            ));
        }

        let mut records = Vec::new();
        for (_i, &line) in lines.iter().enumerate().skip(1) {
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<LedgerRecord>(line) {
                Ok(rec) => records.push(rec),
                Err(_) => {
                    // Stop parsing at first broken line (crash-recovery truncation)
                    break;
                }
            }
        }

        let mut byte_records = Vec::new();
        for r in &records {
            if let Ok(b) = serde_json::to_vec(r) {
                byte_records.push(b);
            }
        }
        let slices: Vec<&[u8]> = byte_records.iter().map(|b| b.as_slice()).collect();
        let merkle_root = hex::encode(root_from_records(&slices));

        Ok(LedgerState {
            header,
            records,
            merkle_root,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ledger_append_and_recovery() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let ledger_path = tmp_dir.path().join("evidence.ledger.jsonl");

        let mut ledger = Ledger::open(&ledger_path, "cand-123").unwrap();
        assert_eq!(ledger.current().records.len(), 0);

        let rec1 = LedgerRecord {
            record_id: "rec-1".into(),
            captured_at: Utc::now().to_rfc3339(),
            payload: serde_json::json!({ "type": "test_output", "passed": true }),
        };

        let (idx, root) = ledger.append(rec1).unwrap();
        assert_eq!(idx, 0);
        assert_eq!(root.len(), 64);
        assert!(ledger.verify_integrity().is_ok());

        // Reopen and check
        let reopened = Ledger::open_read_only(&ledger_path, "cand-123").unwrap();
        assert_eq!(reopened.current().records.len(), 1);
        assert_eq!(reopened.current().records[0].record_id, "rec-1");
        assert!(reopened.verify_integrity().is_ok());
    }
}
