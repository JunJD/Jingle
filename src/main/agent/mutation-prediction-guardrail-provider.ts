import type { MutationPredictionStatus } from "@shared/mutation-prediction"
import type { GuardrailDecision, GuardrailProvider, GuardrailRequest } from "./guardrail-middleware"
import type { MutationPredictor } from "./mutation-predictor"

const EXECUTE_TOOL_NAME = "execute"

export interface MutationPredictionGuardrailProviderOptions {
  predictor: MutationPredictor
  denyStatuses?: MutationPredictionStatus[]
}

export function createMutationPredictionGuardrailProvider(
  options: MutationPredictionGuardrailProviderOptions
): GuardrailProvider {
  const denyStatuses = new Set(options.denyStatuses ?? [])

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

      const prediction = await options.predictor.predictExecute(command)
      const blocked = denyStatuses.has(prediction.status)

      return {
        allow: !blocked,
        reasons: blocked
          ? [
              {
                code: "openwork.prediction_denied",
                message: `Command blocked because mutation prediction status was '${prediction.status}'.`
              }
            ]
          : [
              {
                code: "openwork.prediction_attached",
                message: prediction.summary
              }
            ],
        metadata: {
          mutationPrediction: prediction
        }
      }
    }
  }
}
