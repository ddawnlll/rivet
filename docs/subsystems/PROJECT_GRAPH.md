# Project Graph: repository'nin derived structural model'i

**v0.2 clarification:** Project Graph bir backend/derived representation olabilir, ancak Cognitive View'in kendisi değildir ve zorunlu storage engine değildir. Relational tables, append-only event log, graph index, vector episodic retrieval ve artifact store birlikte kullanılabilir. **Retrieved memory ≠ authoritative state; graph edge ≠ model-facing cognition.**

Project Graph semantic ground truth değildir; repository'nin agent açısından faydalı derived representation'ıdır.

Önerilen node türleri:

```text
Repository
Directory
SourceFile
GeneratedFile
Symbol
Type
Module
Package
BuildTarget
TestTarget
Service
ExternalDependency
Config
```

Edge örnekleri:

```text
defines
references
calls
imports
inherits
implements
builds
links_to
depends_on
tested_by
covers
generates
configured_by
served_by
```

Her edge provenance taşır:

```yaml
edge:
  from: Symbol#refresh_session
  relation: calls
  to: Symbol#validate_token
  provider: rust-analyzer
  repo_snapshot: 91ae...
  confidence: authoritative_within_provider_scope
```

RIG, RepoGraph, LocAgent, Aider repo-map ve Zerolang bu fikrin farklı parçaları için güçlü precedent'lardır. Rivet'in farkı Project Graph'ı tek başına context artifact olarak değil **task/evidence/capability state ile birlikte control-plane input'u** olarak kullanmayı hedeflemesidir.
