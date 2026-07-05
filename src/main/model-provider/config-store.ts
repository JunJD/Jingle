import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { dirname } from "path"
import { DEFAULT_MODELS } from "@shared/models"
import { getJingleModelConfigPath } from "./paths"
import type {
  DefaultModelOptions,
  DefaultModels,
  ProviderId,
  SetDefaultModelOptions,
  SupportedDefaultModelType,
  ThinkingEffort
} from "./types"

export interface StoredProviderConfig {
  configured: boolean
  enabled: boolean
  model: string
  thinkingEffort?: ThinkingEffort | null
}

export interface JingleModelProviderConfig {
  activeProvider: ProviderId | null
  providers: Record<ProviderId, StoredProviderConfig>
}

const DEFAULT_CONFIG: JingleModelProviderConfig = {
  activeProvider: null,
  providers: {}
}

export function getJingleModelProviderConfig(): JingleModelProviderConfig {
  const path = getJingleModelConfigPath()
  if (!existsSync(path)) {
    return { ...DEFAULT_CONFIG, providers: {} }
  }

  return parseJingleConfig(readFileSync(path, "utf8"))
}

export function getActiveProviderId(): ProviderId | null {
  return getJingleModelProviderConfig().activeProvider
}

export function getModelProviderDefaultModels(): DefaultModels {
  const config = getJingleModelProviderConfig()
  const activeProvider = config.activeProvider
  const activeProviderConfig = activeProvider ? config.providers[activeProvider] : null

  return {
    llm:
      activeProvider && activeProviderConfig
        ? `${activeProvider}:${activeProviderConfig.model}`
        : DEFAULT_MODELS.llm
  }
}

export function getModelProviderDefaultModelOptions(): DefaultModelOptions {
  const config = getJingleModelProviderConfig()
  const activeProvider = config.activeProvider
  const activeProviderConfig = activeProvider ? config.providers[activeProvider] : null

  return {
    llm: {
      thinkingEffort: activeProviderConfig?.thinkingEffort ?? null
    }
  }
}

export function getModelProviderDefaultModel(modelType: SupportedDefaultModelType): string {
  return getModelProviderDefaultModels()[modelType]
}

export function setModelProviderDefaultModel(
  modelType: SupportedDefaultModelType,
  modelId: string,
  options: SetDefaultModelOptions = {}
): void {
  if (modelType !== "llm") {
    throw new Error(`Model type is not supported: ${modelType}`)
  }

  const separatorIndex = modelId.indexOf(":")
  if (separatorIndex <= 0 || separatorIndex === modelId.length - 1) {
    throw new Error(`Model id must be provider-scoped: ${modelId}`)
  }

  setActiveModelProvider(
    modelId.slice(0, separatorIndex),
    modelId.slice(separatorIndex + 1),
    options
  )
}

export function setActiveModelProvider(
  providerId: ProviderId,
  modelName: string,
  options: SetDefaultModelOptions = {}
): void {
  const config = getJingleModelProviderConfig()
  const currentProvider = config.providers[providerId]
  const thinkingEffort =
    options.thinkingEffort === undefined
      ? (currentProvider?.thinkingEffort ?? null)
      : options.thinkingEffort

  writeJingleModelProviderConfig({
    activeProvider: providerId,
    providers: {
      ...config.providers,
      [providerId]: {
        configured: currentProvider?.configured ?? true,
        enabled: true,
        model: modelName,
        thinkingEffort
      }
    }
  })
}

export function markProviderConfigured(providerId: ProviderId, modelName?: string): void {
  const config = getJingleModelProviderConfig()
  const currentProvider = config.providers[providerId]

  writeJingleModelProviderConfig({
    activeProvider: config.activeProvider ?? providerId,
    providers: {
      ...config.providers,
      [providerId]: {
        configured: true,
        enabled: true,
        model: modelName ?? currentProvider?.model ?? "",
        thinkingEffort: currentProvider?.thinkingEffort ?? null
      }
    }
  })
}

