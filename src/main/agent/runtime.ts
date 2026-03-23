/* eslint-disable @typescript-eslint/no-unused-vars */
import { createDeepAgent } from "deepagents"
import { getDefaultModel, getModelConfig } from "../ipc/models"
import { getApiKey } from "../storage"
import { ChatAnthropic } from "@langchain/anthropic"
import { ChatOpenAI } from "@langchain/openai"
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import { PrismaCheckpointSaver } from "../checkpointer/prisma-saver"
import { LocalSandbox } from "./local-sandbox"
import { createExecuteApprovalMiddleware } from "./execute-approval-middleware"

import type * as _lcTypes from "langchain"
import type * as _lcMessages from "@langchain/core/messages"
import type * as _lcLanggraph from "@langchain/langgraph"
import type * as _lcZodTypes from "@langchain/core/utils/types"
import type { ProviderId } from "../types"

import { BASE_SYSTEM_PROMPT } from "./system-prompt"

const DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"

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

// Get the appropriate model instance based on configuration
function getModelInstance(
  modelId?: string
): ChatAnthropic | ChatOpenAI | ChatGoogleGenerativeAI | string {
  const resolvedModelId = modelId || getDefaultModel()
  const configuredModel = getModelConfig(resolvedModelId)
  const model = configuredModel?.model ?? resolvedModelId
  const provider = configuredModel?.provider ?? inferProviderFromModelId(resolvedModelId)
  console.log("[Runtime] Using model:", resolvedModelId)

  if (provider === "anthropic") {
    const apiKey = getApiKey("anthropic")
    console.log("[Runtime] Anthropic API key present:", !!apiKey)
    if (!apiKey) {
      throw new Error("Anthropic API key not configured")
    }
    return new ChatAnthropic({
      model,
      anthropicApiKey: apiKey
    })
  } else if (provider === "openai") {
    const apiKey = getApiKey("openai")
    console.log("[Runtime] OpenAI API key present:", !!apiKey)
    if (!apiKey) {
      throw new Error("OpenAI API key not configured")
    }
    return new ChatOpenAI({
      model,
      apiKey
    })
  } else if (provider === "dashscope") {
    const apiKey = getApiKey("dashscope")
    console.log("[Runtime] DashScope API key present:", !!apiKey)
    if (!apiKey) {
      throw new Error("DashScope API key not configured")
    }
    return new ChatOpenAI({
      model,
      apiKey,
      configuration: {
        baseURL: DASHSCOPE_BASE_URL
      }
    })
  } else if (provider === "google") {
    const apiKey = getApiKey("google")
    console.log("[Runtime] Google API key present:", !!apiKey)
    if (!apiKey) {
      throw new Error("Google API key not configured")
    }
    return new ChatGoogleGenerativeAI({
      model,
      apiKey: apiKey
    })
  }

  // Default to model string (let deepagents handle it)
  return model
}

function inferProviderFromModelId(modelId: string): ProviderId | undefined {
  if (modelId.startsWith("claude")) {
    return "anthropic"
  }

  if (
    modelId.startsWith("gpt") ||
    modelId.startsWith("o1") ||
    modelId.startsWith("o3") ||
    modelId.startsWith("o4")
  ) {
    return "openai"
  }

  if (
    modelId.startsWith("glm") ||
    modelId.startsWith("qwen") ||
    modelId.startsWith("deepseek") ||
    modelId.startsWith("qwq")
  ) {
    return "dashscope"
  }

  if (modelId.startsWith("gemini")) {
    return "google"
  }

  return undefined
}

export interface CreateAgentRuntimeOptions {
  /** Thread ID - REQUIRED for per-thread checkpointing */
  threadId: string
  /** Model ID to use (defaults to configured default model) */
  modelId?: string
  /** Workspace path - REQUIRED for agent to operate on files */
  workspacePath: string
}

// Create agent runtime with configured model and checkpointer
export type AgentRuntime = ReturnType<typeof createDeepAgent>

export async function createAgentRuntime(options: CreateAgentRuntimeOptions) {
  const { threadId, modelId, workspacePath } = options

  if (!threadId) {
    throw new Error("Thread ID is required for checkpointing.")
  }

  if (!workspacePath) {
    throw new Error(
      "Workspace path is required. Please select a workspace folder before running the agent."
    )
  }

  console.log("[Runtime] Creating agent runtime...")
  console.log("[Runtime] Thread ID:", threadId)
  console.log("[Runtime] Workspace path:", workspacePath)

  const model = getModelInstance(modelId)
  console.log("[Runtime] Model instance created:", typeof model)

  const checkpointer = await getCheckpointer(threadId)
  console.log("[Runtime] Checkpointer ready for thread:", threadId)

  const backend = new LocalSandbox({
    rootDir: workspacePath,
    virtualMode: false, // Use absolute system paths for consistency with shell commands
    timeout: 120_000, // 2 minutes
    maxOutputBytes: 100_000 // ~100KB
  })

  const systemPrompt = getSystemPrompt(workspacePath)

  // Custom filesystem prompt for absolute paths (matches virtualMode: false)
  const filesystemSystemPrompt = `You have access to a filesystem. All file paths use fully qualified absolute system paths.

- ls: list files in a directory (e.g., ls("${workspacePath}"))
- read_file: read a file from the filesystem
- write_file: write to a file in the filesystem
- edit_file: edit a file in the filesystem
- glob: find files matching a pattern (e.g., "**/*.py")
- grep: search for text within files

The workspace root is: ${workspacePath}`

  const agent = createDeepAgent({
    model,
    checkpointer,
    backend,
    systemPrompt,
    // Custom filesystem prompt for absolute paths (requires deepagents update)
    filesystemSystemPrompt,
    // Intercept execute right before the tool runs so the approval payload
    // carries the real tool_call.id from the source.
    middleware: [createExecuteApprovalMiddleware()]
  } as Parameters<typeof createDeepAgent>[0])

  console.log("[Runtime] Deep agent created with LocalSandbox at:", workspacePath)
  return agent
}

export type DeepAgent = ReturnType<typeof createDeepAgent>

// Clean up all checkpointer resources
export async function closeRuntime(): Promise<void> {
  const closePromises = Array.from(checkpointers.values()).map((cp) => cp.close())
  await Promise.all(closePromises)
  checkpointers.clear()
}
