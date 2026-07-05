import { ToolMessage } from "@langchain/core/messages"
import { createMiddleware } from "langchain"

export interface GuardrailReason {
  code: string
  message: string
}

export interface GuardrailRequest {
  toolCallId?: string
  toolName: string
  toolInput: Record<string, unknown>
  threadId: string
  workspacePath: string
  timestamp: string
}

export interface GuardrailDecision<TMetadata = Record<string, unknown>> {
  allow: boolean
  reasons?: GuardrailReason[]
  metadata?: TMetadata
}

export interface GuardrailProvider<TMetadata = Record<string, unknown>> {
  evaluate(request: GuardrailRequest): Promise<GuardrailDecision<TMetadata>> | GuardrailDecision<TMetadata>
}

export interface CreateGuardrailMiddlewareOptions<TMetadata = Record<string, unknown>> {
  applyMetadata?: (
    args: Record<string, unknown>,
    metadata: TMetadata | undefined
  ) => Record<string, unknown>
  provider: GuardrailProvider<TMetadata>
  threadId: string
  workspacePath: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function buildDeniedMessage(
  toolName: string,
  toolCallId: string,
  reason: GuardrailReason
): ToolMessage {
  return new ToolMessage({
    content: `Guardrail denied: tool '${toolName}' was blocked (${reason.code}). Reason: ${reason.message}.`,
    name: toolName,
    tool_call_id: toolCallId,
    status: "error"
  })
}

function defaultApplyMetadata<TMetadata>(
  args: Record<string, unknown>,
  _metadata: TMetadata | undefined
): Record<string, unknown> {
  return args
}

export function createGuardrailMiddleware<TMetadata = Record<string, unknown>>(
  options: CreateGuardrailMiddlewareOptions<TMetadata>
) {
  const { provider, threadId, workspacePath } = options
  const applyMetadata = options.applyMetadata ?? defaultApplyMetadata<TMetadata>

  return createMiddleware({
    name: "GuardrailMiddleware",
    wrapToolCall: async (request, handler) => {
      const toolName = request.toolCall.name
      const toolCallId = request.toolCall.id

      if (!toolName || !toolCallId) {
        return handler(request)
      }

      const toolInput = isRecord(request.toolCall.args) ? request.toolCall.args : {}
      const decision = await provider.evaluate({
        toolCallId,
        toolName,
        toolInput,
        threadId,
        workspacePath,
        timestamp: new Date().toISOString()
      })

      if (!decision.allow) {
        const reason = decision.reasons?.[0] ?? {
          code: "jingle.guardrail_denied",
          message: "blocked by guardrail policy"
        }
        return buildDeniedMessage(toolName, toolCallId, reason)
      }

      const nextToolCall = isRecord(request.toolCall.args)
        ? (() => {
            const nextArgs = applyMetadata(request.toolCall.args, decision.metadata)
            return nextArgs === request.toolCall.args
              ? request.toolCall
              : {
                  ...request.toolCall,
                  args: nextArgs
                }
          })()
        : request.toolCall

      return handler({
        ...request,
        toolCall: nextToolCall
      })
    }
  })
}
