import type { CustomProviderConfig, ModelConfig, ProviderDefinition, ProviderId } from "./types"
import { DECLARATIVE_PROVIDER_CONFIGS } from "./declarative-provider-data"
import { modelSupportsReasoning } from "./model-metadata"

const API_KEY_CREDENTIAL_VARIABLE = "apiKey"
const EXCLUDED_DECLARATIVE_PROVIDER_IDS = new Set(["custom_deepseek", "custom_tensorix"])

export function listDeclarativeProviderConfigs(): CustomProviderConfig[] {
  return DECLARATIVE_PROVIDER_CONFIGS.filter(
    (provider) => !EXCLUDED_DECLARATIVE_PROVIDER_IDS.has(provider.name)
  ).map((provider) => ({ ...provider }))
}

export function getDeclarativeProviderConfig(providerId: ProviderId): CustomProviderConfig | null {
  return listDeclarativeProviderConfigs().find((provider) => provider.name === providerId) ?? null
}

export function listDeclarativeProviderDefinitions(): ProviderDefinition[] {
  return listDeclarativeProviderConfigs().map((provider) => ({
    configurateMethods:
      provider.models.length > 0 && provider.dynamic_models !== true
        ? ["customizable-model"]
        : ["fetch-from-remote"],
    credentialFormSchemas:
      provider.requires_auth === false ? [] : [declarativeProviderApiKeyCredential(provider)],
    description: toLocalizedText(provider.description ?? `${provider.display_name} provider.`),
    id: provider.name,
    label: toLocalizedText(provider.display_name),
    name: provider.display_name,
    source: "declarative",
    supportedModelTypes: ["llm"]
  }))
}

export function listDeclarativeProviderModels(): ModelConfig[] {
  return listDeclarativeProviderConfigs().flatMap((provider) =>
    provider.models.map((model) => ({
      contextLimit: model.context_limit,
      description: provider.description,
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

function declarativeProviderApiKeyCredential(
  provider: CustomProviderConfig
): ProviderDefinition["credentialFormSchemas"][number] {
  const label = provider.api_key_env ? provider.api_key_env : "API Key"

  return {
    label: toLocalizedText(label),
    name: label,
    placeholder: toLocalizedText(provider.api_key_env ?? "API key"),
    required: true,
    type: "secret-input",
    variable: API_KEY_CREDENTIAL_VARIABLE
  }
}

function toLocalizedText(text: string): { en_US: string; zh_Hans: string } {
  return {
    en_US: text,
    zh_Hans: text
  }
}
