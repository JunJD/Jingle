import { existsSync, readFileSync } from "fs"
import type { ModelConfig, ProviderDefinition } from "./types"
import { getJingleModelRegistryPath } from "./paths"
import { modelSupportsReasoning } from "./model-metadata"

const LOCAL_PROVIDER_ID = "local"

export function listRegistryProviderDefinitions(): ProviderDefinition[] {
  const models = listRegistryModels()
  if (models.length === 0) {
    return []
  }

  return [
    {
      configurateMethods: ["customizable-model"],
      credentialFormSchemas: [],
      description: {
        en_US: "Local models registered under ~/.local/share/jingle/models/registry.json.",
        zh_Hans: "注册在 ~/.local/share/jingle/models/registry.json 的本地模型。"
      },
      id: LOCAL_PROVIDER_ID,
      label: {
        en_US: "Local Models",
        zh_Hans: "本地模型"
      },
      name: "Local Models",
      source: "registry",
      supportedModelTypes: ["llm"]
    }
  ]
}

export function listRegistryModels(): ModelConfig[] {
  const path = getJingleModelRegistryPath()
  if (!existsSync(path)) {
    return []
  }

  const registry = JSON.parse(readFileSync(path, "utf8")) as unknown
  const models = readRegistryModels(registry)

  return models.map((model) => ({
    description: model.description,
    fetchFrom: "customizable-model",
    id: `${LOCAL_PROVIDER_ID}:${model.name}`,
    model: model.name,
    modelType: "llm",
    name: model.displayName ?? model.name,
    provider: LOCAL_PROVIDER_ID,
    reasoning: model.reasoning ?? modelSupportsReasoning(model.name),
    status: "active"
  }))
}

function readRegistryModels(value: unknown): Array<{
  description?: string
  displayName?: string
  name: string
  reasoning?: boolean
}> {
  if (!isRecord(value) || !Array.isArray(value["models"])) {
    return []
  }

  return value["models"].flatMap((entry) => {
    if (typeof entry === "string") {
      return [{ name: entry }]
    }

    if (!isRecord(entry)) {
      return []
    }

    const name = getFirstString(entry, ["name", "id", "model"])
    if (!name) {
      return []
    }

    return [
      {
        description: getFirstString(entry, ["description"]),
        displayName: getFirstString(entry, ["display_name", "displayName", "label"]),
        name,
        reasoning: typeof entry["reasoning"] === "boolean" ? entry["reasoning"] : undefined
      }
    ]
  })
}

function getFirstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }

  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
