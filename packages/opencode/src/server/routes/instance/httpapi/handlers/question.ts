import { Question } from "@/question"
import { QuestionID } from "@/question/schema"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { MessageID } from "@/session/schema"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { QuestionV2 } from "@opencode-ai/core/question"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { QuestionNotFoundError } from "../errors"

export const questionHandlers = HttpApiBuilder.group(InstanceHttpApi, "question", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Question.Service
    const locations = yield* Effect.serviceOption(LocationServiceMap.Service)

    const withLocationQuestionV2 = <A, E>(
      use: (q2: QuestionV2.Interface) => Effect.Effect<A, E>,
    ) =>
      Effect.gen(function* () {
        if (locations._tag !== "Some") return undefined
        const instance = yield* InstanceRef
        if (!instance?.directory) return undefined
        const workspaceID = yield* WorkspaceRef
        const ref = Location.Ref.make({
          directory: AbsolutePath.make(instance.directory),
          ...(workspaceID ? { workspaceID } : {}),
        })
        const layer = locations.value.get(ref)
        const q2 = yield* QuestionV2.Service.pipe(Effect.provide(layer))
        return yield* use(q2)
      })

    const list = Effect.fn("QuestionHttpApi.list")(function* () {
      const v1List = yield* svc.list()
      const v2List = yield* withLocationQuestionV2((q2) => q2.list()).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!v2List || v2List.length === 0) return v1List
      const v1Ids = new Set(v1List.map((item) => String(item.id)))
      const mappedV2 = v2List
        .filter((item) => !v1Ids.has(String(item.id)))
        .map((item) => ({
          id: QuestionID.make(item.id),
          sessionID: item.sessionID,
          questions: item.questions,
          tool: item.tool ? { messageID: MessageID.make(item.tool.messageID), callID: item.tool.callID } : undefined,
        }))
      return [...v1List, ...mappedV2]
    })

    const reply = Effect.fn("QuestionHttpApi.reply")(function* (ctx: {
      params: { requestID: QuestionID }
      payload: Question.Reply
    }) {
      const v1Result = yield* svc
        .reply({
          requestID: ctx.params.requestID,
          answers: ctx.payload.answers,
        })
        .pipe(
          Effect.as(true),
          Effect.catchTag("Question.NotFoundError", () => Effect.succeed(false)),
        )
      if (v1Result) return true

      const v2Settled = yield* withLocationQuestionV2((q2) =>
        q2.reply({
          requestID: QuestionV2.ID.make(ctx.params.requestID),
          answers: ctx.payload.answers,
        }),
      ).pipe(
        Effect.as(true),
        Effect.catchTag("QuestionV2.NotFoundError", () => Effect.succeed(false)),
      )
      if (v2Settled) return true

      return yield* Effect.fail(
        new QuestionNotFoundError({
          requestID: String(ctx.params.requestID),
          message: `Question request not found: ${ctx.params.requestID}`,
        }),
      )
    })

    const reject = Effect.fn("QuestionHttpApi.reject")(function* (ctx: { params: { requestID: QuestionID } }) {
      const v1Result = yield* svc.reject(ctx.params.requestID).pipe(
        Effect.as(true),
        Effect.catchTag("Question.NotFoundError", () => Effect.succeed(false)),
      )
      if (v1Result) return true

      const v2Settled = yield* withLocationQuestionV2((q2) =>
        q2.reject(QuestionV2.ID.make(ctx.params.requestID)),
      ).pipe(
        Effect.as(true),
        Effect.catchTag("QuestionV2.NotFoundError", () => Effect.succeed(false)),
      )
      if (v2Settled) return true

      return yield* Effect.fail(
        new QuestionNotFoundError({
          requestID: String(ctx.params.requestID),
          message: `Question request not found: ${ctx.params.requestID}`,
        }),
      )
    })

    return handlers.handle("list", list).handle("reply", reply).handle("reject", reject)
  }),
)
