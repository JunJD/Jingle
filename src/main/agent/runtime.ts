/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  createFilesystemMiddleware,
  createPatchToolCallsMiddleware,
  createSkillsMiddleware,
  createSubAgentMiddleware,
  createSummarizationMiddleware
} from "deepagents"
import { join } from "path"
import { getAgentConfig } from "../preferences"
import type { getResolvedNativeExtensionPreferenceRecord } from "../preferences"
import { getOpenworkDir } from "../storage"
import { PrismaCheckpointSaver } from "../checkpointer/prisma-saver"
import { LocalSandbox } from "./local-sandbox"
import { createGuardrailMiddleware } from "./guardrail-middleware"
import { JustBashExecuteCommandClassifier } from "./execute-command-classifier"
import { createExecuteCommandGuardrailProvider } from "./execute-command-guardrail-provider"
import { JustBashMutationPredictor } from "./mutation-predictor"
import { createSubagentReadOnlyGuardrailMiddleware } from "./subagent-read-only-guardrail"
import { createSerializedToolCallMiddleware } from "./serialized-tool-call-middleware"
import { createToolApprovalMiddleware } from "./tool-approval-middleware"
import { anthropicPromptCachingMiddleware, createAgent, todoListMiddleware } from "langchain"
import { getChatModelInstance } from "../llm/get-chat-model"

import type * as _lcTypes from "langchain"
import type * as _lcMessages from "@langchain/core/messages"
import type * as _lcLanggraph from "@langchain/langgraph"
import type * as _lcZodTypes from "@langchain/core/utils/types"

import { BASE_SYSTEM_PROMPT } from "./system-prompt"
import { createArtifactToolsMiddleware } from "./artifact-tools-middleware"
import { createDesktopAutomationToolsMiddleware } from "./desktop-automation-tools-middleware"
import { createWebToolsMiddleware } from "./web-tools-middleware"
import { createTitleMiddleware } from "./title-middleware"
import { createBddAgentRuntime } from "./bdd-runtime"
import { nativeExtensionMainDefinitions } from "@extensions/main"
import { nativeExtensionManifests } from "@extensions/index"
import { createNativeExtensionToolRegistry } from "../extension-tools/native-extension-tools"
import { createExtensionAiRuntime } from "./extension-ai-runtime"
import { buildAgentRuntimeTraceConfig } from "../observability"
import type { PermissionModeName } from "@shared/permission-mode"
import { DEFAULT_PERMISSION_MODE } from "@shared/permission-mode"
import type { OpenworkMemoryContextPack, OpenworkWorkspaceIdentity } from "@shared/openwork-memory"
import {
  createOpenworkMemoryInclusionCollector,
  createOpenworkMemoryMiddleware,
  type OpenworkMemoryInclusionCollector
} from "../openwork-memory/middleware"
import type { OpenworkMemoryService } from "../openwork-memory/service"
import type {
  ExtensionAiCapabilityCatalogItem,
  ResolvedExtensionAiCapability
} from "@shared/extension-sources"
import type { LoadedExtensionAiCapabilitiesChange } from "./extension-ai-session"

/**
 * Generate the full system prompt for the agent.
 *
 * @param workspacePath - The workspace path the agent is operating in
 * @returns The complete system prompt
 */
function getSystemPrompt(workspacePath: string): string {
  const workingDirSection = `
### File System and Paths

**IMPORTANT - Path Handling:**
- All file paths use fully qualified absolute system paths
- The workspace root is: \`${workspacePath}\`
- Example: \`${workspacePath}/src/index.ts\`, \`${workspacePath}/README.md\`
- To list the workspace root, use \`ls("${workspacePath}")\`
- Always use full absolute paths for all file operations
`

  return workingDirSection + BASE_SYSTEM_PROMPT
}

// Per-thread checkpointer cache
const checkpointers = new Map<string, PrismaCheckpointSaver>()

export async function getCheckpointer(threadId: string): Promise<PrismaCheckpointSaver> {
  let checkpointer = checkpointers.get(threadId)
  if (!checkpointer) {
    checkpointer = new PrismaCheckpointSaver()
    await checkpointer.initialize()
    checkpointers.set(threadId, checkpointer)
  }
  return checkpointer
}

export async function closeCheckpointer(threadId: string): Promise<void> {
  const checkpointer = checkpointers.get(threadId)
  if (checkpointer) {
    await checkpointer.close()
    checkpointers.delete(threadId)
  }
}

function dedupePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((entry) => entry.trim()).filter((entry) => entry.length > 0)))
}

function getDefaultSkillSources(workspacePath: string): string[] {
  return [join(getOpenworkDir(), "skills"), join(workspacePath, ".openwork", "skills")]
}

