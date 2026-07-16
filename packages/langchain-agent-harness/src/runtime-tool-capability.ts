import { createArtifactToolsMiddleware } from "./artifact-tools-middleware"
import { createJingleDesktopAutomationToolsMiddleware } from "./desktop-automation-tools"
import { createExtensionAiToolsMiddleware } from "./extension-ai-tools-middleware"
import { createFilesystemToolErrorMiddleware } from "./filesystem-tool-error-middleware"
import { createJinglePatchToolCallsMiddleware } from "./harness-runtime/patch-tool-calls"
import type { RuntimeExecutionMiddleware } from "./harness-runtime"
import { createTodoMiddleware } from "./jingle-todo-middleware"
import type { RuntimeResolvedEnvironmentHostContract } from "./runtime-contract"
import type { RuntimeRunContextScope, RuntimeThreadScope } from "./runtime-scope"
import {
  createRuntimeSandboxCapability,
  type CreateRuntimeSandboxCapabilityInput,
  type RuntimeSandboxCapability
} from "./runtime-sandbox-capability"
import { createToolCallConsistencyMiddleware } from "./tool-call-consistency-middleware"
import { createJingleWebToolsMiddleware } from "./web-tools"

export type CreateRuntimeCoreToolCapabilityInput = CreateRuntimeSandboxCapabilityInput

export interface RuntimeCoreToolCapability extends RuntimeSandboxCapability {
  todosEntry: RuntimeExecutionMiddleware
}

export interface CreateRuntimeToolEntriesInput {
  core: RuntimeCoreToolCapability
  environment: RuntimeResolvedEnvironmentHostContract
  runContext: RuntimeRunContextScope
  thread: RuntimeThreadScope
}

export function createRuntimeCoreToolCapability(
  input: CreateRuntimeCoreToolCapabilityInput
): RuntimeCoreToolCapability {
  const sandbox = createRuntimeSandboxCapability(input)

  return {
    ...sandbox,
    todosEntry: createTodoMiddleware()
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
    createArtifactToolsMiddleware(environment.artifactPresentation(input.thread)),
    createJingleWebToolsMiddleware(environment.webTools),
    createJingleDesktopAutomationToolsMiddleware(environment.desktopAutomationTools),
    createExtensionAiToolsMiddleware(environment.extensionAiTools(input.runContext)),
    createJinglePatchToolCallsMiddleware(),
    input.core.skillsEntry
  ]
}
