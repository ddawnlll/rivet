import { Credential } from "@opencode-ai/core/credential"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { Integration } from "@opencode-ai/core/integration"
import { Effect, Layer } from "effect"
import { Auth } from "."

/**
 * One-time migration: promote legacy `auth.json` provider keys into the V2
 * credential store. The Rivet SessionRunner resolves model credentials through
 * V2 integrations/credentials; without this migration every provider that only
 * exists in legacy auth.json (e.g. `opencode-go`) is unavailable to the runner
 * and prompts fail with ModelUnavailableError.
 *
 * Idempotent per provider: a provider that already has any V2 credential is
 * left untouched.
 */
const migrateLegacyAuth: Effect.Effect<void, never, Auth.Service | Credential.Service> = Effect.gen(function* () {
  const auth = yield* Auth.Service
  const credentials = yield* Credential.Service
  const entries = Object.entries(yield* auth.all().pipe(Effect.orDie))
  for (const [providerID, info] of entries) {
    const integrationID = Integration.ID.make(providerID)
    const existing = yield* credentials.list(integrationID)
    if (existing.length > 0) continue
    if (info.type === "api") {
      yield* credentials.create({
        integrationID,
        value: { type: "key", key: info.key, ...(info.metadata ? { metadata: info.metadata } : {}) },
      })
      continue
    }
    if (info.type === "wellknown") {
      yield* credentials.create({
        integrationID,
        value: { type: "key", key: info.key, metadata: { token: info.token } },
      })
      continue
    }
    yield* credentials.create({
      integrationID,
      value: {
        type: "oauth",
        methodID: Integration.MethodID.make("device"),
        refresh: info.refresh,
        access: info.access,
        expires: info.expires,
        ...(info.accountId ? { metadata: { accountId: info.accountId } } : {}),
      },
    })
  }
})

export const node = makeGlobalNode({
  name: "legacy-auth-migration",
  layer: Layer.effectDiscard(migrateLegacyAuth),
  deps: [Auth.node, Credential.node],
})

export { node as LegacyAuthMigration }
