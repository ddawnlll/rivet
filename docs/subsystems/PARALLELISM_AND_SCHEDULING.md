# Parallelism and conflict-aware scheduling

Bun vakasının ilk false start'ı, çok sayıda agent açmanın tek başına parallelism olmadığını gösterir. Shared mutable state üzerinde concurrency conflict graph olmadan throughput kolayca negative olabilir.

Rivet scheduler her task için en az şu bilgileri tutmalıdır:

```yaml
task:
  read_set: [src/auth/**]
  write_set: [src/auth/session.rs]
  resources: [cargo_workspace_lock]
  depends_on: [T17]
  produces: [PatchP9]
```

Safe parallel set:

```text
T1 writes A.rs
T2 reads B.rs
T3 writes A.rs
T4 runs exclusive integration DB

parallel: T1 || T2
conflict: T1 x T3
resource conflict: T4 x any other DB test
```

Formal olarak scheduler “N worker spawn” komutu yerine approximate **maximal independent runnable task set** bulmaya çalışabilir.
