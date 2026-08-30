# Goal Compiler and obligation model

Goal Compiler kullanıcının doğal dil hedefini bir kez “plan”a çevirip donduran model değildir. Objective, hard constraints, acceptance, non-goals ve unresolved ambiguity'leri explicit state'e çıkarır.

Örnek:

```yaml
goal:
  objective: "JWT refresh regression'ını düzelt"
  constraints:
    - public API değişmemeli
    - backward compatibility korunmalı
    - tests silinmemeli
  non_goals:
    - auth framework rewrite yok
  obligations:
    - reproduce_failure
    - identify_causal_scope
    - implement_minimal_fix
    - pass_targeted_tests
    - pass_auth_integration
  ambiguities:
    - exact supported clock-skew behavior
```

Ambiguity varsa Goal Compiler bunu assumption'a dönüştürmek yerine `UNKNOWN/USER_AUTHORITY` olarak tutabilir. User clarification mümkün değilse kontrollü default ancak `assumption` etiketiyle ilerler.
