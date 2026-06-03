import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import type {
  CustomProviderConfig,
  CustomProviderEngine,
  CustomProviderInput,
  ModelConfig,
  ProviderDefinition,
  ProviderId
} from "./types"
import { getJingleCustomProvidersDir } from "./paths"
import { getDeclarativeProviderConfig } from "./declarative-providers"
import { modelSupportsReasoning } from "./model-metadata"
import { setProviderCredential } from "./auth-store"

const CUSTOM_PROVIDER_PREFIX = "custom_"
const API_KEY_CREDENTIAL_VARIABLE = "apiKey"
const RESERVED_PROVIDER_IDS = new Set([
  "anthropic",
  "codex",
  "custom_deepseek",
  "custom_tensorix",
  "dashscope",
  "deepseek",
  "google",
  "local",
  "openai"
])

export function listCustomProviderConfigs(): CustomProviderConfig[] {
  const dir = getJingleCustomProvidersDir()
  if (!existsSync(dir)) {
    return []
  }

  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => {
      const providerId = entry.slice(0, -".json".length)
      const config = normalizeCustomProviderConfig(
        JSON.parse(readFileSync(join(dir, entry), "utf8"))
      )
      if (config.name !== providerId) {
        throw new Error(
          `Custom provider file name does not match provider id: ${entry} -> ${config.name}`
        )
      }

      if (isReservedProviderId(config.name)) {
        throw new Error(`Custom provider id conflicts with a built-in provider: ${config.name}`)
      }

      return config
    })
}

export function listCustomProviderDefinitions(): ProviderDefinition[] {
  return listCustomProviderConfigs().map((provider) => ({
    configurateMethods: provider.models.length > 0 ? ["customizable-model"] : ["fetch-from-remote"],
    credentialFormSchemas:
      provider.requires_auth === false ? [] : [customProviderApiKeyCredential(provider)],
    description: toLocalizedText(
      provider.description ?? `Custom ${provider.display_name} provider.`
    ),
    id: provider.name,
    label: toLocalizedText(provider.display_name),
    name: provider.display_name,
    source: "custom",
    supportedModelTypes: ["llm"]
  }))
}

export function getCustomProviderConfig(providerId: ProviderId): CustomProviderConfig | null {
  return listCustomProviderConfigs().find((provider) => provider.name === providerId) ?? null
}

export function listCustomProviderModels(): ModelConfig[] {
  return listCustomProviderConfigs().flatMap((provider) =>
    provider.models.map((model) => ({
      description: provider.description,
      contextLimit: model.context_limit,
      fetchFrom: "customizable-model" as const,
      id: `${provider.name}:${model.name}`,
      model: model.name,
      modelType: "llm" as const,
      name: model.name,
      provider: provider.name,
      reasoning: model.reasoning ?? modelSupportsReasoning(model.name),
      status: "active" as const
    }))
  )
}

export function upsertCustomProvider(input: CustomProviderInput): CustomProviderConfig {
  const existingConfig = input.providerId ? getCustomProviderConfig(input.providerId) : null
  if (input.providerId && !existingConfig) {
    throw new Error(`Custom provider is not configured: ${input.providerId}`)
  }

  const providerId = existingConfig?.name ?? generateCustomProviderId(input.displayName)
  if (!existingConfig && isReservedProviderId(providerId)) {
    throw new Error(`Custom provider id conflicts with a built-in provider: ${providerId}`)
  }
  const apiKeyEnv = existingConfig?.api_key_env ?? `${providerId.toUpperCase()}_API_KEY`
  const config: CustomProviderConfig = {
    api_key_env: apiKeyEnv,
    base_path: normalizeOptionalString(input.basePath),
    base_url: normalizeOptionalString(input.baseUrl),
    description:
      normalizeOptionalString(input.description) ?? `Custom ${input.displayName} provider.`,
    display_name: input.displayName.trim(),
    engine: input.engine,
    headers: input.headers ?? {},
    models: input.models.map((model) => ({ name: model.trim() })).filter((model) => model.name),
    name: providerId,
    requires_auth: input.requiresAuth,
    setup_steps: [],
    supports_streaming: input.supportsStreaming,
    timeout_seconds: null
  }

  if (config.models.length === 0) {
    throw new Error("Custom provider needs at least one model.")
  }

  writeCustomProviderConfig(config)

  const apiKey = input.apiKey?.trim()
  if (apiKey) {
    setProviderCredential(config.name, API_KEY_CREDENTIAL_VARIABLE, apiKey)
  }

  return config
}

