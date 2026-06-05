import type { ExecuteCommandPolicy } from "@shared/execute-command-policy"
import type { GuardrailDecision, GuardrailProvider, GuardrailRequest } from "./guardrail-middleware"
import { assertSafePublicHttpUrl } from "../services/web-tools/url-guard"
import type { ExecuteCommandClassifier } from "./execute-command-classifier"
import type { MutationPredictor } from "./mutation-predictor"

const EXECUTE_TOOL_NAME = "execute"

export interface ExecuteCommandGuardrailProviderOptions {
  classifier: ExecuteCommandClassifier
  predictor: MutationPredictor
}

function buildDeniedDecision(
  reason: string,
  metadata?: GuardrailDecision["metadata"]
): GuardrailDecision {
  return {
    allow: false,
    reasons: [
      {
        code: "openwork.controlled_shell_denied",
        message: reason
      }
    ],
    metadata
  }
}

function buildAllowedDecision(
  classification: ExecuteCommandPolicy,
  metadata?: GuardrailDecision["metadata"]
): GuardrailDecision {
  return {
    allow: true,
    reasons: [
      {
        code: "openwork.controlled_shell_allowed",
        message: classification.summary
      }
    ],
    metadata: {
      ...metadata,
      executeCommandPolicy: classification
    }
  }
}

function buildUnknownCommandPolicy(
  classification: ExecuteCommandPolicy,
  reason: string
): ExecuteCommandPolicy {
  return {
    ...classification,
    profile: "unknown_command",
    disposition: "require_approval",
    summary: `Unknown command requires approval (${classification.commands.slice(0, 4).join(", ") || "shell command"}).`,
    reason
  }
}

export function createExecuteCommandGuardrailProvider(
  options: ExecuteCommandGuardrailProviderOptions
): GuardrailProvider {
  return {
    async evaluate(request: GuardrailRequest): Promise<GuardrailDecision> {
      if (request.toolName !== EXECUTE_TOOL_NAME) {
        return {
          allow: true
        }
      }

      const command =
        typeof request.toolInput.command === "string" ? request.toolInput.command : null
      if (!command || command.trim().length === 0) {
        return {
          allow: true
        }
      }

      const classification = options.classifier.classify(command)

      if (classification.disposition === "deny") {
        return buildDeniedDecision(classification.reason, {
          executeCommandPolicy: classification
        })
      }

      if (classification.networkTargets?.length) {
        try {
          await Promise.all(
            classification.networkTargets.map((target) => assertSafePublicHttpUrl(target))
          )
        } catch (error) {
          return buildDeniedDecision(
            error instanceof Error
              ? error.message
              : "Network targets are outside the controlled shell profile.",
            {
              executeCommandPolicy: classification
            }
          )
        }
      }

      if (classification.disposition === "allow") {
        return buildAllowedDecision(classification)
      }

      if (classification.profile !== "predictable_mutation") {
        return buildAllowedDecision(classification)
      }

      const prediction = await options.predictor.predictExecute(command)
      if (prediction.status !== "predicted") {
        if (prediction.status === "unsupported_command") {
          return buildAllowedDecision(
            buildUnknownCommandPolicy(
              classification,
              "Command could not be simulated in just-bash, so it is treated as an unknown command and requires user approval."
            ),
            {
              mutationPrediction: prediction
            }
          )
        }

        return buildDeniedDecision(
          `Command may modify files, but target files could not be predicted (${prediction.status}). Use explicit file tools or simplify the shell command.`,
          {
            executeCommandPolicy: classification,
            mutationPrediction: prediction
          }
        )
      }

      return buildAllowedDecision(classification, {
        mutationPrediction: prediction
      })
    }
  }
}
