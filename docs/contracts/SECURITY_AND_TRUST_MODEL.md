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

## Resource and execution sandbox

Prompt resource control değildir; komut dizesi içindeki substring kara listeleri (`contains("curl")`) da güvenlik sınırı değildir. Güvenlik donanım ve çekirdek (kernel) seviyesinde uygulanır:

1. **Filesystem Confinement (`cap-std`):** Ortamdaki global dosya sistemine ambient erişim kapatılır. Tüm dosya işlemleri çalışma dizinini temsil eden açık `cap_std::fs::Dir` capability tanıtıcısı üzerinden yapılır. `../../` traversal ve symlink yarış koşulu (TOCTOU) açıkları imkânsız kılınır.
2. **Syscall Boundary (Linux `seccompiler`):** Child process'lerin `ptrace`, `mount`, `unshare`, `kexec`, `reboot` gibi yetki yükseltme veya izolasyon dışına çıkma potansiyeli taşıyan syscall'ları seccomp-BPF filtreleriyle engellenir.
3. **Filesystem Rights (Linux `landlock`):** Unprivileged process'in dosya sistemi görünürlüğü yalnızca çalışma dizini ve derleyici/araç yollarıyla sınırlandırılır.
4. **Kaynak Tavanları (`rlimit` & cgroups):** CPU süresi, maksimum bellek, açık dosya tanımlayıcıları ve azami PID kotaları işletim sistemi seviyesinde kilitlenir.
5. **Windows İzolasyonu (`windows` crate):** Windows üzerinde `Win32_System_JobObjects` ile process ağacı ve bellek sınırları resmi Microsoft API'leri üzerinden yönetilir; timeout durumunda tüm alt süreçler (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) garantili biçimde sonlandırılır.

## Credential security and key management

API anahtarları ve sağlayıcı kimlik bilgileri düz metin JSON dosyalarında veya genel ortam değişkenlerinde savunmasız bırakılmaz:

- **OS Keyring (`keyring`):** macOS Keychain, Windows Credential Manager ve Linux Secret Service üzerinden platform düzeyinde şifreli saklanır. Headless/CI ortamları için `EnvCredentialStore` fallback sağlanır.
- **Bellek Koruma (`secrecy` + `zeroize`):** Anahtarlar `SecretString` ile sarmalanarak yanlışlıkla loglara veya debug çıktılarına yazılması önlenir; nesne serbest bırakıldığında (drop) bellek derleyici optimizasyonuna takılmadan sıfırlanır (`zeroize`).

## Cryptographic receipts and transparency

Doğrulama ve yürütme kanıtları Merkle ağaçları ile mühürlenir:

- **RFC 6962 Domain Separation:** Yaprak hash'leri `0x00 || data`, düğüm hash'leri `0x01 || left || right` ile domain-separated olarak SHA-256 üzerinden hesaplanır.
- **Collision Protection:** Tek yaprakların kopyalanması (CVE-2012-2459 açığı) önlenir; receipt içine ağaç boyutu (`tree_size`), kök (`root`), yaprak indeksi ve inclusion proof mühürlenir.

