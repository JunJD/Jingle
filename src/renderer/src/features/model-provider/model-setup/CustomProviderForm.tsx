import { useMemo, useReducer } from "react"
import { Loader2, Plus, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  SettingsField,
  SettingsPasswordInput,
  SettingsSelect,
  SettingsSwitch,
  SettingsTextInput,
  secondaryButtonClassName
} from "@/settings/settings-ui"
import type {
  CustomProviderConfig,
  CustomProviderEngine,
  CustomProviderInput,
  ModelProviderPaths
} from "@shared/app-types"
import { InlineError, SectionHeader } from "./ProviderSetupPages"

interface CustomProviderHeaderDraft {
  key: string
  value: string
}

interface CustomProviderFormState {
  apiKey: string
  basePath: string
  baseUrl: string
  description: string
  displayName: string
  engine: CustomProviderEngine
  errorText: string | null
  headers: CustomProviderHeaderDraft[]
  modelsText: string
  newHeaderKey: string
  newHeaderValue: string
  requiresAuth: boolean
  saving: boolean
  supportsStreaming: boolean
}

type CustomProviderFormAction =
  | { type: "set-api-key"; apiKey: string }
  | { type: "set-base-path"; basePath: string }
  | { type: "set-base-url"; baseUrl: string }
  | { type: "set-description"; description: string }
  | { type: "set-display-name"; displayName: string }
  | { type: "set-engine"; engine: CustomProviderEngine }
  | { type: "set-error"; errorText: string | null }
  | { type: "set-models-text"; modelsText: string }
  | { type: "set-new-header-key"; key: string }
  | { type: "set-new-header-value"; value: string }
  | { type: "set-requires-auth"; requiresAuth: boolean }
  | { type: "set-supports-streaming"; supportsStreaming: boolean }
  | { type: "add-header"; header: CustomProviderHeaderDraft }
  | { type: "remove-header"; key: string }
  | { type: "submit-start" }
  | { type: "submit-failure"; errorText: string }
  | { type: "submit-end" }

function createCustomProviderFormState(
  initialProvider: CustomProviderConfig | undefined
): CustomProviderFormState {
  return {
    apiKey: "",
    basePath: initialProvider?.base_path ?? "",
    baseUrl: initialProvider?.base_url ?? "",
    description: initialProvider?.description ?? "",
    displayName: initialProvider?.display_name ?? "",
    engine: initialProvider?.engine ?? "openai",
    errorText: null,
    headers: Object.entries(initialProvider?.headers ?? {}).map(([key, value]) => ({
      key,
      value
    })),
    modelsText: initialProvider ? initialProvider.models.map((model) => model.name).join(", ") : "",
    newHeaderKey: "",
    newHeaderValue: "",
    requiresAuth: initialProvider?.requires_auth ?? true,
    saving: false,
    supportsStreaming: initialProvider?.supports_streaming ?? true
  }
}

function customProviderFormReducer(
  state: CustomProviderFormState,
  action: CustomProviderFormAction
): CustomProviderFormState {
  switch (action.type) {
    case "set-api-key":
      return { ...state, apiKey: action.apiKey }
    case "set-base-path":
      return { ...state, basePath: action.basePath }
    case "set-base-url":
      return { ...state, baseUrl: action.baseUrl }
    case "set-description":
      return { ...state, description: action.description }
    case "set-display-name":
      return { ...state, displayName: action.displayName }
    case "set-engine":
      return { ...state, engine: action.engine }
    case "set-error":
      return { ...state, errorText: action.errorText }
    case "set-models-text":
      return { ...state, modelsText: action.modelsText }
    case "set-new-header-key":
      return { ...state, newHeaderKey: action.key }
    case "set-new-header-value":
      return { ...state, newHeaderValue: action.value }
    case "set-requires-auth":
      return { ...state, requiresAuth: action.requiresAuth }
    case "set-supports-streaming":
      return { ...state, supportsStreaming: action.supportsStreaming }
    case "add-header":
      return {
        ...state,
        errorText: null,
        headers: [...state.headers, action.header],
        newHeaderKey: "",
        newHeaderValue: ""
      }
    case "remove-header":
      return {
        ...state,
        headers: state.headers.filter((header) => header.key !== action.key)
      }
    case "submit-start":
      return {
        ...state,
        errorText: null,
        saving: true
      }
    case "submit-failure":
      return {
        ...state,
        errorText: action.errorText,
        saving: false
      }
    case "submit-end":
      return {
        ...state,
        saving: false
      }
  }
}

