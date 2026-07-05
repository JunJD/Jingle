import { createJingleArtifactToolsHook } from "./artifact-tools-middleware"
import { createJingleDesktopAutomationToolsMiddleware } from "./desktop-automation-tools"
import { createJingleExtensionAiToolsHook } from "./extension-ai-tools-middleware"
import { createFilesystemToolErrorMiddleware } from "./filesystem-tool-error-middleware"
import { createJinglePatchToolCallsMiddleware } from "./harness-runtime/patch-tool-calls"
import type { RuntimeExecutionMiddleware, RuntimeMiddlewareHook } from "./harness-runtime"
import { createJingleTodoHook } from "./jingle-todo-middleware"
import type { RuntimeEnvironmentHostContract, RuntimeRunContextScope, RuntimeThreadScope } from "./runtime-contract"
import {
  createRuntimeSandboxCapability,
  type CreateRuntimeSandboxCapabilityInput,
  type RuntimeSandboxCapability
} from "./runtime-sandbox-capability"
import { createToolCallConsistencyMiddleware } from "./tool-call-consistency-middleware"
import { createJingleWebToolsMiddleware } from "./web-tools"

export type CreateRuntimeCoreToolCapabilityInput = CreateRuntimeSandboxCapabilityInput

export interface RuntimeCoreToolCapability extends RuntimeSandboxCapability {
  todosEntry: RuntimeMiddlewareHook
}

export interface CreateRuntimeToolEntriesInput {
  core: RuntimeCoreToolCapability
  environment: RuntimeEnvironmentHostContract
  runContext: RuntimeRunContextScope
  thread: RuntimeThreadScope
}

export function createRuntimeCoreToolCapability(
  input: CreateRuntimeCoreToolCapabilityInput
): RuntimeCoreToolCapability {
  const sandbox = createRuntimeSandboxCapability(input)

  return {
    ...sandbox,
    todosEntry: createJingleTodoHook()
  }
}

export function createRuntimeToolEntries(
  input: CreateRuntimeToolEntriesInput
): readonly RuntimeExecutionMiddleware[] {
  const { environment } = input

  return [
    createToolCallConsistencyMiddleware(),
    input.core.todosEntry,
    createFilesystemToolErrorMiddleware(),
    input.core.filesystemEntry,
    createJingleArtifactToolsHook(environment.artifactPresentation(input.thread)),
    createJingleWebToolsMiddleware(environment.webTools),
    createJingleDesktopAutomationToolsMiddleware(environment.desktopAutomationTools),
    createJingleExtensionAiToolsHook(environment.extensionAiTools(input.runContext)),
    createJinglePatchToolCallsMiddleware(),
    input.core.skillsEntry
  ]
}
