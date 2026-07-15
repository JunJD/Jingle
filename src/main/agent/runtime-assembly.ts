import type { CreateRuntimeInput, Runtime } from "@jingle/langchain-agent-harness"
import { createRuntime } from "@jingle/langchain-agent-harness"
import type { JingleTitleGenerationModel } from "@jingle/langchain-agent-harness/transitional"
import {
  buildJingleExecuteToolDescription,
  buildJingleFilesystemSystemPrompt,
  buildJingleSkillSources,
  buildJingleSystemPrompt,
  createRuntimeCompactionSummarizationController,
  createJingleTitleGenerator
} from "@jingle/langchain-agent-harness/transitional"
import { getDefaultHitlAllowedDecisions } from "@shared/hitl"
import { withMutationPrediction } from "@shared/mutation-prediction"
import { withExecuteCommandPolicy } from "@shared/execute-command-policy"
import type { AgentContextInclusion } from "@shared/jingle-memory"
import { createArtifactPresentationHandler } from "./artifact-presentation-handler"
import { createAgentContextInclusionToolHandlers } from "./context-retrieval-tool-handlers"
import { createToolPermissionRuntime } from "./tool-permission-runtime"
import { createWorkspaceFileContextResolver } from "./workspace-file-context-resolver"
import { createDesktopAutomationRunner } from "../services/desktop-automation-native"
import {
  clickScreenPoint,
  findAxElements,
  openApplication,
  openDesktopRoute,
  pressAxElement
} from "../services/desktop-automation"
import {
  parseClickScreenPointRequest,
  parseFindAxElementsRequest,
  parseOpenApplicationRequest,
  parseOpenDesktopRouteRequest,
  parsePressAxElementRequest
} from "../services/desktop-automation-parser"
import { searchWeb } from "../services/web-tools/search"
import type { WorkspaceService } from "../workspace/service"
import { getAgentConfig } from "../preferences"
import { getJingleHomeDir } from "../storage"
import { createJingleMemoryHarnessPortOptions } from "../jingle-memory/harness-memory-port"
import type { JingleMemoryService } from "../jingle-memory/service"
import { getChatModelInstance } from "../llm/get-chat-model"
import type { ExecuteCommandGuardrailMetadata } from "./execute-command-guardrail-provider"
import { createExecuteCommandGuardrailProvider } from "./execute-command-guardrail-provider"
import { JustBashExecuteCommandClassifier } from "./execute-command-classifier"
import { JustBashMutationPredictor } from "./mutation-predictor"
import { appendAgentEventSafely } from "../db/agent-events"
import { buildAgentRunTraceConfig } from "../observability/agent-trace"
import { getDevtoolsNetworkRecorder } from "@jingle/devtools-network/main"
import {
  createRuntimeRunLifecycleController,
  type JingleInvokeRunLifecycleInput,
  type JingleResumeRunLifecycleInput
} from "./run-lifecycle-controller"
import { createRuntimePauseController } from "./pause-controller"
import type { ToolApprovalItem } from "@shared/tool-approval"
import { getCheckpointer } from "../checkpointer/runtime-checkpointer-manager"
import { LocalSandbox } from "./local-sandbox"

const TITLE_GENERATION_TIMEOUT_MS = 2_500
const desktopAutomationRunner = createDesktopAutomationRunner()

type JingleRuntimeInput = CreateRuntimeInput<
  AgentContextInclusion,
  ExecuteCommandGuardrailMetadata,
  ToolApprovalItem,
  JingleInvokeRunLifecycleInput,
  JingleResumeRunLifecycleInput
>

type JingleRuntime = Runtime<
  AgentContextInclusion,
  JingleInvokeRunLifecycleInput,
  JingleResumeRunLifecycleInput
>

export interface CreateAgentRuntimeInput {
  jingleMemoryService: JingleMemoryService
  workspaceService: WorkspaceService
}

type JingleExecutionInput = JingleInvokeRunLifecycleInput | JingleResumeRunLifecycleInput
type JingleExecutionCapabilities = ReturnType<JingleRuntimeInput["bindExecution"]["invoke"]>

export function createAgentRuntime(input: CreateAgentRuntimeInput): JingleRuntime {
  return createRuntime(createAgentRuntimeInput(input))
}

function createAgentRuntimeInput(input: CreateAgentRuntimeInput): JingleRuntimeInput {
  const runLifecycleController = createRuntimeRunLifecycleController({
    jingleMemoryService: input.jingleMemoryService
  })
  const bindExecution: JingleRuntimeInput["bindExecution"] = {
    invoke: ({ invoke, start }) => createAgentExecutionCapabilities(input, invoke, start.modelId),
    resume: ({ resume, start }) => createAgentExecutionCapabilities(input, resume, start.modelId)
  }

  return {
    bindExecution,
    control: {
      pauseController: createRuntimePauseController(),
      runLifecycleController
    }
  }
}

