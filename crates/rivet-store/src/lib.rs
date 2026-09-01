//! # rivet-store (Durable Hard State Persistence)
//!
//! Provides the HardStateStore trait and the redb embedded ACID backend.

use async_trait::async_trait;
use noesis::{HardState, NoesisEvent};
use redb::{Database, ReadableTableMetadata, TableDefinition};
use rivet_types::*;
use std::path::Path;
use std::sync::{Arc, Mutex};

const EVENTS_TABLE: TableDefinition<u64, &[u8]> = TableDefinition::new("noesis_events");
const STATE_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("noesis_materialized");
const SESSIONS_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("session_history");

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct StoredSessionEntry {
    pub id: String,
    pub prompt: String,
    pub status: String,
    pub revision: Option<u64>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[async_trait]
pub trait HardStateStore: Send + Sync {
    async fn append_event(
        &self,
        expected_revision: Revision,
        event: &NoesisEvent,
    ) -> RivetResult<Revision>;
    async fn read_events(&self, from_revision: Revision) -> RivetResult<Vec<NoesisEvent>>;
    async fn save_checkpoint(&self, state: &HardState) -> RivetResult<()>;
    async fn load_checkpoint(&self) -> RivetResult<Option<HardState>>;
    async fn save_session_entry(&self, entry: &StoredSessionEntry) -> RivetResult<()>;
    async fn list_session_entries(&self) -> RivetResult<Vec<StoredSessionEntry>>;
}

/// In-memory HardStateStore for fast tests and ephemeral sessions
pub struct MemoryStore {
    events: Arc<Mutex<Vec<NoesisEvent>>>,
    checkpoint: Arc<Mutex<Option<HardState>>>,
    sessions: Arc<Mutex<Vec<StoredSessionEntry>>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self {
            events: Arc::new(Mutex::new(Vec::new())),
            checkpoint: Arc::new(Mutex::new(None)),
            sessions: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl Default for MemoryStore {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl HardStateStore for MemoryStore {
    async fn append_event(
        &self,
        expected_revision: Revision,
        event: &NoesisEvent,
    ) -> RivetResult<Revision> {
        let mut events = self
            .events
            .lock()
            .map_err(|_| RivetError::Storage("memory store mutex poisoned".into()))?;
        let actual_revision = Revision(events.len() as u64);
        if actual_revision != expected_revision {
            return Err(RivetError::StaleState {
                expected: expected_revision,
                actual: actual_revision,
            });
        }
        events.push(event.clone());
        Ok(Revision(events.len() as u64))
    }

    async fn read_events(&self, from_revision: Revision) -> RivetResult<Vec<NoesisEvent>> {
        let events = self
            .events
            .lock()
            .map_err(|_| RivetError::Storage("memory store mutex poisoned".into()))?;
        let start = from_revision.0 as usize;
        if start < events.len() {
            Ok(events[start..].to_vec())
        } else {
            Ok(Vec::new())
        }
    }

    async fn save_checkpoint(&self, state: &HardState) -> RivetResult<()> {
        let mut cp = self
            .checkpoint
            .lock()
            .map_err(|_| RivetError::Storage("memory store mutex poisoned".into()))?;
        *cp = Some(state.clone());
        Ok(())
    }

    async fn load_checkpoint(&self) -> RivetResult<Option<HardState>> {
        let cp = self
            .checkpoint
            .lock()
            .map_err(|_| RivetError::Storage("memory store mutex poisoned".into()))?;
        Ok(cp.clone())
    }

    async fn save_session_entry(&self, entry: &StoredSessionEntry) -> RivetResult<()> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| RivetError::Storage("memory store mutex poisoned".into()))?;
        if let Some(pos) = sessions.iter().position(|s| s.id == entry.id) {
            sessions[pos] = entry.clone();
        } else {
            sessions.push(entry.clone());
        }
        Ok(())
    }

    async fn list_session_entries(&self) -> RivetResult<Vec<StoredSessionEntry>> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| RivetError::Storage("memory store mutex poisoned".into()))?;
        Ok(sessions.clone())
    }
}

/// Durable redb embedded ACID store
pub struct RedbStore {
    db: Arc<Database>,
    write_lock: Arc<Mutex<()>>,
}

impl RedbStore {
    pub fn open(path: impl AsRef<Path>) -> RivetResult<Self> {
        let db = Database::create(path).map_err(|e| RivetError::Storage(e.to_string()))?;
        let db = Arc::new(db);
        let write_txn = db
            .begin_write()
            .map_err(|e| RivetError::Storage(e.to_string()))?;
        write_txn
            .open_table(EVENTS_TABLE)
            .map_err(|e| RivetError::Storage(e.to_string()))?;
        write_txn
            .open_table(STATE_TABLE)
            .map_err(|e| RivetError::Storage(e.to_string()))?;
        write_txn
            .open_table(SESSIONS_TABLE)
            .map_err(|e| RivetError::Storage(e.to_string()))?;
        write_txn
            .commit()
            .map_err(|e| RivetError::Storage(e.to_string()))?;
        Ok(Self {
            db,
            write_lock: Arc::new(Mutex::new(())),
        })
    }
}

