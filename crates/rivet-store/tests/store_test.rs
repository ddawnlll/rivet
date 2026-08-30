use chrono::Utc;
use noesis::{HardState, NoesisEvent};
use rivet_store::{HardStateStore, RedbStore};
use rivet_types::*;

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
        let rev1 = store.append_event(&event1).await.unwrap();
        assert_eq!(rev1, Revision(1));

        let rev2 = store.append_event(&event2).await.unwrap();
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
        assert_eq!(store.append_event(&event).await.unwrap(), Revision(1));
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
