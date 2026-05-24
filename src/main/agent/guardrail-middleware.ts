import { ToolMessage } from "@langchain/core/messages"
import { createMiddleware } from "langchain"
import {
  withExecuteCommandPolicy,
  type ExecuteCommandPolicy
} from "@shared/execute-command-policy"
import { withMutationPrediction, type MutationPrediction } from "@shared/mutation-prediction"

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

export interface GuardrailDecision {
  allow: boolean
  reasons?: GuardrailReason[]
  metadata?: {
    executeCommandPolicy?: ExecuteCommandPolicy
    mutationPrediction?: MutationPrediction
  }
}

export interface GuardrailProvider {
  evaluate(request: GuardrailRequest): Promise<GuardrailDecision> | GuardrailDecision
}

interface CreateGuardrailMiddlewareOptions {
  provider: GuardrailProvider
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

function applyGuardrailMetadata(
  args: Record<string, unknown>,
  metadata: GuardrailDecision["metadata"]
): Record<string, unknown> {
  let nextArgs = args

  if (metadata?.executeCommandPolicy) {
    nextArgs = withExecuteCommandPolicy(nextArgs, metadata.executeCommandPolicy)
  }

  if (metadata?.mutationPrediction) {
    nextArgs = withMutationPrediction(nextArgs, metadata.mutationPrediction)
  }

  return nextArgs
}

export function createGuardrailMiddleware(options: CreateGuardrailMiddlewareOptions) {
  const { provider, threadId, workspacePath } = options

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
          code: "openwork.guardrail_denied",
          message: "blocked by guardrail policy"
        }
        return buildDeniedMessage(toolName, toolCallId, reason)
      }

      const nextToolCall =
        isRecord(request.toolCall.args) &&
        (decision.metadata?.mutationPrediction || decision.metadata?.executeCommandPolicy)
          ? {
              ...request.toolCall,
              args: applyGuardrailMetadata(request.toolCall.args, decision.metadata)
            }
          : request.toolCall

      return handler({
        ...request,
        toolCall: nextToolCall
      })
    }
  })
}
