# Premise Audit and Competing Models

Rivet'in temel sezgisi çekici olduğu için yanlış olma ihtimali özellikle ciddiye alınmalıdır. Aşağıdaki alternatif modeller aynı gözlemleri açıklayabilir.

## Alternative A — model cognition dominates; external state adds little

Claim: Frontier modeller project state’i mevcut context/retrieval mekanizmalarıyla zaten yeterince iyi yeniden kuruyor olabilir; explicit hard/soft state ek karmaşıklık yaratıp karar kalitesini anlamlı artırmayabilir.

Prediction if true: Hard/Soft State ve Cognitive View aynı model altında repeated reads’i azaltsa bile verified success, repeated-error rate veya wall-clock/cost üzerinde anlamlı net kazanç üretmez.

Discriminating experiment: E0–E3 aynı model, capabilities ve verification standardıyla karşılaştırılır; avantaj yalnız metadata/auditability ise tez kapsamı daraltılır.

## Alternative B — context reconstruction may preserve useful plasticity

Context-centric agents’in tekrar okuması verimsiz görünse de her yeni observation sonrası eski çerçeveyi serbestçe yeniden kurmalarına izin verir. Persistent state ve projection, yanlış framing’i daha uzun yaşayabilir.

Prediction if true: Rivet daha az repeated discovery üretir fakat stale belief, projection bias veya state-repair maliyeti artar; context-centric baseline daha plastik kalır.

Falsifier for Rivet: persistent state’in continuity kazancı wrong-projection + stale-state + repair maliyetini karşılamıyorsa externalization net avantaj değildir.

## Alternative C — state/view maintenance costs exceed reconstruction savings

Hard-state revision, provenance, invalidation, Cognitive View compilation ve repository census maliyeti büyük projelerde ciddi olabilir.

Prediction if true: warm-state avantajına rağmen state update/projection overhead’i median task süresini veya toplam compute’u baseline’ın üstüne çıkarır; özellikle küçük görevlerde Rivet gereksiz ağır kalır.

Required measurement: cold-start census, warm-state update, view-compilation cost, state-repair cost ve task-size-stratified break-even point.

## Alternative D — deterministic normalization hides semantic information

Raw compiler/test logs'un typed event'lere sıkıştırılması, kritik diagnostic details'i kaybedebilir.

**Prediction if true:** Model daha az token görür ama yanlış diagnosis artar; sonradan raw log retrieval oranı çok yüksek olur.

**Countermeasure hypothesis:** progressive disclosure; parser summary authoritative truth değil, index/summary olmalıdır. Raw evidence ledger erişilebilir kalır.

## Alternative E — capability ontology becomes a new hard-coded harness

`build`, `test`, `find_references` gibi abstractions yeterli olmayabilir. Gerçek repos'larda custom codegen, generated sources, cross-language build edges, remote services ve bespoke scripts abstraction'ı patlatabilir.

**Prediction if true:** Unknown capability rate ve model-assisted discovery rate yüksek kalır; project-specific adapters çoğalır ve “generalist core” fiilen framework zoo'ya dönüşür.

**Falsifier:** benchmark dilleri/ekosistemleri büyüdükçe core branch count veya manual provider code linearly büyürse generalist claim başarısızdır.

## Alternative F — benchmark success hides production failure

SWE-bench family kısa/orta horizon issue repair için faydalıdır fakat Bun tarzı multi-day migration, release engineering ve cross-platform CI orchestration'ı tam temsil etmez.

**Consequence:** Rivet iki benchmark ailesinde test edilmelidir: issue repair ve long-horizon transformation.

## Alternative G — prompt caching already solves enough of the token problem

Modern providers repeated-prefix prompt caching ile cached input cost/latency'yi düşürebilir. Bu durumda structured state'in ekonomik avantajı uncached token kadar büyük olmayabilir.

**Required accounting:** uncached input, cached read, cache write, output/reasoning ve model-call latency ayrı ölçülmelidir. “Total tokens” tek başına maliyet metriği değildir.

## Alternative H — persistent memory institutionalizes model error

Context-centric agent bazı hataları reset ile unutabilir. Rivet yanlış inference'ı hard state'e erken promote ederse aynı hata session'lar boyunca yaşayabilir ve downstream scheduler/retrieval tarafından güçlendirilebilir. Bu risk repeated-error azalmasından daha pahalı olabilir.

## Alternative I — correct memory, wrong cognitive projection

Underlying hard state doğru olsa bile Cognitive View Compiler task için yanlış entities/relations seçebilir. Model yanlış fakat “temiz” context üzerinde yüksek kaliteli reasoning yapar. Retrieval/projection failure model failure'dan ayrı ölçülmelidir.

## Alternative J — hierarchical relevance over-prunes the repository

LLM klasör-level relevance kararında kritik ama düşük-signal bir subtree'yi `DEFER` edebilir. Compute azalırken localization recall düşebilir. Relevance frontier reopen semantics ve cheap counterfactual sampling gerekebilir.

## Alternative K — soft workspace becomes a second context window

Soft state bounded/competitive tutulamazsa active hypotheses, notes ve candidate actions birikerek chat history'nin başka formatta kopyasına dönüşür. Workspace utility per token/object ayrıca ölçülmelidir.

## Alternative L — frontier-model progress erases the architectural advantage

Daha uzun context, daha iyi native memory/retrieval ve daha ucuz inference baseline'ın repeated reconstruction maliyetini hızla düşürebilir. Rivet'in avantajı permanent kabul edilmemeli; aynı evaluation suite yeni frontier modellerde periyodik tekrar edilmelidir.
