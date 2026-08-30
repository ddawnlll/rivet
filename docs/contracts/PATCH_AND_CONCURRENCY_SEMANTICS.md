# Patch and Concurrency Semantics

## Semantic patch intent

Line-based patch mümkün olsa da long-running multi-worker environment için structural identity tercih edilir.

```yaml
patch_intent:
  target: symbol://auth.validate_token
  expected_revision: sha256:...
  operation: replace_body
  proposed_artifact: patch://P122
```

Apply öncesi runtime:

- target identity hâlâ resolve oluyor mu?
- expected revision stale mi?
- conflicting writer var mı?
- scope policy izin veriyor mu?
- patch parses/typechecks mi?

Stale patch silent apply edilmez.

## Derived parallelism

Parallel worker count kullanıcı prompt'u veya sabit `N` değildir.

```text
READY TASKS
   ↓
read/write/resource sets
   ↓
conflict graph
   ↓
maximal safe independent set
   ↓
workers/worktrees
```

Conflict sources:

- same semantic symbol/file write;
- generated artifact dependency;
- package/build lock;
- shared database/service;
- exclusive test fixture;
- branch/worktree state;
- resource budget;
- authority boundary.

## Reviewer independence

Material patch için default review topology:

```text
IMPLEMENTER CONTEXT
      │ patch
      ▼
review artifact only ─────────────┐
                                 ▼
                        INDEPENDENT REVIEWER
                                 │ findings
                                 ▼
                              FIXER
                                 │
                                 ▼
                              PRAXIS
```

Reviewer implementer reasoning transcript'ini varsayılan olarak görmez. Ama source/evidence erişebilir. Amaç “farklı model persona” değil, error correlation'ı azaltmaktır.
