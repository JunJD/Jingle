import type {
  CreateRuntimeInput,
  Runtime,
  RuntimeRunContext
} from "@jingle/langchain-agent-harness"
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
  type AgentRuntimeRunFacts,
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

interface AgentRuntimeRunFactRegistry {
  delete(runId: string): void
  get(runId: string): AgentRuntimeRunFacts
  set(runId: string, facts: AgentRuntimeRunFacts): void
}

export function createAgentRuntime(input: CreateAgentRuntimeInput): JingleRuntime {
  return createRuntime(createAgentRuntimeInput(input))
}

function createAgentRuntimeInput(input: CreateAgentRuntimeInput): JingleRuntimeInput {
  const runFacts = createAgentRuntimeRunFactRegistry()
  const runLifecycleController = createRuntimeRunLifecycleController({
    jingleMemoryService: input.jingleMemoryService,
    onRunStarted: ({ facts, runId }) => runFacts.set(runId, facts),
    onRunSettled: ({ runId }) => runFacts.delete(runId)
  })

  return {
    capabilities: {
      model: {
        model: (scope) =>
          getChatModelInstance({
            modelId: readRunModelId(scope, runFacts),
            parallelToolCalls: false
          })
      },
      checkpoint: {
        checkpointer: (thread) => getCheckpointer(thread.threadId)
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
          runFacts.get(run.runId).extensionAiRuntime.createToolsOptions({
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
        memory: (run: RuntimeRunContext) => {
          const facts = runFacts.get(run.runId)
          return createJingleMemoryHarnessPortOptions({
            allowSuggestions:
              !facts.jingleMemoryTemporaryMode &&
              input.jingleMemoryService.getSettings().useMemory === true,
            contextPack: facts.jingleMemoryContextPack,
            service: input.jingleMemoryService,
            temporaryMode: facts.jingleMemoryTemporaryMode,
            threadId: run.threadId,
            workspaceIdentity: facts.workspaceIdentity
          })
        },
        systemPrompt: (thread) => buildJingleSystemPrompt(thread.workspacePath),
        workspaceFileContext: (thread) => ({
          resolveContext: createWorkspaceFileContextResolver({
            threadId: thread.threadId,
            workspaceService: input.workspaceService
          })
        })
      },
      control: {
        approvalController: (scope) => {
          const facts = runFacts.get(scope.runId)
          return {
            allowedDecisions: getDefaultHitlAllowedDecisions(),
            policyRuntime: createToolPermissionRuntime({
              extensionToolPolicyProvider: facts.extensionAiRuntime.approvalPolicyProvider,
              permissionMode: facts.permissionMode
            })
          }
        },
        pauseController: createRuntimePauseController(),
        runLifecycleController
      },
      observation: {
        trace: {
          createRunConfig: ({ runId, source, threadId }) =>
            buildAgentRunTraceConfig({
              modelId: runFacts.get(runId).modelId,
              permissionMode: runFacts.get(runId).permissionMode,
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
              modelId: readRunModelId(scope, runFacts),
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
}

function readRunModelId(
  scope: { modelId?: string; runId: string },
  runFacts: AgentRuntimeRunFactRegistry
): string | undefined {
  if (scope.modelId) {
    return scope.modelId
  }

  return runFacts.get(scope.runId).modelId
}

function createAgentRuntimeRunFactRegistry(): AgentRuntimeRunFactRegistry {
  const factsByRunId = new Map<string, AgentRuntimeRunFacts>()

  return {
    delete(runId) {
      factsByRunId.delete(runId)
    },
    get(runId) {
      const facts = factsByRunId.get(runId)
      if (!facts) {
        throw new Error(`[Runtime] Missing run facts for run "${runId}".`)
      }
      return facts
    },
    set(runId, facts) {
      factsByRunId.set(runId, facts)
    }
  }
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
