use chrono::Utc;
use noesis::{HardState, NoesisEvent};
use rivet_store::{HardStateStore, MemoryStore, RedbStore};
use rivet_types::*;
use std::process::Command;

#[tokio::test]
async fn test_redb_persistence_and_replay_across_reopen() {
    let tmp_dir = tempfile::tempdir().unwrap();
    let db_path = tmp_dir.path().join("noesis.redb");

    let claim_id = ClaimId::new();
    let event1 = NoesisEvent::ClaimAsserted {
        claim_id: claim_id.clone(),
        proposition: "Repository entrypoint is main.rs".into(),
        status: EpistemicStatus::Supported,
        evidence: vec![EvidenceId::new()],
        scope: Scope::global("rivet", Revision::ZERO),
        timestamp: Utc::now(),
    };

    let event2 = NoesisEvent::ClaimStatusChanged {
        claim_id: claim_id.clone(),
        new_status: EpistemicStatus::Verified,
        reason: "Praxis gate verified".into(),
        timestamp: Utc::now(),
    };

    // 1. First session: open store, append events, save checkpoint, close
    {
        let store = RedbStore::open(&db_path).unwrap();
        let rev1 = store.append_event(Revision::ZERO, &event1).await.unwrap();
        assert_eq!(rev1, Revision(1));

        let stale = store.append_event(Revision::ZERO, &event2).await;
        assert!(matches!(
            stale,
            Err(RivetError::StaleState {
                expected: Revision::ZERO,
                actual: Revision(1)
            })
        ));

        let rev2 = store.append_event(Revision(1), &event2).await.unwrap();
        assert_eq!(rev2, Revision(2));

        let events = store.read_events(Revision::ZERO).await.unwrap();
        assert_eq!(events.len(), 2);

        let materialized = HardState::replay(&events);
        assert_eq!(materialized.revision, Revision(2));
        assert_eq!(
            materialized.claims.get(&claim_id).unwrap().status,
            EpistemicStatus::Verified
        );

        store.save_checkpoint(&materialized).await.unwrap();
    }

    // 2. Second session: reopen store from disk, verify persistence & replay
    {
        let store = RedbStore::open(&db_path).unwrap();
        let checkpoint = store.load_checkpoint().await.unwrap();
        assert!(checkpoint.is_some());
        let cp = checkpoint.unwrap();
        assert_eq!(cp.revision, Revision(2));
        assert_eq!(
            cp.claims.get(&claim_id).unwrap().status,
            EpistemicStatus::Verified
        );

        let events = store.read_events(Revision::ZERO).await.unwrap();
        assert_eq!(events.len(), 2);
    }
}

#[tokio::test]
async fn uncheckpointed_events_are_recoverable_from_append_log() {
    let tmp_dir = tempfile::tempdir().unwrap();
    let db_path = tmp_dir.path().join("recovery.redb");
    let claim_id = ClaimId::new();
    let event = NoesisEvent::ClaimAsserted {
        claim_id: claim_id.clone(),
        proposition: "event log survives a stale checkpoint".into(),
        status: EpistemicStatus::Supported,
        evidence: vec![],
        scope: Scope::global("rivet", Revision::ZERO),
        timestamp: Utc::now(),
    };

    {
        let store = RedbStore::open(&db_path).unwrap();
        assert_eq!(
            store.append_event(Revision::ZERO, &event).await.unwrap(),
            Revision(1)
        );
        // Simulate a process ending after the append and before checkpoint.
    }

    let reopened = RedbStore::open(&db_path).unwrap();
    assert!(reopened.load_checkpoint().await.unwrap().is_none());
    let events = reopened.read_events(Revision::ZERO).await.unwrap();
    let state = HardState::replay(&events);
    assert_eq!(state.revision, Revision(1));
    assert_eq!(
        state.claims.get(&claim_id).unwrap().proposition,
        "event log survives a stale checkpoint"
    );
}

#[tokio::test]
async fn crash_child_appends_then_exits_before_checkpoint() {
    let Ok(db_path) = std::env::var("RIVET_CRASH_CHILD_DB") else {
        return;
    };
    let store = RedbStore::open(db_path).unwrap();
    store
        .append_event(
            Revision::ZERO,
            &NoesisEvent::EvidenceRecorded {
                evidence_id: EvidenceId::new(),
                source: "crash-child".into(),
                summary: "append committed before simulated process crash".into(),
                timestamp: Utc::now(),
            },
        )
        .await
        .unwrap();
    std::process::exit(101);
}

