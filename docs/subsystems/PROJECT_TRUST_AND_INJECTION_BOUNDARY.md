# Project trust and prompt-injection boundary

Repository içindeki `AGENTS.md`, `CLAUDE.md`, hooks, build scripts ve generated tool output kullanıcı intent'inden ayrı authority class'a sahip olmalıdır. “Repo'da yazıyor” = “user authorized” değildir.

Minimum trust sequence:

```text
open path
  ↓
read-only static inspect
  ↓
identify executable project config
  ↓
human/project trust decision
  ↓
activation / hooks / package scripts allowed by policy
```

Tool output içindeki natural-language instruction'lar da observation olarak işlenir; system/user authority'yi override edemez.
