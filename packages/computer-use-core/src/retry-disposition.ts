import type {
  ComputerUseRetryDisposition,
  ComputerUseSemanticAction,
  ComputerUseTransactionResult
} from "./contract"
import { sameComputerUseSemanticAction } from "./semantic-action"

export function computerUseResultAllowsForegroundRetry(
  result: ComputerUseTransactionResult,
  actions: readonly ComputerUseSemanticAction[] = result.steps.map((step) => step.action)
): boolean {
  return (
    result.outcome === "didnt" &&
    result.steps.length === actions.length &&
    (result.stoppedAt === undefined || result.stoppedAt === result.steps.length - 1) &&
    result.steps.every(
      (step, index) =>
        sameComputerUseSemanticAction(step.action, actions[index]!) &&
        step.outcome === "didnt" &&
        step.evidence.noSideEffectProof &&
        step.evidence.verification === "failed"
    )
  )
}

export function getComputerUseRetryDisposition(
  result: ComputerUseTransactionResult,
  actions: readonly ComputerUseSemanticAction[]
): ComputerUseRetryDisposition {
  if (computerUseResultAllowsForegroundRetry(result, actions)) {
    return Object.freeze({ allowed: true, reason: "proven_no_side_effect" })
  }
  if (result.outcome === "cancelled_before_dispatch") {
    return Object.freeze({ allowed: false, reason: "cancelled" })
  }
  if (result.outcome === "refused" || result.outcome === "unavailable") {
    return Object.freeze({ allowed: false, reason: "not_actionable" })
  }
  return Object.freeze({ allowed: false, reason: "side_effect_possible" })
}