export interface CreateAgentRuntimeOptions {
  /** Thread ID - REQUIRED for per-thread checkpointing */
  threadId: string
  /** Run ID - REQUIRED for memory suggestions and usage tracking */
  runId: string
  /** Model ID to use (defaults to configured default model) */
  modelId?: string
  /** Openwork memory context snapshot for this run. */
  openworkMemoryContextPack?: OpenworkMemoryContextPack | null
  /** Openwork memory service used by runtime tools. */
  openworkMemoryService?: OpenworkMemoryService
  /** Whether this run should bypass memory read/write behavior. */
  openworkMemoryTemporaryMode?: boolean
  /** Main-owned workspace identity used for workspace-scoped memory suggestions. */
  openworkMemoryWorkspaceIdentity?: OpenworkWorkspaceIdentity
  /** Permission mode snapshot for this run. */
  permissionMode?: PermissionModeName
  /** Resolved extension AI capabilities snapshot for this run. */
  aiCapabilities?: ResolvedExtensionAiCapability[]
  aiCapabilityCatalog?: ExtensionAiCapabilityCatalogItem[]
  getAiCapabilityByExtensionName?: (extensionName: string) => ResolvedExtensionAiCapability | null
  getExtensionPreferences?: typeof getResolvedNativeExtensionPreferenceRecord
  onLoadedAiCapabilitiesChanged?: (
    change: LoadedExtensionAiCapabilitiesChange
  ) => Promise<void> | void
  /** Workspace path - REQUIRED for agent to operate on files */
  workspacePath: string
}

// Create agent runtime with configured model and checkpointer
export type AgentRuntime = ReturnType<typeof createAgent>
export interface AgentRuntimeHandle {
  agent: AgentRuntime
  openworkMemoryInclusionCollector: OpenworkMemoryInclusionCollector
}
type SubagentMiddlewareStack = NonNullable<
  Parameters<typeof createSubAgentMiddleware>[0]["defaultMiddleware"]
>

export function runtimeUsesCheckpointPersistence(): boolean {
  return process.env.OPENWORK_BDD_AGENT_RUNTIME !== "scripted"
}

