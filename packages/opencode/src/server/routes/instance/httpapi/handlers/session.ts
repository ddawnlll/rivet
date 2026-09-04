import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Agent } from "@/agent/agent"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionV2 } from "@opencode-ai/core/session"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { AgentAttachment } from "@opencode-ai/schema/prompt"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Database } from "@opencode-ai/core/database/database"
import { SessionSemantics } from "@opencode-ai/core/session/semantics"
import { inductionMarkerStatus, type InductionMarker } from "@opencode-ai/core/rivet/repository/induction"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Command } from "@/command"
import { Permission } from "@/permission"
import { SessionShare } from "@/share/session"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { Provider } from "@/provider/provider"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { Shell } from "@opencode-ai/core/shell"
import { Process } from "@/util/process"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { NamedError } from "@opencode-ai/core/util/error"
import { Cause, Effect, Exit, Option, Schema, Scope } from "effect"
import * as Stream from "effect/Stream"
import { InstanceState } from "@/effect/instance-state"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError, HttpApiSchema } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import {
  CommandPayload,
  DiffQuery,
  ForkPayload,
  InductionStartPayload,
  InductionStatus,
  InitPayload,
  ListQuery,
  MessagesQuery,
  PermissionResponsePayload,
  PromptPayload,
  RevertPayload,
  ShellPayload,
  SummarizePayload,
  UpdatePayload,
} from "../groups/session"
import { PermissionNotFoundError } from "../errors"
import * as SessionError from "./session-errors"

const tryParseJson = (text: string) =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () => new HttpApiError.BadRequest({}),
  })

function toInductionStatus(marker: InductionMarker | undefined): InductionStatus {
  if (!marker) return { status: "idle" }
  return {
    status: marker.status,
    startedAt: marker.startedAt,
    completedAt: marker.completedAt,
    fileCount: marker.fileCount,
    claimCount: marker.result?.claims.length,
    packageCount: marker.result?.packages.length,
    filesRead: marker.result?.filesRead,
  }
}

