# Resource isolation

Bun test suite'inin ~10k process spawn eden, socket limitlerini tüketen ve gigabyte'larca I/O yapan testleri için `systemd-run`/cgroups gibi gerçek isolation kullanılması, resource governance'ın prompt diliyle çözülemeyeceğini gösterir.

Rivet sandbox contract örneği:

```yaml
sandbox:
  cpu_cores: 2
  memory_mb: 4096
  pids: 512
  disk_write_mb: 2048
  network:
    outbound: restricted
  timeout_seconds: 600
  kill_policy: hard
```

## Production sandboxing implementation stack

Rivet execution runtime'ı işletim sistemi bazında katmanlı bir savunma hattı (*defense-in-depth*) uygular:

1. **Filesystem Capability (`cap-std`):** Tüm dosya okuma ve yazma işlemleri global kök dizin yerine `cap_std::fs::Dir` nesnesi üzerinden sınırlandırılır. Symlink yarış koşulları ve dizin dışına çıkma girişimleri engellenir.
2. **Linux Sandbox Katmanı:**
   - **Landlock (`landlock` crate):** Çekirdek seviyesinde dosya sistemi erişim haklarını kısıtlar (yalnızca izin verilen çalışma ve araç dizinleri).
   - **Syscall Filtreleme (`seccompiler`):** Seccomp-BPF ile tehlikeli sistem çağrılarını (`ptrace`, `mount`, `unshare`, vb.) bloklar.
   - **Kaynak Kotaları (`rlimit` crate):** Azami işlemci süresi, bellek tavanı ve dosya boyutu limitlerini enforce eder.
3. **Windows Process Containment (`windows` crate):** Microsoft resmi `windows` crate'i ile `Win32_System_JobObjects` oluşturulur; alt süreçlerin yetkisiz yaşam döngüsü ve bellek sızıntıları garantili biçimde yönetilir.