export function CustomProviderForm(props: {
  initialProvider?: CustomProviderConfig
  modelProviderPaths: ModelProviderPaths
  onBack: () => void
  onSavingChange?: (saving: boolean) => void
  onSubmit: (input: CustomProviderInput) => Promise<void>
  submitLabel: string
  title: string | null
}): React.JSX.Element {
  const {
    initialProvider,
    modelProviderPaths,
    onBack,
    onSavingChange,
    onSubmit,
    submitLabel,
    title
  } = props
  const [formState, dispatchForm] = useReducer(
    customProviderFormReducer,
    initialProvider,
    createCustomProviderFormState
  )
  const {
    apiKey,
    basePath,
    baseUrl,
    description,
    displayName,
    engine,
    errorText,
    headers,
    modelsText,
    newHeaderKey,
    newHeaderValue,
    requiresAuth,
    saving,
    supportsStreaming
  } = formState
  const modelNames = useMemo(
    () =>
      modelsText
        .split(",")
        .map((model) => model.trim())
        .filter((model) => model.length > 0),
    [modelsText]
  )
  const requiresBaseUrl = engine === "openai" || engine === "anthropic"
  const canSave =
    displayName.trim().length > 0 &&
    modelNames.length > 0 &&
    (!requiresBaseUrl || baseUrl.trim().length > 0) &&
    (!requiresAuth || Boolean(initialProvider) || apiKey.trim().length > 0)

  function handleAddHeader(): void {
    const key = newHeaderKey.trim()
    const value = newHeaderValue.trim()
    if (!key || !value) {
      dispatchForm({ errorText: "Header name and value are required.", type: "set-error" })
      return
    }
    if (key.includes(" ")) {
      dispatchForm({ errorText: "Header name cannot contain spaces.", type: "set-error" })
      return
    }
    if (headers.some((header) => header.key === key)) {
      dispatchForm({ errorText: `Header already exists: ${key}`, type: "set-error" })
      return
    }

    dispatchForm({ header: { key, value }, type: "add-header" })
  }

  async function handleSubmit(): Promise<void> {
    if (!canSave || saving) {
      return
    }

    dispatchForm({ type: "submit-start" })
    onSavingChange?.(true)
    try {
      await onSubmit({
        apiKey,
        basePath,
        baseUrl,
        description,
        displayName,
        engine,
        headers: Object.fromEntries(headers.map((header) => [header.key, header.value])),
        models: modelNames,
        providerId: initialProvider?.name,
        requiresAuth,
        supportsStreaming
      })
    } catch (error) {
      dispatchForm({
        errorText: error instanceof Error ? error.message : String(error),
        type: "submit-failure"
      })
      return
    } finally {
      onSavingChange?.(false)
    }
    dispatchForm({ type: "submit-end" })
  }

  return (
    <div className="space-y-[var(--jingle-space-4)]">
      {title ? <SectionHeader backDisabled={saving} onBack={onBack} title={title} /> : null}
      <fieldset
        disabled={saving}
        className="min-w-0 rounded-[var(--jingle-settings-card-radius)] border border-border bg-background-elevated p-[var(--jingle-space-4)]"
      >
        <div className="grid gap-[var(--jingle-space-4)]">
          <SettingsField label="Provider Type" required>
            <SettingsSelect
              value={engine}
              onChange={(event) =>
                dispatchForm({
                  engine: event.target.value as CustomProviderEngine,
                  type: "set-engine"
                })
              }
            >
              <option value="openai">OpenAI Compatible</option>
              <option value="anthropic">Anthropic Compatible</option>
              <option value="ollama">Ollama Compatible</option>
            </SettingsSelect>
          </SettingsField>
          <SettingsField label="Display Name" required>
            <SettingsTextInput
              value={displayName}
              placeholder="My Provider"
              onChange={(event) =>
                dispatchForm({ displayName: event.target.value, type: "set-display-name" })
              }
            />
          </SettingsField>
          <SettingsField label="Description">
            <SettingsTextInput
              value={description}
              placeholder="Custom OpenAI-compatible provider."
              onChange={(event) =>
                dispatchForm({ description: event.target.value, type: "set-description" })
              }
            />
          </SettingsField>
          <div className="grid gap-[var(--jingle-space-4)] sm:grid-cols-2">
            <SettingsField label="API URL" required={requiresBaseUrl}>
              <SettingsTextInput
                value={baseUrl}
                placeholder={
                  engine === "ollama" ? "http://localhost:11434/v1" : "https://api.example.com"
                }
                onChange={(event) =>
                  dispatchForm({ baseUrl: event.target.value, type: "set-base-url" })
                }
              />
            </SettingsField>
            <SettingsField label="API Base Path">
              <SettingsTextInput
                value={basePath}
                placeholder="/v1"
                onChange={(event) =>
                  dispatchForm({ basePath: event.target.value, type: "set-base-path" })
                }
              />
            </SettingsField>
          </div>
          <SettingsField label="Available Models" description="多个模型用英文逗号分隔" required>
            <SettingsTextInput
              value={modelsText}
              placeholder="gpt-5.5, qwen-plus"
              onChange={(event) =>
                dispatchForm({ modelsText: event.target.value, type: "set-models-text" })
              }
            />
          </SettingsField>
          <div className="flex items-center justify-between rounded-[var(--jingle-radius-md)] border border-border bg-background-secondary px-[var(--jingle-space-3)] py-[var(--jingle-space-2)]">
            <span className="[font-size:var(--jingle-font-body)] text-foreground">
              This provider requires an API key
            </span>
            <SettingsSwitch
              checked={requiresAuth}
              label="This provider requires an API key"
              onCheckedChange={(requiresAuth) =>
                dispatchForm({ requiresAuth, type: "set-requires-auth" })
              }
            />
          </div>
          {requiresAuth ? (
            <SettingsField label="API Key" required={!initialProvider}>
              <SettingsPasswordInput
                value={apiKey}
                placeholder={initialProvider ? "保留现有 API Key" : "sk-..."}
                showLabel="显示"
                hideLabel="隐藏"
                onChange={(event) =>
                  dispatchForm({ apiKey: event.target.value, type: "set-api-key" })
                }
              />
            </SettingsField>
          ) : null}
          <div className="flex items-center justify-between rounded-[var(--jingle-radius-md)] border border-border bg-background-secondary px-[var(--jingle-space-3)] py-[var(--jingle-space-2)]">
            <span className="[font-size:var(--jingle-font-body)] text-foreground">
              Provider supports streaming responses
            </span>
            <SettingsSwitch
              checked={supportsStreaming}
              label="Provider supports streaming responses"
              onCheckedChange={(supportsStreaming) =>
                dispatchForm({ supportsStreaming, type: "set-supports-streaming" })
              }
            />
          </div>
          <SettingsField label="Custom Headers">
            <div className="grid gap-[var(--jingle-space-2)]">
              {headers.map((header) => (
                <div
                  key={header.key}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-[var(--jingle-space-2)]"
                >
                  <SettingsTextInput value={header.key} readOnly />
                  <SettingsTextInput value={header.value} readOnly />
                  <button
                    type="button"
                    className="inline-flex h-[var(--jingle-settings-control-h)] w-[var(--jingle-settings-control-h)] items-center justify-center rounded-[var(--jingle-radius-md)] border border-border bg-background-elevated text-muted-foreground transition hover:text-foreground"
                    onClick={() => dispatchForm({ key: header.key, type: "remove-header" })}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-[var(--jingle-space-2)]">
                <SettingsTextInput
                  value={newHeaderKey}
                  placeholder="Header name"
                  onChange={(event) =>
                    dispatchForm({ key: event.target.value, type: "set-new-header-key" })
                  }
                />
                <SettingsTextInput
                  value={newHeaderValue}
                  placeholder="Value"
                  onChange={(event) =>
                    dispatchForm({ type: "set-new-header-value", value: event.target.value })
                  }
                />
                <button
                  type="button"
                  className="inline-flex h-[var(--jingle-settings-control-h)] items-center gap-[var(--jingle-space-1)] rounded-[var(--jingle-radius-md)] border border-border bg-background-elevated px-[var(--jingle-space-3)] text-muted-foreground transition hover:text-foreground"
                  onClick={handleAddHeader}
                >
                  <Plus className="h-4 w-4" />
                  Add
                </button>
              </div>
            </div>
          </SettingsField>
          <div className="rounded-[var(--jingle-radius-md)] border border-border bg-background-secondary px-[var(--jingle-space-3)] py-[var(--jingle-space-2)] [font-size:var(--jingle-font-meta)] leading-[var(--jingle-line-body)] text-muted-foreground">
            自定义 provider 会写入 {modelProviderPaths.customProvidersDir}
          </div>
          {errorText ? <InlineError text={errorText} /> : null}
          <div className="flex items-center justify-between gap-[var(--jingle-space-3)]">
            <button
              type="button"
              className={secondaryButtonClassName}
              disabled={saving}
              onClick={onBack}
            >
              <Trash2 className="h-4 w-4" />
              取消
            </button>
            <Button type="button" disabled={!canSave || saving} onClick={handleSubmit}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : submitLabel}
            </Button>
          </div>
        </div>
      </fieldset>
    </div>
  )
}
