# Open Questions

1. **Invocation gate:** semantic uncertainty nasıl operationalize edilecek? Rule-based gate yeterli mi, learned policy gerekli mi?
2. **Graph store:** relational DB, embedded graph, SQLite tables + indexes, event-sourced log veya hybrid?
3. **Stable identity:** symbols rename/move/refactor sonrası identity continuity nasıl korunacak?
4. **Capability ontology:** abstraction granularity ne kadar olmalı? `build` fazla geniş, command-level fazla spesifik olabilir.
5. **Provider trust:** LLM-discovered command ne kadar probing sonrası verified sayılabilir?
6. **Non-buildable repositories:** incomplete checkout veya external secrets gereken projects nasıl model edilir?
7. **Distributed systems:** local repo graph external APIs/services'i hangi abstraction ile taşır?
8. **Generated code:** source-of-truth ve generated artifact ownership nasıl ayrılır?
9. **Context selection:** rule/graph retrieval/embedding/learned selector karşılaştırması.
10. **Local models:** Tier-1 cheap/local models hangi decisions için yeterli?
11. **Hephaestus trigger:** stagnation nasıl ölçülür; gereksiz reflection nasıl önlenir?
12. **Independent reviewer diversity:** different context yeterli mi, model/provider diversity gerekli mi?
13. **Human interruptions:** goal edits current task graph'ı transactional nasıl invalidate eder?
14. **Long-horizon persistence:** haftalar süren task'ta stale beliefs/capabilities nasıl expire edilir?
15. **Security:** malicious repo prompt injection/project hooks nasıl evidence olarak okunup execution'dan ayrılır?
16. **Token accounting:** provider hidden reasoning veya non-token compute nasıl normalize edilir?
17. **Cold-start break-even:** küçük tasklarda environment compile overhead ne zaman gereksiz?
18. **Agent identity:** multiple workers epistemically independent mi yoksa aynı foundation model nedeniyle correlated mı?
19. **Observation parser:** deterministic parsers hangi noktada brittle DSL zoo'ya dönüşür?
20. **Completion semantics:** non-testable goals için Praxis nasıl executable acceptance üretir?

## v0.2 state/representation questions

1. Soft workspace kapasitesi fixed object count, token budget, learned eviction veya utility score ile mi sınırlandırılmalı?
2. Hard state'te hangi claim classes Praxis receipt gerektirir, hangileri source-backed supported state olarak kalabilir?
3. Cognitive View Compiler retrieval + ranking + semantic compression'ı tek frontier call ile mi, küçük model ile mi, deterministic path selection ile mi yapmalı?
4. LLM-led directory pruning'in false-negative rate'i nasıl ölçülmeli; deferred subtree counterfactual sampling gerekli mi?
5. Project ontology induction ilk framing'e path-dependent hale gelirse alternative ontology challenge nasıl tetiklenmeli?
6. Greenfield project formation ile existing-project induction aynı hard/soft semantics'i gerçekten paylaşabiliyor mu?
7. Model replacement (Claude/GPT/DeepSeek/etc.) soft workspace continuation'da semantic drift yaratıyor mu?
8. V8 gibi governance-heavy project'te kazanç ordinary SaaS/data reposuna transfer oluyor mu?

## v0.3 technical questions

1. **redb vs SQLite:** explicit indexes + replay model redb'de yeterince ergonomik mi; query complexity Noesis iteration'ını yavaşlatırsa SQLite comparison gerekli mi?
2. **event payload format:** schema evolution için JSON/CBOR/postcard/bincode trade-off'u; zero-copy archive format erken kilitlenmeli mi?
3. **workspace checkpoint:** crash sonrası soft state kaybı hangi task horizon'ında unacceptable olur?
4. **structured output fallback:** provider strict schema desteklemiyorsa parse/repair policy kaç denemeden sonra failure sayılmalı?
5. **process sandbox:** first local runtime'ın OS-level containment minimumu Linux/macOS/Windows'ta nasıl normalize edilecek?
6. **artifact store:** büyük raw outputs redb içinde mi, content-addressed filesystem blob store'da mı tutulmalı?
7. **view caching:** Cognitive View hangi hard/soft/frontier revisions'a göre cacheable; stale cache nasıl proof-carrying biçimde reddedilir?
8. **repository identity:** clone/move/remote change sonrası ProjectId nasıl korunmalı; canonical path tek başına yeterli değil.
9. **model streaming:** assistant prose ve structured action frames aynı stream'de nasıl güvenli ayrılmalı?
10. **cancellation atomicity:** patch uygulanmış ama verification başlamadan cancel olursa task/obligation state ne olmalı?
11. **ACCP compiler integration:** existing compiler API hot-path typed decisions'a nasıl map edilir; YAML round-trip tamamen audit-only yapılabilir mi?
12. **Praxis registry:** verifier discovery project induction'dan mı, static provider registration'dan mı başlamalı?
