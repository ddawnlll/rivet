# Cognitive View Policy: progressive disclosure

v0.2'de context policy yalnız token budget tekniği değildir. Model input'u, Hard State + Soft Workspace + repository frontier + evidence'dan üretilen **Cognitive View**'dir. Context bir view'dır; Soft Workspace değildir; Hard State hiç değildir.

Rivet context'i bir defada doldurmak yerine active retrieval kullanmalıdır.

Başlangıç:

```text
Task: Fix auth refresh regression
Observed: expected 200, got 401
Relevant symbols: refreshSession, validateToken
Known change: clock fixture changed in commit X
```

Model gerekirse:

```text
REQUEST_CONTEXT(symbol_body=validateToken)
```

der. Runtime yalnızca o slice'ı ekler.

Bu yaklaşım Aider repo-map, Vercel plugin'in context injection/ranking sistemi ve semantic tooling precedent'larından faydalanır, ancak Rivet'te context policy Noesis/task state tarafından da yönlendirilir.
