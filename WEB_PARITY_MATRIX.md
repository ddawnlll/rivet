# Rivet Web UI parity matrix

| TUI feature | Adapter support | Web surface | Status |
| --- | --- | --- | --- |
| Chat stream + raw multiline editor | WS `assistant_delta`, `status`, REST fallback | Conversation + Composer | Implemented |
| Goal compiler | WS/REST `/goal`, Hard State revision | `/goal` command + Hard inspector | Implemented |
| Obligations, claims, contradictions | `/state`, `/obligations` | Hard State inspector | Implemented |
| Soft Workspace / cognitive view | `/state`, `/workspace`, `/view` | Soft Workspace inspector + activity aperture | Implemented |
| Praxis receipts | `verification_update`, typed `praxis_update` | Praxis inspector + live spine | Implemented |
| Tool calls / observations | typed Harness event bridge → WS | chronological live activity spine | Implemented |
| Hard State mutation | typed Harness event bridge → WS | authoritative mutation activity | Implemented |
| Cancellation | WS/REST cancel + service cancellation channel | stop/cancel controls | Implemented |
| Steering | WS `steer`, REST `/steer` | composer while run is active | Implemented; serialized by Harness cycle lock |
| Project/revision context | `/project` + Git inspection | project selector + settings dialog | Implemented; current service project only |
| Provider/model picker | provider registry + `/models` + `/models/select` | live model catalog | Implemented |
| Census/frontier | `/census` | on-demand census projection | Implemented |
| Git diff / implementation inspect | `/diff` | Implementation Studio | Implemented |
| Session history | service session `/history` | history inspector | Implemented; persistent conversation history remains deferred |
| File mention fuzzy picker | TUI-only local frontier picker | bounded browser file attachment | Implemented as text attachment pipeline; fuzzy repo picker deferred |
| Provider connect wizard | TUI auth store / CLI | unavailable state in model catalog | Deferred: secure credential entry stays CLI-owned |
| Theme picker / TUI clipboard / terminal doctor | TUI-only terminal affordances | browser equivalents are not authoritative | Deferred / not applicable to Web UI |

The frontend is a projection layer: it does not compute epistemic status, mint authority, or synthesize Praxis success.
