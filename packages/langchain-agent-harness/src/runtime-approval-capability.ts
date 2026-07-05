import type { RuntimeExecutionMiddleware } from "./harness-runtime"
import { createJingleHumanApprovalHook } from "./human-approval-middleware"
import type { RuntimeControlHostContract } from "./runtime-contract"

export interface CreateRuntimeApprovalEntriesInput<
  TContextInclusion = unknown,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  control: RuntimeControlHostContract<
    TContextInclusion,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
}

export function createRuntimeApprovalEntries<
  TContextInclusion = unknown,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
>(
  input: CreateRuntimeApprovalEntriesInput<
    TContextInclusion,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
): readonly RuntimeExecutionMiddleware[] {
  const { approvalController } = input.control

  return [
    createJingleHumanApprovalHook({
      allowedDecisions: approvalController.allowedDecisions,
      middlewareName: "ToolApprovalMiddleware",
      policyRuntime: approvalController.policyRuntime,
      requestApproval: approvalController.requestApproval
    })
  ]
}
