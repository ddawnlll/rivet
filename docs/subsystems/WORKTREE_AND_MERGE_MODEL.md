# Worktree, transaction and merge model

Önerilen mutation scopes:

```text
READ-ONLY ANALYSIS
      ↓
EPHEMERAL PATCH SANDBOX
      ↓
TASK WORKTREE / BRANCH
      ↓
TARGETED VERIFICATION
      ↓
INTEGRATION MERGE QUEUE
      ↓
FULL PRAXIS GATE
      ↓
AUTHORIZED COMMIT/MERGE
```

Worker direct mainline write alamaz. Merge queue semantic conflicts ve stale project graph/hash kontrolü yapar.

Zerolang'ın `graphHash` ile stale checked edit'leri reddetmesi burada önemli precedent'tır. Rivet arbitrary repository'de benzer fikri content hash + symbol identity + repo snapshot üzerinden deneyebilir:

```yaml
patch:
  target: Symbol#validateToken
  expected_symbol_hash: 3bc1...
  expected_repo_snapshot: a719...
  operation: replace_body
```

Snapshot veya symbol değişmişse patch otomatik uygulanmaz; rebase/replan gerekir.
