import type { ModelConfig, ProviderId } from "./types"
import { DASHSCOPE_BASE_URL, getModelConfig, listModelCatalog, toProviderModelId } from "./catalog"

type RemoteModel = {
  description?: string
  displayName?: string
  id: string
}

const GOOGLE_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models"
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models"
const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models"
const MODEL_LIST_REQUEST_TIMEOUT_MS = 10_000

export function listCatalogModelsByProvider(
  providerId: ProviderId,
  available: boolean
): ModelConfig[] {
  return listModelCatalog()
    .filter((model) => model.provider === providerId)
    .map((model) => ({
      ...model,
      available
    }))
}

export async function listRemoteModelsByProvider(
  providerId: ProviderId,
  apiKey: string
): Promise<ModelConfig[]> {
  const remoteModels = await fetchRemoteModels(providerId, apiKey)
  const supportedModels = remoteModels
    .filter((model) => isSupportedChatModel(providerId, model.id))
    .map((model) => toModelConfig(providerId, model))

  if (supportedModels.length === 0) {
    throw new Error(`${providerId} models list returned no supported chat models`)
  }

  return supportedModels
}

export async function validateRemoteProviderCredentials(
  providerId: ProviderId,
  apiKey: string
): Promise<void> {
  await listRemoteModelsByProvider(providerId, apiKey)
}

async function fetchRemoteModels(providerId: ProviderId, apiKey: string): Promise<RemoteModel[]> {
  switch (providerId) {
    case "anthropic":
      return fetchAnthropicModels(apiKey)
    case "dashscope":
      return fetchOpenAICompatibleModels(providerId, `${DASHSCOPE_BASE_URL}/models`, apiKey)
    case "google":
      return fetchGoogleModels(apiKey)
    case "openai":
      return fetchOpenAICompatibleModels(providerId, OPENAI_MODELS_URL, apiKey)
  }

  const exhaustiveProviderId: never = providerId
  throw new Error(`Model provider models list adapter is not implemented: ${exhaustiveProviderId}`)
}

async function fetchOpenAICompatibleModels(
  providerId: ProviderId,
  url: string,
  apiKey: string
): Promise<RemoteModel[]> {
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

async function fetchAnthropicModels(apiKey: string): Promise<RemoteModel[]> {
  const result: RemoteModel[] = []
  let afterId: string | null = null

  do {
    const searchParams = new URLSearchParams({ limit: "1000" })
    if (afterId) {
      searchParams.set("after_id", afterId)
    }

    const payload = await requestJson("anthropic", `${ANTHROPIC_MODELS_URL}?${searchParams}`, {
      headers: {
        "anthropic-version": "2023-06-01",
        "x-api-key": apiKey
      }
    })
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

async function fetchGoogleModels(apiKey: string): Promise<RemoteModel[]> {
  const result: RemoteModel[] = []
  let pageToken: string | null = null

  do {
    const searchParams = new URLSearchParams({
      key: apiKey,
      pageSize: "1000"
    })
    if (pageToken) {
      searchParams.set("pageToken", pageToken)
    }

    const payload = await requestJson("google", `${GOOGLE_MODELS_URL}?${searchParams}`)
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
    throw new Error(`${providerId} models list failed: ${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<unknown>
}

function toModelConfig(providerId: ProviderId, remoteModel: RemoteModel): ModelConfig {
  const id = toProviderModelId(providerId, remoteModel.id)
  const localModel = getModelConfig(id)

  return {
    available: true,
    description: localModel?.description ?? remoteModel.description,
    id,
    model: remoteModel.id,
    name: localModel?.name ?? remoteModel.displayName ?? remoteModel.id,
    provider: providerId
  }
}

function isSupportedChatModel(providerId: ProviderId, modelId: string): boolean {
  const blockedFragments = [
    "audio",
    "dall-e",
    "embedding",
    "image",
    "moderation",
    "rerank",
    "realtime",
    "speech",
    "tts",
    "transcribe",
    "video",
    "whisper"
  ]
  const normalizedModelId = modelId.toLowerCase()
  if (blockedFragments.some((fragment) => normalizedModelId.includes(fragment))) {
    return false
  }

  if (providerId === "anthropic") {
    return normalizedModelId.startsWith("claude-")
  }

  if (providerId === "google") {
    return normalizedModelId.startsWith("gemini-")
  }

  if (providerId === "openai") {
    return (
      normalizedModelId.startsWith("gpt-") ||
      normalizedModelId.startsWith("chatgpt-") ||
      /^o\d/.test(normalizedModelId)
    )
  }

  if (providerId === "dashscope") {
    const supportedPrefixes = [
      "abab",
      "baichuan",
      "deepseek-",
      "glm-",
      "moonshot-",
      "qwen",
      "qwq-",
      "yi-"
    ]
    return supportedPrefixes.some((prefix) => normalizedModelId.startsWith(prefix))
  }

  const exhaustiveProviderId: never = providerId
  throw new Error(`Model provider models list adapter is not implemented: ${exhaustiveProviderId}`)
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
