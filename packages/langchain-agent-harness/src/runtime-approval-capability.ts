import type { RuntimeExecutionMiddleware } from "./harness-runtime"
import { createHumanApprovalMiddleware } from "./human-approval-middleware"
import type { RuntimeResolvedControlHostContract } from "./runtime-contract"

export interface CreateRuntimeApprovalEntriesInput<
  TContextInclusion = unknown,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  control: RuntimeResolvedControlHostContract<
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
    createHumanApprovalMiddleware({
      allowedDecisions: approvalController.allowedDecisions,
      middlewareName: "ToolApprovalMiddleware",
      policyRuntime: approvalController.policyRuntime,
      requestApproval: approvalController.requestApproval
    })
  ]
}
