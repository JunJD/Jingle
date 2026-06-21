import type { ToolCall as LangChainToolCall } from "@langchain/core/messages"
import type { AppLocale, LocalizedText } from "./i18n"
import type { HITLRequest } from "./hitl"
import type { ArtifactRecord } from "./artifacts"
import type { ExtensionToolCallPresentation, ToolCallDisplay } from "./tool-presentation"
import type { ThreadWorkspaceKind } from "./thread-workspace"
import type { AgentContextInclusion } from "./openwork-memory"
export type { LocalizedText } from "./i18n"
export type { HITLDecision, HITLRequest } from "./hitl"

export type ThreadStatus = "idle" | "busy" | "interrupted" | "error"

export interface Thread {
  thread_id: string
  created_at: Date
  updated_at: Date
  archived_at?: Date | null
  metadata?: Record<string, unknown>
  status: ThreadStatus
  thread_values?: Record<string, unknown>
  title?: string
}

export interface CreateThreadInput {
  metadata?: Record<string, unknown>
  workspaceKind?: ThreadWorkspaceKind
  workspacePath?: string
}

export type RunStatus = "pending" | "running" | "error" | "success" | "interrupted"

export interface Run {
  run_id: string
  thread_id: string
  assistant_id?: string
  created_at: Date
  updated_at: Date
  status: RunStatus
  metadata?: Record<string, unknown>
}

export type ProviderId = string

export type ModelType = "llm" | "text-embedding" | "rerank" | "speech2text" | "moderation" | "tts"

export type SupportedDefaultModelType = "llm"

export type ConfigurationMethod = "predefined-model" | "customizable-model" | "fetch-from-remote"

export type ModelFeature =
  | "tool-call"
  | "multi-tool-call"
  | "vision"
  | "video"
  | "document"
  | "audio"
  | "structured-output"

export type ModelStatus =
  | "active"
  | "no-configure"
  | "quota-exceeded"
  | "no-permission"
  | "disabled"
  | "credential-removed"

export type ProviderModelListStatus = "active" | "error" | "no-configure"

export type CustomConfigurationStatus = "active" | "no-configure"

export type CredentialFormType = "secret-input" | "text-input"

export interface CredentialFormSchema {
  label: LocalizedText
  name: string
  placeholder?: LocalizedText
  required: boolean
  tooltip?: LocalizedText
  type: CredentialFormType
  variable: string
}

export interface ModelProviderCredentialSchema {
  credentialFormSchemas: CredentialFormSchema[]
}

export interface ModelProviderCustomConfiguration {
  currentCredentialName?: string
  message?: string
  status: CustomConfigurationStatus
}

export interface ModelProviderSystemConfiguration {
  enabled: boolean
}

export interface DefaultModels {
  llm: string
}

export type ThinkingEffort = "off" | "low" | "medium" | "high" | "max"

export interface ModelSelectionOptions {
  thinkingEffort?: ThinkingEffort | null
}

export interface DefaultModelOptions {
  llm: ModelSelectionOptions
}

export interface SetDefaultModelOptions extends ModelSelectionOptions {
  allowUnlisted?: boolean
}

export interface Provider {
  configurateMethods: ConfigurationMethod[]
  customConfiguration: ModelProviderCustomConfiguration
  description?: LocalizedText
  id: ProviderId
  label: LocalizedText
  modelListError?: string
  modelListStatus: ProviderModelListStatus
  name: string
  providerCredentialSchema: ModelProviderCredentialSchema
  supportedModelTypes: ModelType[]
  systemConfiguration: ModelProviderSystemConfiguration
  source?: "builtin" | "custom" | "declarative" | "registry"
}

export interface ModelConfig {
  contextLimit?: number
  description?: string
  fetchFrom: ConfigurationMethod
  features?: ModelFeature[]
  id: string
  maxOutputTokens?: number
  model: string
  modelType: ModelType
  name: string
  provider: ProviderId
  reasoning?: boolean
  status: ModelStatus
}

export interface ProviderModelsResponse {
  models: ModelConfig[]
  provider: Provider
}