#[async_trait]
impl HardStateStore for RedbStore {
    async fn append_event(
        &self,
        expected_revision: Revision,
        event: &NoesisEvent,
    ) -> RivetResult<Revision> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| RivetError::Storage("redb write lock poisoned".into()))?;
        let serialized =
            serde_json::to_vec(event).map_err(|e| RivetError::Serialization(e.to_string()))?;

        let write_txn = self
            .db
            .begin_write()
            .map_err(|e| RivetError::Storage(e.to_string()))?;
        {
            let mut table = write_txn
                .open_table(EVENTS_TABLE)
                .map_err(|e| RivetError::Storage(e.to_string()))?;
            let actual_revision = table
                .len()
                .map_err(|e| RivetError::Storage(e.to_string()))?;
            if Revision(actual_revision) != expected_revision {
                return Err(RivetError::StaleState {
                    expected: expected_revision,
                    actual: Revision(actual_revision),
                });
            }
            let next_rev = actual_revision + 1;
            table
                .insert(next_rev, serialized.as_slice())
                .map_err(|e| RivetError::Storage(e.to_string()))?;
        }
        write_txn
            .commit()
            .map_err(|e| RivetError::Storage(e.to_string()))?;

        Ok(expected_revision.next())
    }

    async fn read_events(&self, from_revision: Revision) -> RivetResult<Vec<NoesisEvent>> {
        let Some(start_key) = from_revision.0.checked_add(1) else {
            return Ok(Vec::new());
        };

        let read_txn = self
            .db
            .begin_read()
            .map_err(|e| RivetError::Storage(e.to_string()))?;
        let table = read_txn
            .open_table(EVENTS_TABLE)
            .map_err(|e| RivetError::Storage(e.to_string()))?;

        let mut events = Vec::new();
        let range = table
            .range(start_key..)
            .map_err(|e| RivetError::Storage(e.to_string()))?;

        for item in range {
            let (_, val) = item.map_err(|e| RivetError::Storage(e.to_string()))?;
            let event: NoesisEvent = serde_json::from_slice(val.value())
                .map_err(|e| RivetError::Serialization(e.to_string()))?;
            events.push(event);
        }

        Ok(events)
    }

    async fn save_checkpoint(&self, state: &HardState) -> RivetResult<()> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| RivetError::Storage("redb write lock poisoned".into()))?;
        let serialized =
            serde_json::to_vec(state).map_err(|e| RivetError::Serialization(e.to_string()))?;
        let write_txn = self
            .db
            .begin_write()
            .map_err(|e| RivetError::Storage(e.to_string()))?;
        {
            let mut table = write_txn
                .open_table(STATE_TABLE)
                .map_err(|e| RivetError::Storage(e.to_string()))?;
            table
                .insert("latest", serialized.as_slice())
                .map_err(|e| RivetError::Storage(e.to_string()))?;
        }
        write_txn
            .commit()
            .map_err(|e| RivetError::Storage(e.to_string()))?;
        Ok(())
    }

    async fn load_checkpoint(&self) -> RivetResult<Option<HardState>> {
        let read_txn = self
            .db
            .begin_read()
            .map_err(|e| RivetError::Storage(e.to_string()))?;
        let table = read_txn
            .open_table(STATE_TABLE)
            .map_err(|e| RivetError::Storage(e.to_string()))?;

        if let Some(val) = table
            .get("latest")
            .map_err(|e| RivetError::Storage(e.to_string()))?
        {
            let state: HardState = serde_json::from_slice(val.value())
                .map_err(|e| RivetError::Serialization(e.to_string()))?;
            Ok(Some(state))
        } else {
            Ok(None)
        }
    }

    async fn save_session_entry(&self, entry: &StoredSessionEntry) -> RivetResult<()> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| RivetError::Storage("redb write lock poisoned".into()))?;
        let serialized =
            serde_json::to_vec(entry).map_err(|e| RivetError::Serialization(e.to_string()))?;
        let write_txn = self
            .db
            .begin_write()
            .map_err(|e| RivetError::Storage(e.to_string()))?;
        {
            let mut table = write_txn
                .open_table(SESSIONS_TABLE)
                .map_err(|e| RivetError::Storage(e.to_string()))?;
            table
                .insert(entry.id.as_str(), serialized.as_slice())
                .map_err(|e| RivetError::Storage(e.to_string()))?;
        }
        write_txn
            .commit()
            .map_err(|e| RivetError::Storage(e.to_string()))?;
        Ok(())
    }

    async fn list_session_entries(&self) -> RivetResult<Vec<StoredSessionEntry>> {
        let read_txn = self
            .db
            .begin_read()
            .map_err(|e| RivetError::Storage(e.to_string()))?;
        let table = read_txn
            .open_table(SESSIONS_TABLE)
            .map_err(|e| RivetError::Storage(e.to_string()))?;

        let mut entries = Vec::new();
        let iter = table
            .range::<&str>(..)
            .map_err(|e| RivetError::Storage(e.to_string()))?;

        for item in iter {
            let (_, val) = item.map_err(|e| RivetError::Storage(e.to_string()))?;
            let entry: StoredSessionEntry = serde_json::from_slice(val.value())
                .map_err(|e| RivetError::Serialization(e.to_string()))?;
            entries.push(entry);
        }

        entries.sort_by_key(|a| a.created_at);
        Ok(entries)
    }
}
