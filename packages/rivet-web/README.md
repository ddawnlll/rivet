# Rivet Web GUI

This directory is the **Web & Tauri shared build** (`web/dist`).

- **Stack:** Vite + React + strict TypeScript. The UI consumes `RivetService` through WebSocket/REST.
- **Served by:** `rivet serve` (`crates/rivet-api`) — serves `web/dist` at `/` and API at `/api/*`
- **Tauri:** wraps the same `web/dist` via `tauri::command` → `RivetService` (zero-latency in-process)

## Runtime surfaces

The design agent **owns** visuals, but **must not** change the service contract:

- Chat is the focal surface; Hard State, Soft Workspace, Praxis, Census, history, and Implementation Studio are projections.
- Hard State is authoritative and crisp; Soft Workspace is provisional and dashed/quiet.
- Runtime lifecycle, typed cognitive state, tool activity, observations, Praxis updates, and Hard State mutations arrive through the event stream.

### WebSocket (zero-latency, primary)
```
WS /api/ws  (persistent, TCP_NODELAY, no polling)
  -> { "type": "step", "prompt": "...", "goal": "..." }
  -> { "type": "goal", "prompt": "..." }
  -> { "type": "cancel" }
  <- { "type": "assistant_delta", "delta": "..." }  // per-token, try_send non-blocking
  <- { "type": "status", "phase": "...", "message": "..." }
  <- { "type": "verification_update", ... }
```

### REST (low-freq queries)
```
GET  /api/state        → StateDto (Tier1+2+3)
GET  /api/obligations  → ObligationDto[] (Tier1)
GET  /api/workspace    → SoftWorkspaceSummary (Tier2)
GET  /api/census       → CensusDto (Tier3)
GET  /api/view?goal=   → CognitiveView
GET  /api/health       → HealthDto
POST /api/step         → StepResponse (fallback, unary)
POST /api/goal         → GoalSummaryDto
POST /api/cancel       → {status}
GET  /api/stream       → SSE fallback (EventSource)
```

All types are in `crates/rivet-service/src/lib.rs` — design agent should generate TypeScript types from there or copy DTOs.

## Build contract for `rivet serve`

```bash
cd web
npm install
npm run build   # must output to web/dist (Vite default)
# then
cargo run -p rivet -- serve --addr 127.0.0.1:3000
# → http://127.0.0.1:3000  (GUI)
# → ws://127.0.0.1:3000/api/ws (zero-latency)
```

Do not add new Rust dependencies without syncing with `rivet-service` maintainer.

## Local commands

```bash
cd web
npm install
npm run dev
```

For the production-served GUI:

```bash
cd web && npm run build
cargo run -p rivet -- serve . --addr 127.0.0.1:3000
```

The browser client uses `/api/ws` for live events and falls back to `/api/step` for unary requests. Provider/model selection is resolved by the Rust provider registry; the UI never invents model or state truth.
