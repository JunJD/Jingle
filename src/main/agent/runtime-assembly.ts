import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint"
import type {
  CreateRuntimeInput,
  Runtime,
  RuntimeBackend,
  RuntimeModelProvider,
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
import type { PermissionModeName } from "@shared/permission-mode"
import type { ResolvedExtensionAiCapability } from "@shared/extension-sources"
import type {
  AgentContextInclusion,
  JingleMemoryContextPack,
  JingleWorkspaceIdentity
} from "@shared/jingle-memory"
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
import type { createExtensionAiRuntime } from "./extension-ai-runtime"
import { appendAgentEventSafely } from "../db/agent-events"
import {
  buildAgentRunTraceConfig,
  buildAgentRuntimeTraceConfig
} from "../observability/agent-trace"
import { getDevtoolsNetworkRecorder } from "@jingle/devtools-network/main"
import {
  createRuntimeRunLifecycleController,
  type JingleInvokeRunLifecycleInput,
  type JingleResumeRunLifecycleInput
} from "./run-lifecycle-controller"
import { createRuntimePauseController } from "./pause-controller"
import type { ToolApprovalItem } from "@shared/tool-approval"

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

type JingleRuntimeCapability = JingleRuntimeInput["capabilities"][number]

export interface CreateAgentRuntimeInput {
  capabilities: JingleAgentRuntimeCapabilities
}

export interface JingleAgentRuntimeCapabilities {
  approval: JingleAgentRuntimeApprovalCapability
  checkpoint: JingleAgentRuntimeCheckpointCapability
  extensionAi: JingleAgentRuntimeExtensionAiCapability
  memory: JingleAgentRuntimeMemoryCapability
  model: JingleAgentRuntimeModelCapability
  workspaceContext: JingleAgentRuntimeWorkspaceContextCapability
}

export interface JingleAgentRuntimeApprovalCapability {
  permissionMode: PermissionModeName
}

export interface JingleAgentRuntimeCheckpointCapability {
  checkpointer: BaseCheckpointSaver<string | number>
}

export interface JingleAgentRuntimeExtensionAiCapability {
  capabilitySnapshot: ResolvedExtensionAiCapability[]
  runtime: ReturnType<typeof createExtensionAiRuntime>
}

export interface JingleAgentRuntimeMemoryCapability {
  contextPack?: JingleMemoryContextPack | null
  service: JingleMemoryService | null
  temporaryMode: boolean
  workspaceIdentity?: JingleWorkspaceIdentity
}

export interface JingleAgentRuntimeModelCapability {
  model: RuntimeModelProvider
  modelId?: string
}

export interface JingleAgentRuntimeWorkspaceContextCapability {
  backend: RuntimeBackend
  service: WorkspaceService | null
  workspacePath: string
}

export function createAgentRuntime(input: CreateAgentRuntimeInput): JingleRuntime {
  return createRuntime(createAgentRuntimeInput(input))
}

function createAgentRuntimeInput(input: CreateAgentRuntimeInput): JingleRuntimeInput {
  const { capabilities } = input
  const permissionMode = capabilities.approval.permissionMode
  const workspacePath = capabilities.workspaceContext.workspacePath
  const agentConfig = getAgentConfig()
  const skillSources = buildJingleSkillSources({
    configuredSources: agentConfig.skillSources,
    jingleHomeDir: getJingleHomeDir(),
    workspacePath
  })
  const guardrailProvider = createExecuteCommandGuardrailProvider({
    classifier: new JustBashExecuteCommandClassifier(),
    predictor: new JustBashMutationPredictor({
      workspacePath
    })
  })
  const jingleMemoryService = capabilities.memory.service ?? null
  const workspaceService = capabilities.workspaceContext.service ?? null
  const allowJingleMemorySuggestions =
    jingleMemoryService !== null &&
    !capabilities.memory.temporaryMode &&
    jingleMemoryService.getSettings().useMemory === true
  const jingleMemoryWorkspaceIdentity =
    capabilities.memory.contextPack?.workspaceIdentity ?? capabilities.memory.workspaceIdentity
  const resolvedJingleMemoryWorkspaceIdentity = jingleMemoryWorkspaceIdentity ?? {
    canonicalWorkspacePath: workspacePath,
    displayName: workspacePath,
    workspaceKey: workspacePath
  }
  const memoryPort = jingleMemoryService
    ? (run: RuntimeRunContext) =>
        createJingleMemoryHarnessPortOptions({
          allowSuggestions: allowJingleMemorySuggestions,
          contextPack: capabilities.memory.contextPack ?? null,
          service: jingleMemoryService,
          temporaryMode: capabilities.memory.temporaryMode === true,
          threadId: run.threadId,
          workspaceIdentity: resolvedJingleMemoryWorkspaceIdentity
        })
    : undefined

  return {
    capabilities: [
      {
        kind: "model",
        name: "model",
        contribute: () => ({
          model: {
            model: capabilities.model.model
          }
        })
      },
      {
        kind: "checkpoint",
        name: "checkpoint",
        contribute: () => ({
          checkpoint: {
            checkpointer: capabilities.checkpoint.checkpointer
          }
        })
      },
      {
        kind: "tools",
        name: "tools",
        contribute: () => ({
          tools: {
            artifactPresentation: (thread) => ({
              presentArtifacts: createArtifactPresentationHandler({
                threadId: thread.threadId,
                workspacePath: thread.workspacePath
              })
            }),
            backend: capabilities.workspaceContext.backend,
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
            skillSources,
            webTools: {
              searchWeb
            }
          }
        })
      },
      {
        kind: "tools",
        name: "extension-ai-tools",
        contribute: () => ({
          tools: {
            extensionAiTools: (run) =>
              capabilities.extensionAi.runtime.createToolsOptions({
                runId: run.runId,
                threadId: run.threadId,
                workspacePath: run.workspacePath
              })
          }
        })
      },
      {
        kind: "context",
        name: "workspace-context",
        contribute: () => ({
          context: {
            contextRetrieval: (run) =>
              createAgentContextInclusionToolHandlers({
                threadId: run.threadId
              }),
            guardrail: () => ({
              applyMetadata: applyGuardrailMetadata,
              provider: guardrailProvider
            }),
            systemPrompt: buildJingleSystemPrompt(workspacePath),
            workspaceFileContext: workspaceService
              ? (thread) => ({
                  resolveContext: createWorkspaceFileContextResolver({
                    threadId: thread.threadId,
                    workspaceService
                  })
                })
              : undefined
          }
        })
      },
      ...(memoryPort
        ? [
            {
              kind: "context",
              name: "memory",
              contribute: () => ({ context: { memory: memoryPort } })
            } satisfies JingleRuntimeCapability
          ]
        : []),
      {
        kind: "control",
        name: "approval",
        contribute: () => ({
          control: {
            approvalController: {
              allowedDecisions: getDefaultHitlAllowedDecisions(),
              policyRuntime: createToolPermissionRuntime({
                extensionToolPolicyProvider: capabilities.extensionAi.runtime.approvalPolicyProvider,
                permissionMode
              })
            },
            pauseController: createRuntimePauseController()
          }
        })
      },
      {
        kind: "control",
        name: "run-lifecycle",
        contribute: () => ({
          control: {
            runLifecycleController: createRuntimeRunLifecycleController({
              jingleMemoryService
            })
          }
        })
      },
      {
        kind: "observation",
        name: "observation",
        contribute: () => ({
          observation: {
            trace: {
              createRunConfig: ({ runId, source, threadId }) =>
                buildAgentRunTraceConfig({
                  modelId: capabilities.model.modelId,
                  permissionMode,
                  runId,
                  source,
                  threadId
                }),
              createRuntimeConfig: () =>
                buildAgentRuntimeTraceConfig({
                  aiCapabilities: capabilities.extensionAi.runtime.session.getAiCapabilities(),
                  modelId: capabilities.model.modelId,
                  permissionMode
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
          }
        })
      },
      {
        kind: "compaction",
        name: "compaction",
        contribute: () => ({
          compaction: {
            summarization: createRuntimeCompactionSummarizationController({
              backend: capabilities.workspaceContext.backend,
              model: capabilities.model.model
            })
          }
        })
      },
      {
        kind: "prompt",
        name: "prompt",
        contribute: () => ({
          prompt: {
            executeToolDescription: buildJingleExecuteToolDescription(workspacePath),
            filesystemSystemPrompt: buildJingleFilesystemSystemPrompt(workspacePath),
            titleGenerator: createJingleTitleGenerator({
              createModel: createThreadTitleModel,
              onError: (error) => {
                console.warn("[TitleMiddleware] Failed to generate title.", error)
              },
              timeoutMs: TITLE_GENERATION_TIMEOUT_MS
            })
          }
        })
      }
    ] satisfies JingleRuntimeCapability[]
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
