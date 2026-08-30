# Interaction Model: Chat-Only Surface

<span class="badge provisional">PROVISIONAL_DECISION</span> Rivet'in ana kullanıcı yüzeyi yalnız chat'tir. “Plan Mode”, “Ask Mode”, “Build Mode”, ayrı task/sidebar state'i veya kullanıcının manually switch etmesi gereken cognitive modes ürünün authoritative state'i değildir. Planlama, execution, verification, waiting-for-authority ve reframing runtime/model davranışlarıdır.

Chat-only tasarım observability'yi kaldırmaz; onu conversational projection'a çevirir. Kullanıcı “ne durumdayız?”, “neden bu dosyaya dokundun?”, “hangi hipotezler elendi?”, “neyi hatırlıyorsun?”, “hangi gate blokluyor?” dediğinde Rivet internal hard/soft/evidence state'ten cevap üretir. Frontend kapanıp yeniden açılsa bile agent identity veya task state chat transcript'ine bağlı değildir.

```text
agent ≠ model
agent ≠ chat transcript
agent ≠ frontend

chat = user-facing projection of persistent Rivet state
```
