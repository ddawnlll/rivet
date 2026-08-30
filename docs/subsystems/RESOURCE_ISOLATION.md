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
