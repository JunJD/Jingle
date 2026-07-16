import { ContextOverflowError } from "@langchain/core/errors"
import {
  AIMessage,
  getBufferString,
  HumanMessage,
  RemoveMessage,
  SystemMessage,
  type BaseMessage
} from "@langchain/core/messages"
import type { BaseLanguageModel } from "@langchain/core/language_models/base"
import type { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { Command, REMOVE_ALL_MESSAGES } from "@langchain/langgraph"
import { countTokensApproximately, createMiddleware, type AgentMiddleware } from "langchain"
import { initChatModel } from "langchain/chat_models/universal"
import { z } from "zod/v4"
import { readJingleLangChainMessageText } from "../langchain-message-reader"

export interface JingleSummarizationContextSize {
  type: "fraction" | "messages" | "tokens"
  value: number
}

export interface JingleSummarizationTruncateArgsSettings {
  trigger?: JingleSummarizationContextSize
  keep?: JingleSummarizationContextSize
  maxLength?: number
  truncationText?: string
}

export interface JingleSummarizationWriteResult {
  error?: string
  path?: string
}

export interface JingleSummarizationFileDownloadResponse {
  content: Uint8Array | null
  error: string | null
  path: string
}

export interface JingleSummarizationFileUploadResponse {
  error: string | null
  path: string
}

export interface JingleSummarizationBackend {
  downloadFiles?(
    paths: string[]
  ): Promise<JingleSummarizationFileDownloadResponse[]> | JingleSummarizationFileDownloadResponse[]
  edit(
    filePath: string,
    oldString: string,
    newString: string
  ): Promise<JingleSummarizationWriteResult> | JingleSummarizationWriteResult
  uploadFiles?(
    files: Array<[string, Uint8Array]>
  ): Promise<JingleSummarizationFileUploadResponse[]> | JingleSummarizationFileUploadResponse[]
  write(
    filePath: string,
    content: string
  ): Promise<JingleSummarizationWriteResult> | JingleSummarizationWriteResult
}

export type JingleSummarizationBackendFactory = (config: {
  state: unknown
}) => JingleSummarizationBackend

export interface JingleSummarizationMiddlewareOptions {
  backend: JingleSummarizationBackend | JingleSummarizationBackendFactory
  historyPathPrefix?: string
  model: string | BaseChatModel | BaseLanguageModel
  preservedUserMessageTokenBudget?: number
  summaryPrompt?: string
  trigger?: JingleSummarizationContextSize | JingleSummarizationContextSize[]
  trimTokensToSummarize?: number | null
  truncateArgsSettings?: JingleSummarizationTruncateArgsSettings
}

export type JingleSummarizationMiddleware = AgentMiddleware & {
  wrapModelCall: NonNullable<AgentMiddleware["wrapModelCall"]>
}

export type JingleSummarizationEvent = z.infer<typeof jingleSummarizationEventSchema>
export type JingleSummarizationState = z.infer<typeof jingleSummarizationStateSchema>

export interface JingleSummarizationCompactionInput {
  messages: BaseMessage[]
  preserveLastUserMessageCount?: number
  resolvedModel?: BaseChatModel | BaseLanguageModel
  state?: unknown
}

export interface JingleSummarizationCompactionResult {
  event: JingleSummarizationEvent
  modelMessages: BaseMessage[]
  summaryMessage: HumanMessage
  update: {
    _summarizationEvent: JingleSummarizationEvent
    _summarizationSessionId: string
    messages: BaseMessage[]
  }
}

export interface JingleSummarizationModelCallPreparation {
  maxInputTokens: number | undefined
  resolvedModel: BaseChatModel | BaseLanguageModel
  shouldSummarize: boolean
  totalTokens: number
  truncatedMessages: BaseMessage[]
}

export interface JingleSummarizationController {
  compactMessages(
    input: JingleSummarizationCompactionInput
  ): Promise<JingleSummarizationCompactionResult>
  observeContextOverflow(input: { maxInputTokens: number | undefined; totalTokens: number }): void
  prepareModelCall(input: {
    messages: BaseMessage[]
    systemMessage: SystemMessage | undefined
    tools: unknown
  }): Promise<JingleSummarizationModelCallPreparation>
}

const DEFAULT_PRESERVED_USER_MESSAGE_TOKEN_BUDGET = 20_000
const REPEATED_COMPACTION_WARNING =
  "Long threads and multiple compactions can cause the model to be less accurate. Consider starting a new thread if accuracy starts to drift."

export const JINGLE_CONTEXT_COMPACTION_SUMMARY_PREFIX = `Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:`

export const JINGLE_CONTEXT_COMPACTION_SUMMARY_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a factual handoff for the next LLM that will resume this agent run.

The source material can contain a previous handoff followed by new conversation evidence. Merge them into one current handoff. Newer evidence overrides stale facts. Do not present guesses as verified state.

Use this exact structure:

## Objective
[The current user goal and expected outcome]

## User Requirements
[Explicit constraints, preferences, corrections, and repository conventions that still apply. Quote exact commands, paths, flags, or wording when drift would change the task.]

## Progress
### Completed
[Concrete completed actions and outcomes]
### In Progress
[Work that was underway when compaction started]
### Blocked
[Unresolved blockers and exact errors]

## Active State
[Evidence-backed workspace, branch, changed files, running processes, external state, approvals, artifacts, and checkpoints. Mark anything not directly established by the source as Unknown.]

## Key Decisions
[Important decisions, why they were made, and any superseded decisions that must not be revived]

## Relevant Files and Symbols
[Files, symbols, URLs, commands, and data needed to continue]

## Verification
[Tests and checks already run, with exact results and remaining validation gaps]

## Next Steps
[Ordered, actionable remaining work and known risks]

## Critical Context
[Specific facts that would otherwise be lost. Preserve uncertainty explicitly.]

Be concise and task-focused. Do not invent tool results or claim work was completed without evidence. Respond only with the handoff.

Source material:
{conversation}`

const FALLBACK_TRIGGER: JingleSummarizationContextSize = {
  type: "tokens",
  value: 170_000
}
const FALLBACK_TRUNCATE_ARGS: Required<
  Pick<JingleSummarizationTruncateArgsSettings, "keep" | "trigger">
> = {
  trigger: {
    type: "messages",
    value: 20
  },
  keep: {
    type: "messages",
    value: 20
  }
}
const PROFILE_TRIGGER: JingleSummarizationContextSize = {
  type: "fraction",
  value: 0.85
}
const PROFILE_TRUNCATE_ARGS: Required<
  Pick<JingleSummarizationTruncateArgsSettings, "keep" | "trigger">
> = {
  trigger: {
    type: "fraction",
    value: 0.85
  },
  keep: {
    type: "fraction",
    value: 0.1
  }
}

const DEFAULT_SUMMARY_PROMPT = JINGLE_CONTEXT_COMPACTION_SUMMARY_PROMPT

export const jingleSummarizationEventSchema = z.object({
  compactionCount: z.number().int().min(1).optional(),
  cutoffIndex: z.number(),
  filePath: z.string().nullable(),
  preservedUserMessages: z.array(z.instanceof(HumanMessage)).default(() => []),
  summaryMessage: z.instanceof(HumanMessage),
  warning: z.string().nullable().optional()
})

export const jingleSummarizationStateSchema = z.object({
  _summarizationSessionId: z.string().optional(),
  _summarizationEvent: jingleSummarizationEventSchema.optional()
})

export function computeJingleSummarizationDefaults(
  resolvedModel: BaseChatModel | BaseLanguageModel
): {
  trigger: JingleSummarizationContextSize
  truncateArgsSettings: JingleSummarizationTruncateArgsSettings
} {
  const profile = resolvedModel.profile
  if (
    profile &&
    typeof profile === "object" &&
    "maxInputTokens" in profile &&
    typeof profile.maxInputTokens === "number"
  ) {
    return {
      trigger: PROFILE_TRIGGER,
      truncateArgsSettings: PROFILE_TRUNCATE_ARGS
    }
  }

  return {
    trigger: FALLBACK_TRIGGER,
    truncateArgsSettings: FALLBACK_TRUNCATE_ARGS
  }
}

function isSummaryMessage(message: BaseMessage): boolean {
  return (
    HumanMessage.isInstance(message) && message.additional_kwargs?.lc_source === "summarization"
  )
}

function createSessionId(): string {
  return `session_${crypto.randomUUID().slice(0, 8)}`
}

function getMaxInputTokens(resolvedModel: BaseChatModel | BaseLanguageModel): number | undefined {
  const profile = resolvedModel.profile
  if (
    profile &&
    typeof profile === "object" &&
    "maxInputTokens" in profile &&
    typeof profile.maxInputTokens === "number"
  ) {
    return profile.maxInputTokens
  }
  return undefined
}

function isContextOverflow(error: unknown): boolean {
  let cause: unknown = error
  for (;;) {
    if (!cause) {
      return false
    }

    if (ContextOverflowError.isInstance(cause)) {
      return true
    }

    cause =
      typeof cause === "object" && "cause" in cause
        ? (cause as { cause?: unknown }).cause
        : undefined
  }
}

export function createJingleSummarizationController(
  options: JingleSummarizationMiddlewareOptions
): JingleSummarizationController {
  const {
    model,
    backend,
    summaryPrompt = DEFAULT_SUMMARY_PROMPT,
    preservedUserMessageTokenBudget = DEFAULT_PRESERVED_USER_MESSAGE_TOKEN_BUDGET,
    trimTokensToSummarize = null,
    historyPathPrefix = "/conversation_history"
  } = options

  let trigger = options.trigger
  let truncateArgsSettings = options.truncateArgsSettings
  let defaultsComputed = trigger != null
  let truncateTrigger = truncateArgsSettings?.trigger
  let truncateKeep =
    truncateArgsSettings?.keep ??
    ({
      type: "messages",
      value: 20
    } satisfies JingleSummarizationContextSize)
  let maxArgLength = truncateArgsSettings?.maxLength ?? 2_000
  let truncationText = truncateArgsSettings?.truncationText ?? "...(argument truncated)"
  let sessionId: string | null = null
  let tokenEstimationMultiplier = 1
  let cachedModel: BaseChatModel | BaseLanguageModel | undefined

  function applyModelDefaults(resolvedModel: BaseChatModel | BaseLanguageModel): void {
    if (defaultsComputed) {
      return
    }

    defaultsComputed = true
    const defaults = computeJingleSummarizationDefaults(resolvedModel)
    trigger = defaults.trigger

    if (!options.truncateArgsSettings) {
      truncateArgsSettings = defaults.truncateArgsSettings
      truncateTrigger = defaults.truncateArgsSettings.trigger
      truncateKeep = defaults.truncateArgsSettings.keep ?? {
        type: "messages",
        value: 20
      }
      maxArgLength = defaults.truncateArgsSettings.maxLength ?? 2_000
      truncationText = defaults.truncateArgsSettings.truncationText ?? "...(argument truncated)"
    }
  }

  function getBackend(state: unknown): JingleSummarizationBackend {
    return typeof backend === "function" ? backend({ state }) : backend
  }

  function getSessionId(state: JingleSummarizationState): string {
    if (state._summarizationSessionId) {
      return state._summarizationSessionId
    }

    if (!sessionId) {
      sessionId = createSessionId()
    }
    return sessionId
  }

  function getHistoryPath(state: JingleSummarizationState): string {
    return `${historyPathPrefix}/${getSessionId(state)}.md`
  }

  async function getChatModel(): Promise<BaseChatModel | BaseLanguageModel> {
    if (cachedModel) {
      return cachedModel
    }

    cachedModel = typeof model === "string" ? await initChatModel(model) : model
    return cachedModel
  }

  function shouldSummarize(
    messages: BaseMessage[],
    totalTokens: number,
    maxInputTokens: number | undefined
  ): boolean {
    if (!trigger) {
      return false
    }

    const adjustedTokens = totalTokens * tokenEstimationMultiplier
    const triggers = Array.isArray(trigger) ? trigger : [trigger]
    for (const candidate of triggers) {
      if (candidate.type === "messages" && messages.length >= candidate.value) {
        return true
      }
      if (candidate.type === "tokens" && adjustedTokens >= candidate.value) {
        return true
      }
      if (
        candidate.type === "fraction" &&
        maxInputTokens &&
        adjustedTokens >= Math.floor(maxInputTokens * candidate.value)
      ) {
        return true
      }
    }

    return false
  }

  function shouldTruncateArgs(
    messages: BaseMessage[],
    totalTokens: number,
    maxInputTokens: number | undefined
  ): boolean {
    if (!truncateTrigger) {
      return false
    }

    const adjustedTokens = totalTokens * tokenEstimationMultiplier
    if (truncateTrigger.type === "messages") {
      return messages.length >= truncateTrigger.value
    }
    if (truncateTrigger.type === "tokens") {
      return adjustedTokens >= truncateTrigger.value
    }
    if (truncateTrigger.type === "fraction" && maxInputTokens) {
      return adjustedTokens >= Math.floor(maxInputTokens * truncateTrigger.value)
    }
    return false
  }

  function determineTruncateCutoffIndex(
    messages: BaseMessage[],
    maxInputTokens: number | undefined
  ): number {
    let rawCutoff: number
    if (truncateKeep.type === "messages") {
      if (messages.length <= truncateKeep.value) {
        return messages.length
      }
      rawCutoff = messages.length - truncateKeep.value
    } else if (truncateKeep.type === "tokens" || truncateKeep.type === "fraction") {
      const targetTokenCount =
        truncateKeep.type === "fraction" && maxInputTokens
          ? Math.floor(maxInputTokens * truncateKeep.value)
          : truncateKeep.value
      let tokensKept = 0
      rawCutoff = 0

      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const messageTokens = countTokensApproximately([messages[index]])
        if (tokensKept + messageTokens > targetTokenCount) {
          rawCutoff = index + 1
          break
        }
        tokensKept += messageTokens
      }
    } else {
      return messages.length
    }

    return rawCutoff
  }

  function countTotalTokens(
    messages: BaseMessage[],
    systemMessage: SystemMessage | undefined,
    tools: unknown
  ): number {
    return countTokensApproximately(
      systemMessage && SystemMessage.isInstance(systemMessage)
        ? [systemMessage, ...messages]
        : [...messages],
      Array.isArray(tools) && tools.length > 0 ? tools : null
    )
  }

  function truncateArgs(
    messages: BaseMessage[],
    maxInputTokens: number | undefined,
    systemMessage: SystemMessage | undefined,
    tools: unknown
  ): {
    messages: BaseMessage[]
    modified: boolean
  } {
    if (
      !shouldTruncateArgs(
        messages,
        countTotalTokens(messages, systemMessage, tools),
        maxInputTokens
      )
    ) {
      return {
        messages,
        modified: false
      }
    }

    const cutoffIndex = determineTruncateCutoffIndex(messages, maxInputTokens)
    if (cutoffIndex >= messages.length) {
      return {
        messages,
        modified: false
      }
    }

    const truncatedMessages: BaseMessage[] = []
    let modified = false
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index]
      if (index < cutoffIndex && AIMessage.isInstance(message) && message.tool_calls) {
        let messageModified = false
        const truncatedToolCalls = message.tool_calls.map((toolCall) => {
          const args = toolCall.args || {}
          const truncatedArgs: Record<string, unknown> = {}
          let toolModified = false

          for (const [key, value] of Object.entries(args)) {
            if (
              typeof value === "string" &&
              value.length > maxArgLength &&
              (toolCall.name === "write_file" || toolCall.name === "edit_file")
            ) {
              truncatedArgs[key] = value.substring(0, 20) + truncationText
              toolModified = true
              messageModified = true
            } else {
              truncatedArgs[key] = value
            }
          }

          if (!toolModified) {
            return toolCall
          }

          return {
            ...toolCall,
            args: truncatedArgs
          }
        })

        if (messageModified) {
          modified = true
          truncatedMessages.push(
            new AIMessage({
              content: message.content,
              tool_calls: truncatedToolCalls,
              additional_kwargs: message.additional_kwargs
            })
          )
        } else {
          truncatedMessages.push(message)
        }
      } else {
        truncatedMessages.push(message)
      }
    }

    return {
      messages: truncatedMessages,
      modified
    }
  }

  function collectPreservedUserMessages(
    messages: BaseMessage[],
    preserveLastUserMessageCount: number | undefined
  ): HumanMessage[] {
    if (preserveLastUserMessageCount !== undefined) {
      if (!Number.isInteger(preserveLastUserMessageCount) || preserveLastUserMessageCount < 0) {
        throw new Error(
          "[JingleSummarization] preserveLastUserMessageCount must be a non-negative integer."
        )
      }
      if (preserveLastUserMessageCount === 0) {
        return []
      }

      const selectedByCount: HumanMessage[] = []
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index]
        if (!HumanMessage.isInstance(message) || isSummaryMessage(message)) {
          continue
        }
        selectedByCount.push(message)
        if (selectedByCount.length >= preserveLastUserMessageCount) {
          break
        }
      }
      return selectedByCount.reverse()
    }

    const selected: HumanMessage[] = []
    let selectedTokens = 0

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (!HumanMessage.isInstance(message) || isSummaryMessage(message)) {
        continue
      }

      const messageTokens = countTokensApproximately([message])
      if (selectedTokens + messageTokens > preservedUserMessageTokenBudget) {
        break
      }

      selected.push(message)
      selectedTokens += messageTokens
    }

    return selected.reverse()
  }

  function selectMessagesForSummary(messages: BaseMessage[]): BaseMessage[] {
    const latestSummaryIndex = messages.findLastIndex(isSummaryMessage)
    const newEvidence = latestSummaryIndex >= 0 ? messages.slice(latestSummaryIndex + 1) : messages
    return newEvidence.filter(
      (message) => !isSummaryMessage(message) && !SystemMessage.isInstance(message)
    )
  }

  function buildSummarySource(input: {
    messages: BaseMessage[]
    previousSummaryMessage: HumanMessage | undefined
  }): string {
    const newEvidence = getBufferString(selectMessagesForSummary(input.messages))
    if (!input.previousSummaryMessage) {
      return `<new_evidence>\n${newEvidence}\n</new_evidence>`
    }

    const previousHandoff = readJingleLangChainMessageText(
      input.previousSummaryMessage.content
    ).trim()
    return `<previous_handoff>\n${previousHandoff}\n</previous_handoff>\n\n<new_evidence>\n${newEvidence}\n</new_evidence>`
  }

  async function offloadToBackend(
    resolvedBackend: JingleSummarizationBackend,
    messages: BaseMessage[],
    state: JingleSummarizationState
  ): Promise<string | null> {
    const filePath = getHistoryPath(state)
    const newSection =
      `## Summarized at ${new Date().toISOString()}\n\n` +
      `${getBufferString(selectMessagesForSummary(messages))}\n\n`
    const sectionBytes = new TextEncoder().encode(newSection)

    try {
      let existingBytes: Uint8Array | null = null
      if (resolvedBackend.downloadFiles) {
        try {
          const responses = await resolvedBackend.downloadFiles([filePath])
          if (responses.length > 0 && responses[0].content && !responses[0].error) {
            existingBytes = responses[0].content
          }
        } catch {
          existingBytes = null
        }
      }

      let result: JingleSummarizationWriteResult
      if (existingBytes && resolvedBackend.uploadFiles) {
        const combined = new Uint8Array(existingBytes.byteLength + sectionBytes.byteLength)
        combined.set(existingBytes, 0)
        combined.set(sectionBytes, existingBytes.byteLength)
        const uploadResults = await resolvedBackend.uploadFiles([[filePath, combined]])
        result = uploadResults[0].error ? { error: uploadResults[0].error } : { path: filePath }
      } else if (!existingBytes) {
        result = await resolvedBackend.write(filePath, newSection)
      } else {
        const existingContent = new TextDecoder().decode(existingBytes)
        result = await resolvedBackend.edit(filePath, existingContent, existingContent + newSection)
      }

      if (result.error) {
        console.warn(`Failed to offload conversation history to ${filePath}: ${result.error}`)
        return null
      }

      return filePath
    } catch (error) {
      console.warn(`Exception offloading conversation history to ${filePath}:`, error)
      return null
    }
  }

  async function createSummary(
    messages: BaseMessage[],
    chatModel: BaseChatModel | BaseLanguageModel,
    previousSummaryMessage: HumanMessage | undefined
  ): Promise<string> {
    let messagesToSummarize = messages
    if (
      trimTokensToSummarize != null &&
      countTokensApproximately(messages) > trimTokensToSummarize
    ) {
      let kept = 0
      const trimmedMessages: BaseMessage[] = []

      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const messageTokens = countTokensApproximately([messages[index]])
        if (kept + messageTokens > trimTokensToSummarize) {
          break
        }
        trimmedMessages.unshift(messages[index])
        kept += messageTokens
      }
      messagesToSummarize = trimmedMessages
    }

    const source = buildSummarySource({
      messages: messagesToSummarize,
      previousSummaryMessage
    })
    const prompt = summaryPrompt.replace("{conversation}", source)
    const response = await chatModel.invoke([new HumanMessage({ content: prompt })])
    return typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content)
  }

  function buildSummaryMessage(input: {
    filePath: string | null
    summary: string
    warning: string | null
  }): HumanMessage {
    const historyNote = input.filePath
      ? `\n\nThe full conversation history has been saved to ${input.filePath} should you need to refer back to it for details.`
      : ""
    const warningNote = input.warning ? `\n\n${input.warning}` : ""
    const content = `${JINGLE_CONTEXT_COMPACTION_SUMMARY_PREFIX}${historyNote}

<summary>
${input.summary}
</summary>${warningNote}`

    return new HumanMessage({
      content,
      additional_kwargs: { lc_source: "summarization" }
    })
  }

  function createCompactedStateMessages(messages: BaseMessage[]): BaseMessage[] {
    return [new RemoveMessage({ id: REMOVE_ALL_MESSAGES }), ...messages]
  }

  async function summarizeMessages(
    messagesToSummarize: BaseMessage[],
    resolvedModel: BaseChatModel | BaseLanguageModel,
    state: JingleSummarizationState,
    warning: string | null,
    previousSummaryMessage: HumanMessage | undefined
  ): Promise<{
    filePath: string | null
    summaryMessage: HumanMessage
  }> {
    const filePath = await offloadToBackend(getBackend(state), messagesToSummarize, state)
    if (filePath === null) {
      console.warn(
        "[JingleSummarizationMiddleware] Backend offload failed during summarization. Proceeding with summary generation."
      )
    }

    const summary = await createSummary(messagesToSummarize, resolvedModel, previousSummaryMessage)
    return {
      summaryMessage: buildSummaryMessage({
        filePath,
        summary,
        warning
      }),
      filePath
    }
  }

  async function compactMessages(
    input: JingleSummarizationCompactionInput
  ): Promise<JingleSummarizationCompactionResult> {
    if (input.messages.length === 0) {
      throw new Error("[JingleSummarization] Cannot compact empty message history.")
    }

    const state = (input.state ? input.state : {}) as JingleSummarizationState
    const previousEvent = state._summarizationEvent
    const compactionCount = (previousEvent?.compactionCount ?? 0) + 1
    const warning = compactionCount > 1 ? REPEATED_COMPACTION_WARNING : null
    const resolvedModel = input.resolvedModel ? input.resolvedModel : await getChatModel()
    applyModelDefaults(resolvedModel)
    const maxInputTokens = getMaxInputTokens(resolvedModel)
    const { messages: compactableMessages } = truncateArgs(
      input.messages,
      maxInputTokens,
      undefined,
      undefined
    )
    const previousSummaryMessage = [...compactableMessages]
      .reverse()
      .find((message): message is HumanMessage => isSummaryMessage(message))
    const preservedUserMessages = collectPreservedUserMessages(
      compactableMessages,
      input.preserveLastUserMessageCount
    )
    const messagesToSummarize = selectMessagesForSummary(compactableMessages)
    const { summaryMessage, filePath } = await summarizeMessages(
      messagesToSummarize,
      resolvedModel,
      state,
      warning,
      previousSummaryMessage ?? previousEvent?.summaryMessage
    )
    const modifiedMessages: BaseMessage[] = [...preservedUserMessages, summaryMessage]
    const event = {
      compactionCount,
      cutoffIndex: input.messages.length,
      filePath,
      preservedUserMessages,
      summaryMessage,
      warning
    } satisfies JingleSummarizationEvent

    return {
      event,
      modelMessages: modifiedMessages,
      summaryMessage,
      update: {
        _summarizationEvent: event,
        _summarizationSessionId: getSessionId(state),
        messages: createCompactedStateMessages(modifiedMessages)
      }
    }
  }

  async function prepareModelCall(input: {
    messages: BaseMessage[]
    systemMessage: SystemMessage | undefined
    tools: unknown
  }): Promise<JingleSummarizationModelCallPreparation> {
    const resolvedModel = await getChatModel()
    const maxInputTokens = getMaxInputTokens(resolvedModel)
    applyModelDefaults(resolvedModel)

    const { messages: truncatedMessages } = truncateArgs(
      input.messages,
      maxInputTokens,
      input.systemMessage,
      input.tools
    )
    const totalTokens = countTotalTokens(truncatedMessages, input.systemMessage, input.tools)

    return {
      maxInputTokens,
      resolvedModel,
      shouldSummarize: shouldSummarize(truncatedMessages, totalTokens, maxInputTokens),
      totalTokens,
      truncatedMessages
    }
  }

  function observeContextOverflow(input: {
    maxInputTokens: number | undefined
    totalTokens: number
  }): void {
    if (input.maxInputTokens && input.totalTokens > 0) {
      const observedRatio = input.maxInputTokens / input.totalTokens
      if (observedRatio > tokenEstimationMultiplier) {
        tokenEstimationMultiplier = observedRatio * 1.1
      }
    }
  }

  return {
    compactMessages,
    observeContextOverflow,
    prepareModelCall
  }
}