function createAgentExecutionCapabilities(
  input: CreateAgentRuntimeInput,
  executionInput: JingleExecutionInput,
  modelId: string
): JingleExecutionCapabilities {
  const {
    extensionAiRuntime,
    jingleMemoryContextPack,
    jingleMemoryTemporaryMode,
    permissionMode,
    workspaceIdentity
  } = executionInput

  return {
    model: {
      model: () =>
        getChatModelInstance({
          modelId,
          parallelToolCalls: false
        })
    },
    checkpoint: {
      checkpointer: (thread, resolution) =>
        resolveManagedRuntimeCheckpointer(thread.threadId, resolution.signal)
    },
    tools: {
      artifactPresentation: (thread) => ({
        presentArtifacts: createArtifactPresentationHandler({
          threadId: thread.threadId,
          workspacePath: thread.workspacePath
        })
      }),
      backend: (thread) =>
        new LocalSandbox({
          rootDir: thread.workspacePath,
          virtualMode: false,
          timeout: 120_000,
          maxOutputBytes: 100_000
        }),
      desktopAutomationTools: {
        clickScreenPoint: async (toolInput) => {
          const request = parseClickScreenPointRequest(toolInput)
          return clickScreenPoint(request, desktopAutomationRunner)
        },
        findAxElements: async (toolInput) => {
          const request = parseFindAxElementsRequest(toolInput)
          return findAxElements(request, desktopAutomationRunner)
        },
        openApplication: async (toolInput) => {
          const request = parseOpenApplicationRequest(toolInput)
          return openApplication(request, desktopAutomationRunner)
        },
        openDesktopRoute: async (toolInput) => {
          const request = parseOpenDesktopRouteRequest(toolInput)
          return openDesktopRoute(request, desktopAutomationRunner)
        },
        pressAxElement: async (toolInput) => {
          const request = parsePressAxElementRequest(toolInput)
          return pressAxElement(request, desktopAutomationRunner)
        }
      },
      extensionAiTools: (run) =>
        extensionAiRuntime.createToolsOptions({
          runId: run.runId,
          threadId: run.threadId,
          workspacePath: run.workspacePath
        }),
      skillSources: (thread) =>
        buildJingleSkillSources({
          configuredSources: getAgentConfig().skillSources,
          jingleHomeDir: getJingleHomeDir(),
          workspacePath: thread.workspacePath
        }),
      webTools: {
        searchWeb
      }
    },
    context: {
      contextRetrieval: (run) =>
        createAgentContextInclusionToolHandlers({
          threadId: run.threadId
        }),
      guardrail: (thread) => ({
        applyMetadata: applyGuardrailMetadata,
        provider: createExecuteCommandGuardrailProvider({
          classifier: new JustBashExecuteCommandClassifier(),
          predictor: new JustBashMutationPredictor({
            workspacePath: thread.workspacePath
          })
        })
      }),
      memory: (run) =>
        createJingleMemoryHarnessPortOptions({
          allowSuggestions:
            !jingleMemoryTemporaryMode &&
            input.jingleMemoryService.getSettings().useMemory === true,
          contextPack: jingleMemoryContextPack,
          service: input.jingleMemoryService,
          temporaryMode: jingleMemoryTemporaryMode,
          threadId: run.threadId,
          workspaceIdentity
        }),
      systemPrompt: (thread) => buildJingleSystemPrompt(thread.workspacePath),
      workspaceFileContext: (thread) => ({
        resolveContext: createWorkspaceFileContextResolver({
          threadId: thread.threadId,
          workspaceService: input.workspaceService
        })
      })
    },
    control: {
      approvalController: () => ({
        allowedDecisions: getDefaultHitlAllowedDecisions(),
        policyRuntime: createToolPermissionRuntime({
          extensionToolPolicyProvider: extensionAiRuntime.approvalPolicyProvider,
          permissionMode
        })
      })
    },
    observation: {
      trace: {
        createRunConfig: ({ runId, source, threadId }) =>
          buildAgentRunTraceConfig({
            modelId,
            permissionMode,
            runId,
            source,
            threadId
          }),
        recordEvent: async ({ event, runId, threadId }) => {
          getDevtoolsNetworkRecorder().append({
            channel: event.type,
            metadata: {
              runId,
              threadId
            },
            payload: event.payload,
            source: "agent-trace",
            status: "sent"
          })
          await appendAgentEventSafely({
            payload: event.payload,
            runId,
            threadId,
            type: event.type
          })
        }
      }
    },
    compaction: {
      summarization: (scope) =>
        createRuntimeCompactionSummarizationController({
          backend: new LocalSandbox({
            rootDir: scope.workspacePath,
            virtualMode: false,
            timeout: 120_000,
            maxOutputBytes: 100_000
          }),
          model: getChatModelInstance({
            modelId,
            parallelToolCalls: false
          })
        })
    },
    prompt: {
      executeToolDescription: (thread) => buildJingleExecuteToolDescription(thread.workspacePath),
      filesystemSystemPrompt: (thread) => buildJingleFilesystemSystemPrompt(thread.workspacePath),
      titleGenerator: createJingleTitleGenerator({
        createModel: createThreadTitleModel,
        onError: (error) => {
          console.warn("[TitleMiddleware] Failed to generate title.", error)
        },
        timeoutMs: TITLE_GENERATION_TIMEOUT_MS
      })
    }
  }
}

function resolveManagedRuntimeCheckpointer(
  threadId: string,
  signal: AbortSignal
): ReturnType<typeof getCheckpointer> {
  signal.throwIfAborted()
  // The manager owns and caches the saver; this run only owns its abortable wait.
  const pending = getCheckpointer(threadId)

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (operation: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", onAbort)
      operation()
    }
    const onAbort = (): void => {
      finish(() => reject(signal.reason))
    }

    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) onAbort()
    pending.then(
      (checkpointer) => {
        finish(() => resolve(checkpointer))
      },
      (error: unknown) => {
        if (settled) {
          console.error("[Runtime] Managed checkpointer failed after run cancellation.", error)
          return
        }
        finish(() => reject(error))
      }
    )
  })
}

function applyGuardrailMetadata(
  args: Record<string, unknown>,
  metadata: ExecuteCommandGuardrailMetadata | undefined
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

function createThreadTitleModel(): JingleTitleGenerationModel {
  return getChatModelInstance({
    modelPreference: "fast",
    temperature: 0,
    thinkingEffort: "off"
  })
}