#[tokio::test]
async fn process_crash_before_checkpoint_is_recoverable() {
    let tmp_dir = tempfile::tempdir().unwrap();
    let db_path = tmp_dir.path().join("process-crash.redb");
    let child = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "crash_child_appends_then_exits_before_checkpoint",
        ])
        .env("RIVET_CRASH_CHILD_DB", &db_path)
        .output()
        .unwrap();
    assert_eq!(child.status.code(), Some(101));

    let reopened = RedbStore::open(&db_path).unwrap();
    assert!(reopened.load_checkpoint().await.unwrap().is_none());
    let events = reopened.read_events(Revision::ZERO).await.unwrap();
    assert_eq!(events.len(), 1);
    match &events[0] {
        NoesisEvent::EvidenceRecorded { summary, .. } => {
            assert_eq!(summary, "append committed before simulated process crash")
        }
        other => panic!("unexpected recovered event: {other:?}"),
    }
}

#[tokio::test]
async fn test_read_events_at_max_revision() {
    let tmp_dir = tempfile::tempdir().unwrap();
    let db_path = tmp_dir.path().join("overflow.redb");
    let store = RedbStore::open(&db_path).unwrap();

    let events = store.read_events(Revision(u64::MAX)).await.unwrap();
    assert!(events.is_empty());
}

#[tokio::test]
async fn concurrent_append_at_stale_revision_returns_stale_state() {
    let store = std::sync::Arc::new(MemoryStore::new());
    let first = NoesisEvent::EvidenceRecorded {
        evidence_id: EvidenceId::new(),
        source: "concurrent-one".into(),
        summary: "first append wins".into(),
        timestamp: Utc::now(),
    };
    let second = NoesisEvent::EvidenceRecorded {
        evidence_id: EvidenceId::new(),
        source: "concurrent-two".into(),
        summary: "stale append is rejected".into(),
        timestamp: Utc::now(),
    };

    let (left, right) = tokio::join!(
        store.append_event(Revision::ZERO, &first),
        store.append_event(Revision::ZERO, &second)
    );
    let results = [left, right];
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Ok(Revision(1))))
            .count(),
        1
    );
    assert_eq!(
        results
            .iter()
            .filter(|result| {
                matches!(
                    result,
                    Err(RivetError::StaleState {
                        expected: Revision::ZERO,
                        actual: Revision(1)
                    })
                )
            })
            .count(),
        1
    );
}

#[tokio::test]
async fn test_session_history_persistence_and_listing() {
    let tmp_dir = tempfile::tempdir().unwrap();
    let db_path = tmp_dir.path().join("sessions.redb");

    let entry1 = rivet_store::StoredSessionEntry {
        id: "session-1".into(),
        prompt: "First test prompt".into(),
        status: "completed".into(),
        revision: Some(1),
        created_at: Utc::now(),
    };
    let entry2 = rivet_store::StoredSessionEntry {
        id: "session-2".into(),
        prompt: "Second test prompt".into(),
        status: "running".into(),
        revision: Some(2),
        created_at: Utc::now() + chrono::Duration::seconds(1),
    };

    // 1. Open store, write sessions, reopen
    {
        let store = RedbStore::open(&db_path).unwrap();
        store.save_session_entry(&entry1).await.unwrap();
        store.save_session_entry(&entry2).await.unwrap();

        let list = store.list_session_entries().await.unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "session-1");
        assert_eq!(list[1].id, "session-2");
    }

    // 2. Reopen store, verify persistence
    {
        let store = RedbStore::open(&db_path).unwrap();
        let list = store.list_session_entries().await.unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0], entry1);
        assert_eq!(list[1], entry2);

        // Update status
        let mut updated = entry2.clone();
        updated.status = "completed".into();
        store.save_session_entry(&updated).await.unwrap();

        let updated_list = store.list_session_entries().await.unwrap();
        assert_eq!(updated_list.len(), 2);
        assert_eq!(updated_list[1].status, "completed");
    }
}