export function deleteCustomProvider(providerId: ProviderId): void {
  const config = getCustomProviderConfig(providerId)
  if (!config) {
    return
  }

  rmSync(getCustomProviderPath(config.name), { force: true })
}

function writeCustomProviderConfig(config: CustomProviderConfig): void {
  writeFileSync(getCustomProviderPath(config.name), `${JSON.stringify(config, null, 2)}\n`, "utf8")
}

function getCustomProviderPath(providerId: ProviderId): string {
  return join(getJingleCustomProvidersDir(), `${providerId}.json`)
}

function isReservedProviderId(providerId: ProviderId): boolean {
  return RESERVED_PROVIDER_IDS.has(providerId) || getDeclarativeProviderConfig(providerId) !== null
}

function normalizeCustomProviderConfig(value: unknown): CustomProviderConfig {
  if (!isRecord(value)) {
    throw new Error("Custom provider config must be an object.")
  }

  const name = requireString(value, "name")
  const displayName = requireString(value, "display_name")
  const engine = requireEngine(value["engine"])
  const rawModels = value["models"]
  if (!Array.isArray(rawModels)) {
    throw new Error(`Custom provider ${name} models must be an array.`)
  }

  return {
    api_key_env: getString(value, "api_key_env"),
    base_path: getNullableString(value, "base_path"),
    base_url: getNullableString(value, "base_url"),
    description: getString(value, "description"),
    display_name: displayName,
    engine,
    headers: normalizeStringRecord(value["headers"]),
    model_doc_link: getNullableString(value, "model_doc_link"),
    models: rawModels.map(normalizeCustomProviderModel),
    name,
    requires_auth: typeof value["requires_auth"] === "boolean" ? value["requires_auth"] : true,
    setup_steps: normalizeStringArray(value["setup_steps"]),
    supports_streaming:
      typeof value["supports_streaming"] === "boolean" ? value["supports_streaming"] : true,
    timeout_seconds: typeof value["timeout_seconds"] === "number" ? value["timeout_seconds"] : null
  }
}

function normalizeCustomProviderModel(value: unknown): CustomProviderConfig["models"][number] {
  if (typeof value === "string") {
    return { name: value }
  }

  if (!isRecord(value)) {
    throw new Error("Custom provider model must be an object or string.")
  }

  return {
    context_limit: typeof value["context_limit"] === "number" ? value["context_limit"] : undefined,
    name: requireString(value, "name"),
    reasoning: typeof value["reasoning"] === "boolean" ? value["reasoning"] : undefined
  }
}

function customProviderApiKeyCredential(
  provider: CustomProviderConfig
): ProviderDefinition["credentialFormSchemas"][number] {
  return {
    label: toLocalizedText("API Key"),
    name: "API Key",
    placeholder: toLocalizedText(provider.api_key_env ?? "API key"),
    required: true,
    type: "secret-input",
    variable: API_KEY_CREDENTIAL_VARIABLE
  }
}

function generateCustomProviderId(displayName: string): string {
  const normalized = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

  if (!normalized) {
    throw new Error("Custom provider display name is required.")
  }

  return normalized.startsWith(CUSTOM_PROVIDER_PREFIX)
    ? normalized
    : `${CUSTOM_PROVIDER_PREFIX}${normalized}`
}

function requireEngine(value: unknown): CustomProviderEngine {
  if (value === "openai" || value === "anthropic" || value === "ollama") {
    return value
  }

  throw new Error(`Custom provider engine is not supported: ${String(value)}`)
}

function normalizeOptionalString(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Custom provider field is required: ${key}`)
  }

  return value.trim()
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function getNullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => {
      const [key, recordValue] = entry
      return typeof key === "string" && typeof recordValue === "string"
    })
  )
}

function toLocalizedText(text: string): { en_US: string; zh_Hans: string } {
  return {
    en_US: text,
    zh_Hans: text
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