export interface ModelProviderState {
  activeProviderId: ProviderId | null
  defaultModelOptions: DefaultModelOptions
  defaultModels: DefaultModels
  providers: Provider[]
}

export type CustomProviderEngine = "openai" | "anthropic" | "ollama"

export interface CustomProviderModel {
  context_limit?: number
  max_output_tokens?: number
  name: string
  reasoning?: boolean
}

export interface CustomProviderConfig {
  api_key_env?: string
  base_path?: string | null
  base_url?: string | null
  description?: string
  display_name: string
  dynamic_models?: boolean
  engine: CustomProviderEngine
  env_vars?: Array<{
    default?: string
    description?: string
    name: string
    primary?: boolean
    required?: boolean
    secret?: boolean
  }>
  fast_model?: string | null
  headers?: Record<string, string>
  model_doc_link?: string | null
  models: CustomProviderModel[]
  name: string
  requires_auth?: boolean
  setup_steps?: string[]
  supports_streaming?: boolean
  timeout_seconds?: number | null
}

export interface CustomProviderInput {
  apiKey?: string
  basePath?: string
  baseUrl?: string
  description?: string
  displayName: string
  engine: CustomProviderEngine
  headers?: Record<string, string>
  models: string[]
  providerId?: ProviderId
  requiresAuth: boolean
  supportsStreaming: boolean
}

export interface ModelProviderPaths {
  authPath: string
  configPath: string
  customProvidersDir: string
  modelRegistryPath: string
}

export interface AgentConfig {
  desktopAutomationAllowlist: string[]
  skillSources: string[]
  locale: AppLocale
}

export interface Subagent {
  id: string
  name: string
  description: string
  status: "pending" | "running" | "completed" | "failed"
  startedAt?: Date
  completedAt?: Date
  toolCallId?: string
  subagentType?: string
}

export type StreamEvent =
  | { type: "message"; message: Message }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "tool_result"; toolResult: ToolResult }
  | { type: "interrupt"; request: HITLRequest }
  | { type: "token"; token: string }
  | { type: "todos"; todos: Todo[] }
  | { type: "subagents"; subagents: Subagent[] }
  | { type: "done"; result: unknown }
  | { type: "error"; error: string }

export interface Message {
  id: string
  role: "user" | "assistant" | "system" | "tool"
  content: string | ContentBlock[]
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
  metadata?: Record<string, unknown>
  created_at: Date
}

export interface ContentBlock {
  type: "text" | "reasoning" | "image" | "image_url" | "file" | "tool_use" | "tool_result"
  text?: string
  reasoning?: string
  signature?: string
  tool_use_id?: string
  name?: string
  input?: unknown
  content?: string
  image_url?: string | { detail?: "auto" | "high" | "low"; url: string }
  mimeType?: string
}

export interface ToolCall extends LangChainToolCall<string, Record<string, unknown>> {
  display?: ToolCallDisplay
  id: string
  presentation?: ExtensionToolCallPresentation
}

export interface ToolResult {
  tool_call_id: string
  content: string | unknown
}

export interface AgentThreadMessagesSnapshot {
  artifacts: ArtifactRecord[]
  messages: Message[]
}

export interface AgentThreadInfoSnapshot {
  metadata?: Record<string, unknown>
  status: ThreadStatus
  thread_id: string
  title?: string
}

export interface AgentThreadRunStateSnapshot {
  contextInclusions: AgentContextInclusion[]
  error: string | null
  forkState: ThreadForkState
  pendingApproval: HITLRequest | null
  runId: string | null
  todos: Todo[]
  workspacePath: string | null
}

export interface AgentThreadDataSnapshot {
  thread: AgentThreadInfoSnapshot
  messages: AgentThreadMessagesSnapshot
  runState: AgentThreadRunStateSnapshot
}

export type ThreadForkBlockReason = "busy" | "checkpoint_interrupt" | "pending_hitl"

export interface ThreadForkState {
  canFork: boolean
  reason?: ThreadForkBlockReason
}

export interface Todo {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
}

export interface FileInfo {
  path: string
  is_dir?: boolean
  size?: number
  modified_at?: string
}

export interface GrepMatch {
  path: string
  line: number
  text: string
}