export async function createAgentRuntime(
  options: CreateAgentRuntimeOptions
): Promise<AgentRuntimeHandle> {
  const { threadId, runId, modelId, workspacePath } = options
  const permissionMode = options.permissionMode ?? DEFAULT_PERMISSION_MODE
  const aiCapabilities = options.aiCapabilities ?? []

  if (!threadId) {
    throw new Error("Thread ID is required for checkpointing.")
  }

  if (!runId) {
    throw new Error("Run ID is required for runtime memory tracking.")
  }

  if (!workspacePath) {
    throw new Error(
      "Workspace path is required. Please select a workspace folder before running the agent."
    )
  }

  console.log("[Runtime] Creating agent runtime...")
  console.log("[Runtime] Thread ID:", threadId)
  console.log("[Runtime] Workspace path:", workspacePath)

  if (!runtimeUsesCheckpointPersistence()) {
    return {
      agent: createBddAgentRuntime({ threadId, workspacePath }) as unknown as AgentRuntime,
      openworkMemoryInclusionCollector: createOpenworkMemoryInclusionCollector()
    }
  }

  const model = getChatModelInstance({ modelId, parallelToolCalls: false })
  console.log("[Runtime] Model instance created:", typeof model)

  const checkpointer = await getCheckpointer(threadId)
  console.log("[Runtime] Checkpointer ready for thread:", threadId)

  const backend = new LocalSandbox({
    rootDir: workspacePath,
    virtualMode: false, // Use absolute system paths for consistency with shell commands
    timeout: 120_000, // 2 minutes
    maxOutputBytes: 100_000 // ~100KB
  })
  const mutationPredictor = new JustBashMutationPredictor({
    workspacePath
  })
  const commandClassifier = new JustBashExecuteCommandClassifier()
  const guardrailProvider = createExecuteCommandGuardrailProvider({
    classifier: commandClassifier,
    predictor: mutationPredictor
  })
  const extensionAiRuntime = createExtensionAiRuntime({
    aiCapabilities,
    aiCapabilityCatalog: options.aiCapabilityCatalog,
    getAiCapabilityByExtensionName: options.getAiCapabilityByExtensionName,
    getExtensionPreferences: options.getExtensionPreferences,
    onLoadedAiCapabilitiesChanged: options.onLoadedAiCapabilitiesChanged,
    permissionMode,
    registry: createNativeExtensionToolRegistry({
      definitions: nativeExtensionMainDefinitions,
      manifests: nativeExtensionManifests
    }),
    threadId,
    workspacePath
  })

  const systemPrompt = getSystemPrompt(workspacePath)
  const agentConfig = getAgentConfig()
  const skillSources = dedupePaths([
    ...getDefaultSkillSources(workspacePath),
    ...agentConfig.skillSources
  ])

  console.log("[Runtime] Skill sources:", skillSources)
  console.log(
    "[Runtime] Openwork memory items:",
    options.openworkMemoryContextPack?.items.length ?? 0
  )

  // Custom filesystem prompt for absolute paths (matches virtualMode: false)
  const filesystemSystemPrompt = `You have access to a filesystem. All file paths use fully qualified absolute system paths.

- ls: list files in a directory (e.g., ls("${workspacePath}"))
- read_file: read a file from the filesystem
- write_file: write to a file in the filesystem
- edit_file: edit a file in the filesystem
- glob: find files matching a pattern (e.g., "**/*.py")
- grep: search for text within files

The workspace root is: ${workspacePath}`

  const openworkMemoryService = options.openworkMemoryService ?? null
  const useOpenworkMemory = openworkMemoryService !== null
  const allowOpenworkMemorySuggestions =
    useOpenworkMemory &&
    !options.openworkMemoryTemporaryMode &&
    openworkMemoryService.getSettings().useMemory === true
  const openworkMemoryWorkspaceIdentity =
    options.openworkMemoryContextPack?.workspaceIdentity ?? options.openworkMemoryWorkspaceIdentity
  const openworkMemoryInclusionCollector = createOpenworkMemoryInclusionCollector()
  const rootOpenworkMemoryRuntime = useOpenworkMemory
    ? createOpenworkMemoryMiddleware({
        allowSuggestions: allowOpenworkMemorySuggestions,
        collector: openworkMemoryInclusionCollector,
        contextPack: options.openworkMemoryContextPack ?? null,
        mode: "root",
        runId,
        service: openworkMemoryService,
        temporaryMode: false,
        threadId,
        workspaceIdentity: openworkMemoryWorkspaceIdentity ?? {
          canonicalWorkspacePath: workspacePath,
          displayName: workspacePath,
          workspaceKey: workspacePath
        }
      })
    : null

  function createSharedAgentLoopMiddleware() {
    return [
      todoListMiddleware(),
      createFilesystemMiddleware({
        backend,
        systemPrompt: filesystemSystemPrompt
      }),
      createArtifactToolsMiddleware({
        threadId,
        workspacePath
      }),
      createWebToolsMiddleware(),
      createSummarizationMiddleware({
        model,
        backend
      }),
      anthropicPromptCachingMiddleware({
        unsupportedModelBehavior: "ignore",
        minMessagesToCache: 1
      }),
      createPatchToolCallsMiddleware(),
      createSerializedToolCallMiddleware(),
      createSkillsMiddleware({
        backend,
        sources: skillSources
      })
    ] as const
  }

  function createRootAgentLoopMiddleware() {
    return [
      ...createSharedAgentLoopMiddleware(),
      ...(rootOpenworkMemoryRuntime ? [rootOpenworkMemoryRuntime.middleware] : []),
      createTitleMiddleware(),
      createDesktopAutomationToolsMiddleware(),
      extensionAiRuntime.middleware,
      createGuardrailMiddleware({
        provider: guardrailProvider,
        threadId,
        workspacePath
      }),
      createToolApprovalMiddleware({
        extensionToolPolicyProvider: extensionAiRuntime.approvalPolicyProvider,
        permissionMode
      })
    ] as const
  }

  function createSubagentAgentLoopMiddleware() {
    const subagentOpenworkMemoryRuntime = useOpenworkMemory
      ? createOpenworkMemoryMiddleware({
          allowSuggestions: false,
          collector: openworkMemoryInclusionCollector,
          contextPack: options.openworkMemoryContextPack ?? null,
          mode: "subagent",
          runId,
          service: openworkMemoryService,
          temporaryMode: false,
          threadId,
          workspaceIdentity: openworkMemoryWorkspaceIdentity ?? {
            canonicalWorkspacePath: workspacePath,
            displayName: workspacePath,
            workspaceKey: workspacePath
          }
        })
      : null

    return [
      ...createSharedAgentLoopMiddleware(),
      ...(subagentOpenworkMemoryRuntime ? [subagentOpenworkMemoryRuntime.middleware] : []),
      createSubagentReadOnlyGuardrailMiddleware({
        threadId,
        workspacePath
      })
    ] as const
  }

  const [rootTodoMiddleware, rootFilesystemMiddleware, ...rootAgentLoopTailMiddleware] =
    createRootAgentLoopMiddleware()

  function createSubagentMiddlewareStack(): SubagentMiddlewareStack {
    // createSubAgentMiddleware accepts the same runtime middleware stack, but its
    // input type is narrower than the concrete middleware instances we use here.
    return [...createSubagentAgentLoopMiddleware()] as unknown as SubagentMiddlewareStack
  }

  const agent = createAgent({
    model,
    name: "openwork",
    checkpointer,
    systemPrompt,
    middleware: [
      rootTodoMiddleware,
      rootFilesystemMiddleware,
      createSubAgentMiddleware({
        defaultModel: model,
        defaultMiddleware: createSubagentMiddlewareStack(),
        generalPurposeMiddleware: createSubagentMiddlewareStack()
      }),
      ...rootAgentLoopTailMiddleware
    ]
  }).withConfig({
    recursionLimit: 1e4,
    ...buildAgentRuntimeTraceConfig({
      aiCapabilities,
      modelId,
      permissionMode
    })
  })

  console.log("[Runtime] Agent created with subagent middleware at:", workspacePath)
  return {
    agent,
    openworkMemoryInclusionCollector
  }
}

export type DeepAgent = ReturnType<typeof createAgent>

// Clean up all checkpointer resources
export async function closeRuntime(): Promise<void> {
  const closePromises = Array.from(checkpointers.values()).map((cp) => cp.close())
  await Promise.all(closePromises)
  checkpointers.clear()
}