export function createJingleSummarizationMiddleware(
  options: JingleSummarizationMiddlewareOptions
): JingleSummarizationMiddleware {
  const controller = createJingleSummarizationController(options)
  const middleware = createMiddleware({
    name: "JingleSummarizationMiddleware",
    stateSchema: jingleSummarizationStateSchema,
    wrapModelCall: async (request, handler) => {
      const messages = request.messages ?? []
      if (messages.length === 0) {
        return handler(request)
      }

      const prepared = await controller.prepareModelCall({
        messages,
        systemMessage: request.systemMessage,
        tools: request.tools
      })

      if (!prepared.shouldSummarize) {
        try {
          return await handler({
            ...request,
            messages: prepared.truncatedMessages
          })
        } catch (error) {
          if (!isContextOverflow(error)) {
            throw error
          }

          controller.observeContextOverflow({
            maxInputTokens: prepared.maxInputTokens,
            totalTokens: prepared.totalTokens
          })
        }
      }

      const result = await controller.compactMessages({
        messages: prepared.truncatedMessages,
        resolvedModel: prepared.resolvedModel,
        state: request.state
      })
      await handler({
        ...request,
        messages: result.modelMessages
      })

      return new Command({
        update: result.update
      })
    }
  })

  if (!middleware.wrapModelCall) {
    throw new Error("[JingleSummarizationMiddleware] Missing wrapModelCall.")
  }

  return {
    ...middleware,
    wrapModelCall: middleware.wrapModelCall
  }
}
