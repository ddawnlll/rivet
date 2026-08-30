# Security and Trust Model

Coding agent repository içindeki dosyaları yalnızca “data” olarak okumaz; build scripts, hooks, package lifecycle scripts, editor configs ve tool configs execution yüzeyi yaratabilir. Bu nedenle project discovery ile project execution ayrı authority seviyeleridir.

## Trust states

```text
UNTRUSTED
   ↓ human trust / signed policy / sandboxed allow
LIMITED
   ↓ verified providers + scoped permissions
TRUSTED_FOR_TASK
```

`TRUSTED_FOR_TASK` global trust değildir; task/scope/commit'e bağlıdır.

## Project-local configuration rule

Project-local agent config, hooks veya scripts trust kararı öncesinde otomatik execute edilmez. Discovery onları metadata olarak okuyabilir fakat active behavior'a dönüştürmez.

Bu kural Claude Code'un project-local configuration trust boundary hakkında kamuya açık security engineering dersleriyle uyumludur: [How we contain Claude](https://www.anthropic.com/engineering/how-we-contain-claude).

## Least-capability worker

Worker'ın tool listesi rol ve scope'tan türetilir. Prompt-level “git reset yapma” uyarısı security boundary değildir.

```yaml
worker_role: mechanical_refactor
allow:
  - repo.read
  - semantic.edit.assigned_scope
  - test.targeted
  - git.diff
deny:
  - git.reset_hard
  - git.push
  - secrets.read
  - network.unrestricted
```

## Resource sandbox

Her worker için mümkünse OS-level limits:

- CPU quota;
- memory ceiling;
- process/PID limit;
- disk/output quota;
- wall-clock timeout;
- network policy;
- filesystem write scope.

Prompt resource control değildir.
