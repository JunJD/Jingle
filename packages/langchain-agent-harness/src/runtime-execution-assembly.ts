import type { AgentRunSteeringBufferPort } from "./run-steering"
import { createRuntimeAgentLoopEntries } from "./agent-loop"
import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import type { RuntimeExecutionMiddleware } from "./harness-runtime"
import type {
  RuntimeHostContract,
  RuntimeRunContextScope,
  RuntimeThreadScope
} from "./runtime-contract"
import { createRuntimeApprovalEntries } from "./runtime-approval-capability"
import { createRuntimeContextEntries } from "./runtime-context-capability"
import { createRuntimeGuardrailEntries } from "./runtime-guardrail-capability"
import { createRuntimeSteeringEntries } from "./runtime-steering-capability"
import { createRuntimeTitleEntries } from "./runtime-title-capability"
import {
  createRuntimeCoreToolCapability,
  createRuntimeToolEntries
} from "./runtime-tool-capability"

export interface RuntimeExecutionAssemblyInput<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  host: RuntimeHostContract<
    TContextInclusion,
    TGuardrailMetadata,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
  runContext: RuntimeRunContextScope
  steeringBuffer?: AgentRunSteeringBufferPort | null
  thread: RuntimeThreadScope
}

export interface RuntimeExecutionAssembly {
  middleware: readonly RuntimeExecutionMiddleware[]
}

export function assembleRuntimeExecution<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
>(
  input: RuntimeExecutionAssemblyInput<
    TContextInclusion,
    TGuardrailMetadata,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
): RuntimeExecutionAssembly {
  const { host, runContext, thread } = input
  const { context, control, environment } = host
  const coreToolCapability = createRuntimeCoreToolCapability({
    backend: environment.backend,
    executeToolDescription: environment.executeToolDescription,
    filesystemSystemPrompt: environment.filesystemSystemPrompt,
    skillSources: environment.skillSources
  })
  const toolEntries = createRuntimeToolEntries({
    core: coreToolCapability,
    environment,
    runContext,
    thread
  })
  const rootTailEntries = compactRuntimeEntries([
    ...createRuntimeContextEntries<TContextInclusion, TGuardrailMetadata>({
      context,
      runContext,
      thread
    }),
    ...createRuntimeSteeringEntries({
      steeringBuffer: input.steeringBuffer
    }),
    ...createRuntimeTitleEntries({ context }),
    ...createRuntimeGuardrailEntries<TContextInclusion, TGuardrailMetadata>({ context, thread }),
    ...createRuntimeApprovalEntries({ control })
  ])

  return {
    middleware: createRuntimeAgentLoopEntries({
      rootTailEntries,
      toolEntries
    })
  }
}

function compactRuntimeEntries<TEntry>(
  entries: readonly (TEntry | null | undefined)[]
): TEntry[] {
  return entries.filter((candidate): candidate is TEntry => candidate != null)
}
