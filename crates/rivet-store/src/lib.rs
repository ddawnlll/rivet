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

#[async_trait]
pub trait HardStateStore: Send + Sync {
    async fn append_event(&self, event: &NoesisEvent) -> RivetResult<Revision>;
    async fn read_events(&self, from_revision: Revision) -> RivetResult<Vec<NoesisEvent>>;
    async fn save_checkpoint(&self, state: &HardState) -> RivetResult<()>;
    async fn load_checkpoint(&self) -> RivetResult<Option<HardState>>;
}

/// In-memory HardStateStore for fast tests and ephemeral sessions
pub struct MemoryStore {
    events: Arc<Mutex<Vec<NoesisEvent>>>,
    checkpoint: Arc<Mutex<Option<HardState>>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self {
            events: Arc::new(Mutex::new(Vec::new())),
            checkpoint: Arc::new(Mutex::new(None)),
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
    async fn append_event(&self, event: &NoesisEvent) -> RivetResult<Revision> {
        let mut events = self.events.lock().unwrap();
        events.push(event.clone());
        Ok(Revision(events.len() as u64))
    }

    async fn read_events(&self, from_revision: Revision) -> RivetResult<Vec<NoesisEvent>> {
        let events = self.events.lock().unwrap();
        let start = from_revision.0 as usize;
        if start < events.len() {
            Ok(events[start..].to_vec())
        } else {
            Ok(Vec::new())
        }
    }

    async fn save_checkpoint(&self, state: &HardState) -> RivetResult<()> {
        let mut cp = self.checkpoint.lock().unwrap();
        *cp = Some(state.clone());
        Ok(())
    }

    async fn load_checkpoint(&self) -> RivetResult<Option<HardState>> {
        let cp = self.checkpoint.lock().unwrap();
        Ok(cp.clone())
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
    async fn append_event(&self, event: &NoesisEvent) -> RivetResult<Revision> {
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
            let next_rev = table
                .len()
                .map_err(|e| RivetError::Storage(e.to_string()))?
                + 1;
            table
                .insert(next_rev, serialized.as_slice())
                .map_err(|e| RivetError::Storage(e.to_string()))?;
        }
        write_txn
            .commit()
            .map_err(|e| RivetError::Storage(e.to_string()))?;

        // Read total count to determine current revision
        let read_txn = self
            .db
            .begin_read()
            .map_err(|e| RivetError::Storage(e.to_string()))?;
        let table = read_txn
            .open_table(EVENTS_TABLE)
            .map_err(|e| RivetError::Storage(e.to_string()))?;
        let count = table
            .len()
            .map_err(|e| RivetError::Storage(e.to_string()))?;
        Ok(Revision(count))
    }

    async fn read_events(&self, from_revision: Revision) -> RivetResult<Vec<NoesisEvent>> {
        let read_txn = self
            .db
            .begin_read()
            .map_err(|e| RivetError::Storage(e.to_string()))?;
        let table = read_txn
            .open_table(EVENTS_TABLE)
            .map_err(|e| RivetError::Storage(e.to_string()))?;

        let mut events = Vec::new();
        let range = table
            .range((from_revision.0 + 1)..)
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
}
