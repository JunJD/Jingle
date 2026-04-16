import type { ModelConfig, ProviderId } from "./types"
import { getModelConfig, listModelCatalog, toProviderModelId } from "./catalog"

export type RemoteModel = {
  description?: string
  displayName?: string
  id: string
}

const GOOGLE_API_VERSION = "v1beta"
const MODEL_LIST_REQUEST_TIMEOUT_MS = 10_000

export function listCatalogModelsByProvider(
  providerId: ProviderId,
  status: ModelConfig["status"]
): ModelConfig[] {
  return listModelCatalog()
    .filter((model) => model.provider === providerId)
    .map((model) => ({
      ...model,
      status
    }))
}

export function toRemoteModelConfigs(
  providerId: ProviderId,
  remoteModels: RemoteModel[],
  isSupportedModel: (modelId: string) => boolean
): ModelConfig[] {
  const supportedModels = remoteModels
    .filter((model) => isSupportedModel(model.id))
    .map((model) => toModelConfig(providerId, model))

  if (supportedModels.length === 0) {
    throw new Error(`${providerId} models list returned no supported chat models`)
  }

  return supportedModels
}

export async function fetchOpenAICompatibleModels(
  providerId: ProviderId,
  baseUrl: string | undefined,
  apiKey: string
): Promise<RemoteModel[]> {
  const apiBaseUrl = baseUrl || getDefaultOpenAICompatibleBaseUrl(providerId)
  const url = `${apiBaseUrl}/models`

  const payload = await requestJson(providerId, url, {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  })
  const data = getArrayField(payload, "data", providerId)

  return data.map((item) => {
    const record = requireRecord(item, providerId)
    return { id: requireStringField(record, "id", providerId) }
  })
}

function getDefaultOpenAICompatibleBaseUrl(providerId: ProviderId): string {
  switch (providerId) {
    case "openai":
      return "https://api.openai.com/v1"
    case "dashscope":
      return "https://dashscope.aliyuncs.com/compatible-mode/v1"
    case "kimi":
      return "https://api.moonshot.cn/v1"
    default:
      throw new Error(`No default base URL for provider: ${providerId}`)
  }
}

export async function fetchAnthropicModels(apiKey: string, baseUrl?: string): Promise<RemoteModel[]> {
  const result: RemoteModel[] = []
  let afterId: string | null = null
  const apiBaseUrl = baseUrl || "https://api.anthropic.com"

  do {
    const searchParams = new URLSearchParams({ limit: "1000" })
    if (afterId) {
      searchParams.set("after_id", afterId)
    }

    const payload = await requestJson(
      "anthropic",
      `${joinUrl(apiBaseUrl, "/v1/models")}?${searchParams}`,
      {
        headers: {
          "anthropic-version": "2023-06-01",
          "x-api-key": apiKey
        }
      }
    )
    const data = getArrayField(payload, "data", "anthropic")
    result.push(
      ...data.map((item) => {
        const record = requireRecord(item, "anthropic")
        return {
          displayName: getStringField(record, "display_name"),
          id: requireStringField(record, "id", "anthropic")
        }
      })
    )

    const payloadRecord = requireRecord(payload, "anthropic")
    const hasMore = payloadRecord["has_more"] === true
    afterId = hasMore ? requireStringField(payloadRecord, "last_id", "anthropic") : null
  } while (afterId)

  return result
}

export async function fetchGoogleModels(apiKey: string, baseUrl?: string): Promise<RemoteModel[]> {
  const result: RemoteModel[] = []
  let pageToken: string | null = null
  const apiBaseUrl = baseUrl || "https://generativelanguage.googleapis.com"

  do {
    const searchParams = new URLSearchParams({
      pageSize: "1000"
    })
    if (pageToken) {
      searchParams.set("pageToken", pageToken)
    }

    const payload = await requestJson(
      "google",
      `${joinUrl(apiBaseUrl, `/${GOOGLE_API_VERSION}/models`)}?${searchParams}`,
      {
        headers: {
          "x-goog-api-key": apiKey
        }
      }
    )
    const models = getArrayField(payload, "models", "google")
    result.push(
      ...models.flatMap((item) => {
        const record = requireRecord(item, "google")
        if (!supportsGoogleGenerateContent(record)) {
          return []
        }

        return [
          {
            description: getStringField(record, "description"),
            displayName: getStringField(record, "displayName"),
            id: getGoogleModelId(requireStringField(record, "name", "google"))
          }
        ]
      })
    )

    pageToken = getStringField(requireRecord(payload, "google"), "nextPageToken") ?? null
  } while (pageToken)

  return result
}

function toModelConfig(providerId: ProviderId, remoteModel: RemoteModel): ModelConfig {
  const id = toProviderModelId(providerId, remoteModel.id)
  const localModel = getModelConfig(id)

  return {
    description: localModel?.description ?? remoteModel.description,
    fetchFrom: "fetch-from-remote",
    id,
    model: remoteModel.id,
    modelType: "llm",
    name: localModel?.name ?? remoteModel.displayName ?? remoteModel.id,
    provider: providerId,
    status: "active"
  }
}

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl
  const normalizedPath = path.startsWith("/") ? path : `/${path}`

  return `${normalizedBaseUrl}${normalizedPath}`
}

async function requestJson(
  providerId: ProviderId,
  url: string,
  init?: RequestInit
): Promise<unknown> {
  let response: Response
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, MODEL_LIST_REQUEST_TIMEOUT_MS)

  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal
    })
  } catch (error) {
    throw new Error(
      `${providerId} models list request failed: ${error instanceof Error ? error.message : String(error)}`
    )
  } finally {
    clearTimeout(timeoutId)
  }

  if (!response.ok) {
    const errorBody = await response.text()
    const detail = errorBody.trim() ? ` - ${errorBody.trim()}` : ""
    throw new Error(
      `${providerId} models list failed: ${response.status} ${response.statusText}${detail}`
    )
  }

  return response.json() as Promise<unknown>
}

function supportsGoogleGenerateContent(record: Record<string, unknown>): boolean {
  const supportedMethods = record["supportedGenerationMethods"]
  if (!Array.isArray(supportedMethods)) {
    throw new Error("google models list returned an invalid response")
  }

  return supportedMethods.includes("generateContent")
}

function getGoogleModelId(rawName: string): string {
  return rawName.startsWith("models/") ? rawName.slice("models/".length) : rawName
}

function getArrayField(payload: unknown, field: string, providerId: ProviderId): unknown[] {
  const record = requireRecord(payload, providerId)
  const value = record[field]
  if (!Array.isArray(value)) {
    throw new Error(`${providerId} models list returned an invalid response`)
  }

  return value
}

function requireRecord(value: unknown, providerId: ProviderId): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${providerId} models list returned an invalid response`)
  }

  return value as Record<string, unknown>
}

function getStringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function requireStringField(
  record: Record<string, unknown>,
  field: string,
  providerId: ProviderId
): string {
  const value = getStringField(record, field)
  if (!value) {
    throw new Error(`${providerId} models list returned an invalid response`)
  }

  return value
}
