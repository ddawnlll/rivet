# ACCP specification: claim, action, authority and capability governance

<span class="badge project">PROJECT_DESIGN</span> ACCP'nin iki ana sorusu vardır:

**v0.2 scope clarification.** ACCP memory engine, scheduler, RPC transport veya “everything protocol” değildir. Çekirdek görevi evidence admission, soft→hard promotion authority, action authorization ve auditable claim semantics'tir. Native provider tool/function calling başka bir transport olarak kalabilir; Rivet'in epistemic semantics'i onun üstünde veya yanında typed runtime state olarak uygulanabilir.

1. **Bu claim mevcut evidence altında hangi authority ile söylenebilir?**
2. **Bu action mevcut user authority, risk ve reversibility altında çalıştırılabilir mi?**

Bu iki soru karıştırılmamalıdır. Bir modelin “bu migration muhtemelen güvenli” claim'i yüksek confidence taşısa bile production database migration action'ı için authority sağlamaz.

## Claim record

```yaml
claim:
  id: CL-219
  proposition: "targeted auth regression is fixed"
  epistemic_class: verified
  scope:
    repository: R1
    snapshot: 2fa91...
  support:
    - E-test-781
    - E-diff-92
  limitations:
    - "full integration suite not yet run"
  authority: targeted_verification_only
  created_by: praxis
```

## Action policy

```yaml
action_request:
  action: git.write
  target: src/auth/session.rs
  risk: material
  reversibility: git_checkpoint
  required_authority: task_worker_write
  worker_authority: task_worker_write
  scope_match: true
  decision: allow
```

Destructive örnek:

```yaml
action_request:
  action: git.reset_hard
  target: repository
  risk: destructive
  reversibility: uncertain
  worker_authority: task_worker_write
  required_authority: human_break_glass
  decision: block
```

## Capability restriction

Bun case study'sinde paralel Claude'ların `git stash`, `stash pop`, `git reset --hard` ile birbirinin state'ine basması, “lütfen bunu yapma” prompt'unun sistem boundary olmadığını gösterir. Rivet worker'a bu tool'ları yalnızca policy gerektiriyorsa expose etmelidir.

Örnek worker manifest:

```yaml
worker_role: mechanical_refactor
scope:
  read: ["src/parser/**", "PORTING.md"]
  write: ["src/parser/**"]
capabilities:
  file.read: allow
  symbol.references: allow
  file.patch: allow
  test.targeted: allow
  git.commit_scoped: allow
  git.reset: deny
  git.stash: deny
  network.write: deny
  production.write: deny
resource_budget:
  cpu: 2
  memory_mb: 4096
  processes: 256
  wall_seconds: 900
```