export const sessionHandlers = HttpApiBuilder.group(InstanceHttpApi, "session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    const shareSvc = yield* SessionShare.Service
    const promptSvc = yield* SessionPrompt.Service
    const sessionV2 = yield* SessionV2.Service
    const revertSvc = yield* SessionRevert.Service
    const compactSvc = yield* SessionCompaction.Service
    const runState = yield* SessionRunState.Service
    const agentSvc = yield* Agent.Service
    const permissionSvc = yield* Permission.Service
    const statusSvc = yield* SessionStatus.Service
    const todoSvc = yield* Todo.Service
    const summary = yield* SessionSummary.Service
    const events = yield* EventV2Bridge.Service
    const commandSvc = yield* Command.Service
    const config = yield* Config.Service
    const scope = yield* Scope.Scope

    const list = Effect.fn("SessionHttpApi.list")(function* (ctx: { query: typeof ListQuery.Type }) {
      const directory = ctx.query.directory ? yield* InstanceState.directory : undefined
      return yield* session.list({
        directory: ctx.query.scope === "project" ? undefined : directory,
        scope: ctx.query.scope,
        path: ctx.query.path,
        roots: ctx.query.roots,
        start: ctx.query.start,
        search: ctx.query.search,
        limit: ctx.query.limit,
      })
    })

    const status = Effect.fn("SessionHttpApi.status")(function* () {
      return Object.fromEntries(yield* statusSvc.list())
    })

    const requireSession = Effect.fn("SessionHttpApi.requireSession")(function* (sessionID: SessionID) {
      return yield* SessionError.mapStorageNotFound(session.get(sessionID))
    })

    const get = Effect.fn("SessionHttpApi.get")(function* (ctx: { params: { sessionID: SessionID } }) {
      return yield* requireSession(ctx.params.sessionID)
    })

    const children = Effect.fn("SessionHttpApi.children")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* session.children(ctx.params.sessionID)
    })

    const todo = Effect.fn("SessionHttpApi.todo")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* todoSvc.get(ctx.params.sessionID)
    })

    const diff = Effect.fn("SessionHttpApi.diff")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof DiffQuery.Type
    }) {
      return yield* summary.diff({ sessionID: ctx.params.sessionID, messageID: ctx.query.messageID })
    })

    const messages = Effect.fn("SessionHttpApi.messages")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof MessagesQuery.Type
    }) {
      if (ctx.query.before && ctx.query.limit === undefined) return yield* new HttpApiError.BadRequest({})
      if (ctx.query.before) {
        const before = ctx.query.before
        yield* Effect.try({
          try: () => MessageV2.cursor.decode(before),
          catch: () => new HttpApiError.BadRequest({}),
        })
      }
      yield* requireSession(ctx.params.sessionID)
      if (ctx.query.limit === undefined || ctx.query.limit === 0) {
        return yield* SessionError.mapStorageNotFound(session.messages({ sessionID: ctx.params.sessionID }))
      }

      const page = yield* SessionError.mapStorageNotFound(
        MessageV2.page({
          sessionID: ctx.params.sessionID,
          limit: ctx.query.limit,
          before: ctx.query.before,
        }),
      )
      if (!page.cursor) return page.items

      const request = yield* HttpServerRequest.HttpServerRequest
      // toURL() honors the Host + x-forwarded-proto headers, so the Link
      // header echoes the real origin instead of a hard-coded localhost.
      const url = Option.getOrElse(HttpServerRequest.toURL(request), () => new URL(request.url, "http://localhost"))
      url.searchParams.set("limit", ctx.query.limit.toString())
      url.searchParams.set("before", page.cursor)
      return HttpServerResponse.jsonUnsafe(page.items, {
        headers: {
          "Access-Control-Expose-Headers": "Link, X-Next-Cursor",
          Link: `<${url.toString()}>; rel="next"`,
          "X-Next-Cursor": page.cursor,
        },
      })
    })

    const message = Effect.fn("SessionHttpApi.message")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      return yield* SessionError.mapStorageNotFound(
        MessageV2.get({ sessionID: ctx.params.sessionID, messageID: ctx.params.messageID }),
      )
    })

    const create = Effect.fn("SessionHttpApi.create")(function* (ctx: { payload?: Session.CreateInput }) {
      return yield* shareSvc.create(ctx.payload)
    })

    const createRaw = Effect.fn("SessionHttpApi.createRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* create({})

      const json = yield* tryParseJson(body)
      const decoded = yield* Schema.decodeUnknownEffect(Session.CreateInput)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      const payload = decoded
        ? {
            ...decoded,
            permission: decoded.permission ? [...decoded.permission] : undefined,
          }
        : decoded
      return yield* create({ payload })
    })

    const remove = Effect.fn("SessionHttpApi.remove")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* SessionError.mapStorageNotFound(session.remove(ctx.params.sessionID))
      return true
    })

    const update = Effect.fn("SessionHttpApi.update")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof UpdatePayload.Type
    }) {
      const current = yield* requireSession(ctx.params.sessionID)
      if (ctx.payload.title !== undefined) {
        yield* session.setTitle({ sessionID: ctx.params.sessionID, title: ctx.payload.title })
      }
      if (ctx.payload.metadata !== undefined) {
        yield* session.setMetadata({ sessionID: ctx.params.sessionID, metadata: ctx.payload.metadata })
      }
      if (ctx.payload.permission !== undefined) {
        yield* session.setPermission({
          sessionID: ctx.params.sessionID,
          permission: Permission.merge(current.permission ?? [], ctx.payload.permission),
        })
      }
      if (ctx.payload.time?.archived !== undefined) {
        yield* session.setArchived({ sessionID: ctx.params.sessionID, time: ctx.payload.time.archived })
      }
      return yield* requireSession(ctx.params.sessionID)
    })

    const fork = Effect.fn("SessionHttpApi.fork")(function* (ctx: {
      params: { sessionID: SessionID }
      payload?: typeof ForkPayload.Type
    }) {
      return yield* SessionError.mapStorageNotFound(
        session.fork({
          sessionID: ctx.params.sessionID,
          messageID: ctx.payload?.messageID,
        }),
      )
    })

    const forkRaw = Effect.fn("SessionHttpApi.forkRaw")(function* (ctx: {
      params: { sessionID: SessionID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* fork({ params: ctx.params })

      const json = yield* tryParseJson(body)
      const payload = yield* Schema.decodeUnknownEffect(ForkPayload)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      return yield* fork({ params: ctx.params, payload })
    })

    const abort = Effect.fn("SessionHttpApi.abort")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* sessionV2.interrupt(ctx.params.sessionID)
      yield* promptSvc.cancel(ctx.params.sessionID)
      return true
    })

    // share/unshare errors aren't all client-induced — storage and network
    // failures from SessionShare are real possibilities. Map to a typed 500
    // (matches the legacy route behavior which routed any failure through
    // ErrorMiddleware → NamedError.Unknown 500) instead of blanket-mapping
    // every failure to a 400 BadRequest.
    const share = Effect.fn("SessionHttpApi.share")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      yield* shareSvc.share(ctx.params.sessionID).pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      return yield* requireSession(ctx.params.sessionID)
    })

    const unshare = Effect.fn("SessionHttpApi.unshare")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      yield* shareSvc
        .unshare(ctx.params.sessionID)
        .pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      return yield* requireSession(ctx.params.sessionID)
    })

    const summarize = Effect.fn("SessionHttpApi.summarize")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof SummarizePayload.Type
    }) {
      yield* revertSvc.cleanup(yield* requireSession(ctx.params.sessionID))
      const messages = yield* SessionError.mapStorageNotFound(session.messages({ sessionID: ctx.params.sessionID }))
      const defaultAgent = yield* agentSvc.defaultAgent()
      const currentAgent = messages.findLast((message) => message.info.role === "user")?.info.agent ?? defaultAgent

      yield* compactSvc.create({
        sessionID: ctx.params.sessionID,
        agent: currentAgent,
        model: {
          providerID: ctx.payload.providerID,
          modelID: ctx.payload.modelID,
        },
        auto: ctx.payload.auto ?? false,
      })
      yield* sessionV2.resume(ctx.params.sessionID).pipe(Effect.ignore)
      return true
    })

    // Rivet harness admission: prompts enter durable SessionV2 input and are
    // drained by the Rivet SessionRunner. The legacy SessionPrompt loop is
    // decommissioned and rejects any direct call.
    const toV2Prompt = (payload: typeof PromptPayload.Type): PromptInput.Prompt => {
      const texts: string[] = []
      const files: PromptInput.FileAttachment[] = []
      const agents: AgentAttachment[] = []
      for (const part of payload.parts) {
        if (part.type === "text") texts.push(part.text)
        if (part.type === "file")
          files.push({ uri: part.url, ...(part.filename ? { name: part.filename } : {}) })
        if (part.type === "agent") agents.push({ name: part.name })
      }
      return {
        text: texts.join("\n\n"),
        ...(files.length > 0 ? { files } : {}),
        ...(agents.length > 0 ? { agents } : {}),
      }
    }

    const admitRivetPrompt = Effect.fn("SessionHttpApi.admitRivetPrompt")(function* (
      sessionID: SessionID,
      payload: typeof PromptPayload.Type,
      resume = true,
    ) {
      if (payload.agent) {
        yield* sessionV2.switchAgent({ sessionID, agent: payload.agent }).pipe(
          Effect.mapError(() => new HttpApiError.BadRequest({})),
        )
      }
      if (payload.model) {
        yield* sessionV2
          .switchModel({
            sessionID,
            model: { id: payload.model.modelID, providerID: payload.model.providerID },
          })
          .pipe(
          Effect.mapError(() => new HttpApiError.BadRequest({})),
        )
      }
      return yield* sessionV2.prompt({
        ...(payload.messageID ? { id: SessionMessage.ID.make(payload.messageID) } : {}),
        sessionID,
        prompt: toV2Prompt(payload),
        ...(resume ? {} : { resume: false }),
      })
    })

    const prompt = Effect.fn("SessionHttpApi.prompt")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      yield* revertSvc.cleanup(yield* requireSession(ctx.params.sessionID))
      const respond = (message: unknown) =>
        HttpServerResponse.stream(Stream.make(JSON.stringify(message)).pipe(Stream.encodeText), {
          contentType: "application/json",
        })
      if (ctx.payload.noReply === true) {
        const admitted = yield* admitRivetPrompt(ctx.params.sessionID, ctx.payload, false).pipe(
          Effect.mapError(() => new HttpApiError.BadRequest({})),
        )
        return respond({
          info: {
            id: admitted.id,
            role: "user",
            sessionID: ctx.params.sessionID,
            agent: ctx.payload.agent,
            model: ctx.payload.model,
            time: { created: Date.now() },
          },
          parts: ctx.payload.parts,
        })
      }
      const admitted = yield* admitRivetPrompt(ctx.params.sessionID, ctx.payload).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      // Join the Rivet drain started by admission so the response reflects a
      // completed turn, then read the projected assistant message.
      const drainExit = yield* Effect.exit(sessionV2.resume(ctx.params.sessionID))
      // The V2 projector materializes runner output asynchronously; wait
      // briefly for the projected assistant turn before responding.
      const deadline = Date.now() + (Exit.isSuccess(drainExit) ? 10_000 : 500)
      let msgs: SessionV1.WithParts[] = []
      let last: SessionV1.WithParts | undefined
      while (Date.now() < deadline) {
        msgs = yield* SessionError.mapStorageNotFound(session.messages({ sessionID: ctx.params.sessionID }))
        last = msgs.findLast((entry) => entry.info.role !== "user")
        if (last) break
        yield* Effect.sleep("50 millis")
      }
      return respond(last ?? msgs.findLast((entry) => String(entry.info.id) === String(admitted.id)) ?? msgs.at(-1))
    })

    const promptAsync = Effect.fn("SessionHttpApi.promptAsync")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* admitRivetPrompt(ctx.params.sessionID, ctx.payload, ctx.payload.noReply !== true).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logError("prompt_async failed", { sessionID: ctx.params.sessionID, cause })
            yield* events.publish(Session.Event.Error, {
              sessionID: ctx.params.sessionID,
              error: new NamedError.Unknown({ message: Cause.pretty(cause) }).toObject(),
            })
          }),
        ),
      )
      return HttpApiSchema.NoContent.make()
    })

    const argsRegex = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g
    const quoteTrimRegex = /^["']|["']$/g
    const placeholderRegex = /\$(\d+)/g
    const bashRegex = /`([^`]+)`/g

    const executeCommand = Effect.fn("SessionHttpApi.executeCommand")(function* (input: {
      sessionID: SessionID
      messageID?: MessageID
      command: string
      arguments: string
      model?: string
      agent?: string
      variant?: string
      parts?: ReadonlyArray<{ type: "file"; url: string; filename?: string; mime: string; source?: unknown }>
    }) {
      const cmd = yield* commandSvc.get(input.command)
      if (!cmd) return yield* new HttpApiError.BadRequest({})

      const agentName = cmd.agent ?? input.agent
      const raw = input.arguments.match(argsRegex) ?? []
      const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
      const templateCommand = yield* Effect.promise(async () => cmd.template)

      const placeholders = templateCommand.match(placeholderRegex) ?? []
      const last = placeholders.reduce((max, item) => Math.max(max, Number(item.slice(1))), 0)

      const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
        const position = Number(index)
        const argIndex = position - 1
        if (argIndex >= args.length) return ""
        if (position === last) return args.slice(argIndex).join(" ")
        return args[argIndex]
      })
      const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
      const templateWithArgs = withArgs.replaceAll("$ARGUMENTS", input.arguments)
      const baseTemplate =
        placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()
          ? `${templateWithArgs}\n\n${input.arguments}`
          : templateWithArgs

      const shellMatches = ConfigMarkdown.shell(baseTemplate)
      const expandedTemplate =
        shellMatches.length > 0
          ? yield* Effect.gen(function* () {
              const cfg = yield* config.get()
              const sh = Shell.preferred(cfg.shell)
              const results = yield* Effect.promise(() =>
                Promise.all(
                  shellMatches.map(async ([, c]) => (await Process.text([c], { shell: sh, nothrow: true })).text),
                ),
              )
              let index = 0
              return baseTemplate.replace(bashRegex, () => results[index++])
            })
          : baseTemplate

      const trimmedTemplate = expandedTemplate.trim()
      const resolvedParts = yield* promptSvc.resolvePromptParts(trimmedTemplate)
      const inputFiles = new Set(
        input.parts?.filter((part) => part.url.startsWith("file:")).map((part) => new URL(part.url).pathname),
      )
      const uniqueParts = resolvedParts.filter(
        (part) => part.type !== "file" || !inputFiles.has(new URL(part.url).pathname),
      )

      const parts: (typeof PromptPayload.Type)["parts"] = [
        ...uniqueParts.map((p) => {
          if (p.type === "file") return { type: "file" as const, url: p.url, filename: p.filename, mime: p.mime }
          if (p.type === "agent") return { type: "agent" as const, name: p.name }
          if (p.type === "subtask") return { type: "text" as const, text: p.prompt }
          return { type: "text" as const, text: p.text }
        }),
        ...(input.parts ?? []).map((p) => ({
          type: "file" as const,
          url: p.url,
          filename: p.filename,
          mime: p.mime,
        })),
      ]

      const parsedModel = input.model ? Provider.parseModel(input.model) : undefined

      yield* admitRivetPrompt(input.sessionID, {
        messageID: input.messageID,
        agent: agentName,
        model: parsedModel,
        variant: input.variant,
        parts,
      }).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      yield* sessionV2.resume(input.sessionID).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))

      const msgs = yield* SessionError.mapStorageNotFound(session.messages({ sessionID: input.sessionID }))
      const lastMessage = msgs.findLast((entry) => entry.info.role !== "user")
      if (!lastMessage) return yield* new HttpApiError.BadRequest({})

      yield* events.publish(Command.Event.Executed, {
        name: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
        messageID: lastMessage.info.id,
      })

      return HttpServerResponse.stream(Stream.make(JSON.stringify(lastMessage)).pipe(Stream.encodeText), {
        contentType: "application/json",
      })
    })

    const init = Effect.fn("SessionHttpApi.init")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof InitPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* executeCommand({
        sessionID: ctx.params.sessionID,
        messageID: ctx.payload.messageID,
        model: `${ctx.payload.providerID}/${ctx.payload.modelID}`,
        command: Command.Default.INIT,
        arguments: "",
      }).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return true
    })

    const inductionStatus = Effect.fn("SessionHttpApi.inductionStatus")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      const sess = yield* requireSession(ctx.params.sessionID)
      return toInductionStatus(inductionMarkerStatus(sess.directory))
    })

    const inductionStart = Effect.fn("SessionHttpApi.inductionStart")(function* (ctx: {
      params: { sessionID: SessionID }
      payload?: typeof InductionStartPayload.Type
    }) {
      const sess = yield* requireSession(ctx.params.sessionID)
      const force = ctx.payload?.force === true
      const { db } = yield* Database.Service
      const semantics = yield* SessionSemantics.load(db, sess.id)
      yield* Effect.forkIn(scope)(
        semantics.ensureDeepInduction(events, sess.directory, { force }).pipe(Effect.catch(() => Effect.void)),
      )
      return toInductionStatus(inductionMarkerStatus(sess.directory))
    })

    const command = Effect.fn("SessionHttpApi.command")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof CommandPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* executeCommand({
        ...ctx.payload,
        sessionID: ctx.params.sessionID,
      }).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const shell = Effect.fn("SessionHttpApi.shell")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof ShellPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* SessionError.mapBusy(promptSvc.shell({ ...ctx.payload, sessionID: ctx.params.sessionID }))
    })

    const revert = Effect.fn("SessionHttpApi.revert")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof RevertPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* SessionError.mapBusy(revertSvc.revert({ sessionID: ctx.params.sessionID, ...ctx.payload }))
    })

    const unrevert = Effect.fn("SessionHttpApi.unrevert")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* SessionError.mapBusy(revertSvc.unrevert({ sessionID: ctx.params.sessionID }))
    })

    const permissionRespond = Effect.fn("SessionHttpApi.permissionRespond")(function* (ctx: {
      params: { sessionID: SessionID; permissionID: PermissionV1.ID }
      payload: typeof PermissionResponsePayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* permissionSvc.reply({ requestID: ctx.params.permissionID, reply: ctx.payload.response }).pipe(
        Effect.catchTag("Permission.NotFoundError", (error) =>
          Effect.fail(
            new PermissionNotFoundError({
              requestID: String(error.requestID),
              message: `Permission request not found: ${error.requestID}`,
            }),
          ),
        ),
      )
      return true
    })

    const deleteMessage = Effect.fn("SessionHttpApi.deleteMessage")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* SessionError.mapBusy(runState.assertNotBusy(ctx.params.sessionID))
      yield* session.removeMessage(ctx.params)
      return true
    })

    const deletePart = Effect.fn("SessionHttpApi.deletePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* session.removePart(ctx.params)
      return true
    })

    const updatePart = Effect.fn("SessionHttpApi.updatePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
      payload: typeof SessionV1.Part.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      const payload = ctx.payload as SessionV1.Part
      if (
        payload.id !== ctx.params.partID ||
        payload.messageID !== ctx.params.messageID ||
        payload.sessionID !== ctx.params.sessionID
      ) {
        return yield* new HttpApiError.BadRequest({})
      }
      return yield* session.updatePart(payload)
    })

    return handlers
      .handle("list", list)
      .handle("status", status)
      .handle("get", get)
      .handle("children", children)
      .handle("todo", todo)
      .handle("diff", diff)
      .handle("messages", messages)
      .handle("message", message)
      .handleRaw("create", createRaw)
      .handle("remove", remove)
      .handle("update", update)
      .handleRaw("fork", forkRaw)
      .handle("abort", abort)
      .handle("init", init)
      .handle("induction", inductionStatus)
      .handle("inductionStart", inductionStart)
      .handle("share", share)
      .handle("unshare", unshare)
      .handle("summarize", summarize)
      .handle("prompt", prompt)
      .handle("promptAsync", promptAsync)
      .handle("command", command)
      .handle("shell", shell)
      .handle("revert", revert)
      .handle("unrevert", unrevert)
      .handle("permissionRespond", permissionRespond)
      .handle("deleteMessage", deleteMessage)
      .handle("deletePart", deletePart)
      .handle("updatePart", updatePart)
  }),
)