export function markProviderUnconfigured(providerId: ProviderId): void {
  const config = getJingleModelProviderConfig()
  const currentProvider = config.providers[providerId]
  if (!currentProvider) {
    return
  }

  const providers = {
    ...config.providers,
    [providerId]: {
      ...currentProvider,
      configured: false
    }
  }

  writeJingleModelProviderConfig({
    activeProvider: config.activeProvider === providerId ? null : config.activeProvider,
    providers
  })
}

export function writeJingleModelProviderConfig(config: JingleModelProviderConfig): void {
  const path = getJingleModelConfigPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, serializeJingleConfig(config), "utf8")
}

function parseJingleConfig(content: string): JingleModelProviderConfig {
  const config: JingleModelProviderConfig = { activeProvider: null, providers: {} }
  const lines = content.split(/\r?\n/)
  let section: "root" | "providers" | "provider" = "root"
  let currentProvider: string | null = null

  for (const line of lines) {
    const withoutComment = line.split("#", 1)[0] ?? ""
    if (!withoutComment.trim()) {
      continue
    }

    const indent = withoutComment.match(/^\s*/)?.[0].length ?? 0
    const trimmed = withoutComment.trim()
    const keyValue = parseKeyValue(trimmed)

    if (indent === 0 && keyValue?.key === "active_provider") {
      config.activeProvider = parseNullableString(keyValue.value)
      section = "root"
      currentProvider = null
      continue
    }

    if (indent === 0 && trimmed === "providers:") {
      section = "providers"
      currentProvider = null
      continue
    }

    if (
      (section === "providers" || section === "provider") &&
      indent === 2 &&
      trimmed.endsWith(":")
    ) {
      currentProvider = trimmed.slice(0, -1).trim()
      config.providers[currentProvider] = {
        configured: false,
        enabled: false,
        model: ""
      }
      section = "provider"
      continue
    }

    if (section === "provider" && currentProvider && indent === 4 && keyValue) {
      const provider = config.providers[currentProvider]
      if (!provider) {
        continue
      }

      if (keyValue.key === "enabled") {
        provider.enabled = parseBoolean(keyValue.value)
      } else if (keyValue.key === "configured") {
        provider.configured = parseBoolean(keyValue.value)
      } else if (keyValue.key === "model") {
        provider.model = parseString(keyValue.value)
      } else if (keyValue.key === "thinking_effort") {
        provider.thinkingEffort = parseThinkingEffort(keyValue.value)
      }
    }
  }

  return config
}

function serializeJingleConfig(config: JingleModelProviderConfig): string {
  const lines = [`active_provider: ${formatNullableString(config.activeProvider)}`, "providers:"]

  const providerEntries = Object.entries(config.providers).sort(([left], [right]) =>
    left.localeCompare(right)
  )

  for (const [providerId, provider] of providerEntries) {
    lines.push(`  ${providerId}:`)
    lines.push(`    enabled: ${provider.enabled ? "true" : "false"}`)
    lines.push(`    model: ${formatString(provider.model)}`)
    lines.push(`    configured: ${provider.configured ? "true" : "false"}`)
    lines.push(`    thinking_effort: ${formatNullableString(provider.thinkingEffort ?? null)}`)
  }

  lines.push("")
  return lines.join("\n")
}

function parseKeyValue(line: string): { key: string; value: string } | null {
  const separatorIndex = line.indexOf(":")
  if (separatorIndex <= 0) {
    return null
  }

  return {
    key: line.slice(0, separatorIndex).trim(),
    value: line.slice(separatorIndex + 1).trim()
  }
}

function parseNullableString(value: string): string | null {
  const parsed = parseString(value)
  return parsed === "" || parsed === "null" ? null : parsed
}

function parseString(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function parseBoolean(value: string): boolean {
  return value.trim() === "true"
}

function parseThinkingEffort(value: string): ThinkingEffort | null {
  const parsed = parseNullableString(value)
  if (
    parsed === "off" ||
    parsed === "low" ||
    parsed === "medium" ||
    parsed === "high" ||
    parsed === "max"
  ) {
    return parsed
  }

  return null
}

function formatNullableString(value: string | null): string {
  return value ? formatString(value) : "null"
}

function formatString(value: string): string {
  if (/^[A-Za-z0-9_.-]+$/.test(value)) {
    return value
  }

  return JSON.stringify(value)
}
