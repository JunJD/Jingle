import { useEffect, useMemo, useReducer, useState } from "react"
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  Gift,
  KeyRound,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { ProviderLogo } from "@/components/model-provider-logo"
import {
  SettingsField,
  SettingsPasswordInput,
  SettingsSelect,
  SettingsSwitch,
  SettingsTextInput,
  secondaryButtonClassName
} from "@/settings/settings-ui"
import { cn } from "@/lib/utils"
import type {
  CustomProviderEngine,
  CustomProviderConfig,
  CustomProviderInput,
  DefaultModelOptions,
  ModelConfig,
  ModelProviderPaths,
  Provider,
  ProviderId,
  SetDefaultModelOptions,
  ThinkingEffort
} from "@shared/app-types"

type SetupMode = "landing" | "settings-home" | "free" | "providers" | "custom"
type ProviderEditorState =
  | { kind: "closed" }
  | { kind: "activation"; provider: Provider }
  | { kind: "credentials"; provider: Provider }
  | { kind: "custom"; config: CustomProviderConfig; provider: Provider }
type ProviderCredentialFormSchema =
  Provider["providerCredentialSchema"]["credentialFormSchemas"][number]

interface ModelSetupSurfaceState {
  editor: ProviderEditorState
  editorLoadingProviderId: ProviderId | null
  mode: SetupMode
  providerPageError: string | null
  query: string
  switchInitialProviderId: ProviderId | null
  switchOpen: boolean
}

type ModelSetupSurfaceAction =
  | { type: "set-mode"; mode: SetupMode }
  | { type: "set-query"; query: string }
  | { type: "set-switch-open"; open: boolean }
  | { type: "open-switch"; providerId: ProviderId | null }
  | { type: "set-editor"; editor: ProviderEditorState }
  | { type: "set-editor-loading-provider"; providerId: ProviderId | null }
  | { type: "set-provider-page-error"; error: string | null }

function getInitialSetupMode(variant: ModelSetupSurfaceProps["variant"]): SetupMode {
  if (variant === "onboarding") {
    return "landing"
  }

  return "settings-home"
}

function createModelSetupSurfaceState(
  variant: ModelSetupSurfaceProps["variant"]
): ModelSetupSurfaceState {
  return {
    editor: { kind: "closed" },
    editorLoadingProviderId: null,
    mode: getInitialSetupMode(variant),
    providerPageError: null,
    query: "",
    switchInitialProviderId: null,
    switchOpen: false
  }
}

function modelSetupSurfaceReducer(
  state: ModelSetupSurfaceState,
  action: ModelSetupSurfaceAction
): ModelSetupSurfaceState {
  switch (action.type) {
    case "set-mode":
      return {
        ...state,
        mode: action.mode
      }
    case "set-query":
      return {
        ...state,
        query: action.query
      }
    case "set-switch-open":
      return {
        ...state,
        switchOpen: action.open
      }
    case "open-switch":
      return {
        ...state,
        switchInitialProviderId: action.providerId,
        switchOpen: true
      }
    case "set-editor":
      return {
        ...state,
        editor: action.editor
      }
    case "set-editor-loading-provider":
      return {
        ...state,
        editorLoadingProviderId: action.providerId
      }
    case "set-provider-page-error":
      return {
        ...state,
        providerPageError: action.error
      }
  }
}

const THINKING_EFFORT_OPTIONS: Array<{ label: string; value: ThinkingEffort }> = [
  { label: "Off - No extended thinking", value: "off" },
  { label: "Low - Minimal thinking, fastest responses", value: "low" },
  { label: "Medium - Moderate thinking", value: "medium" },
  { label: "High - Deep reasoning (default)", value: "high" },
  { label: "Max - No constraints on thinking depth", value: "max" }
]

function getProviderDescription(provider: Provider, fallback: string): string {
  if (provider.description?.zh_Hans) {
    return provider.description.zh_Hans
  }
  if (provider.description?.en_US) {
    return provider.description.en_US
  }

  return fallback
}

function getProviderSearchText(provider: Provider): string {
  return [
    provider.name,
    provider.description?.zh_Hans ?? "",
    provider.description?.en_US ?? ""
  ].join(" ")
}

function resolveCurrentProviderId(
  currentModel: ModelConfig | null,
  defaultModelId: string
): ProviderId | null {
  if (currentModel) {
    return currentModel.provider
  }

  return getProviderIdFromModelId(defaultModelId)
}

function resolveSwitchInitialProviderId(input: {
  activeProviderId: ProviderId | null
  currentProvider: Provider | null
  requestedProviderId?: ProviderId | null
}): ProviderId | null {
  if (input.requestedProviderId) {
    return input.requestedProviderId
  }
  if (input.currentProvider) {
    return input.currentProvider.id
  }

  return input.activeProviderId
}

function getCurrentModelPanelView(input: {
  activeProviderId: ProviderId | null
  currentModel: ModelConfig | null
  currentProvider: Provider | null
}): {
  modelName: string
  providerLogoId: ProviderId
  providerName: string
} {
  return {
    modelName: input.currentModel?.name ?? "尚未设置默认模型",
    providerLogoId: input.currentProvider?.id ?? input.activeProviderId ?? "openai",
    providerName: input.currentProvider?.name ?? "选择一个 provider 后即可开始"
  }
}

function getCredentialFieldLabel(schema: ProviderCredentialFormSchema): string {
  if (schema.label.zh_Hans) {
    return schema.label.zh_Hans
  }
  if (schema.label.en_US) {
    return schema.label.en_US
  }

  return schema.name
}

function getCredentialPlaceholder(schema: ProviderCredentialFormSchema): string | undefined {
  if (schema.placeholder?.zh_Hans) {
    return schema.placeholder.zh_Hans
  }

  return schema.placeholder?.en_US
}

function getCredentialInputValue(
  credentials: Record<string, string>,
  variable: string
): string {
  return credentials[variable] ?? ""
}

function getInitialSelectedProviderId(input: {
  currentModelId: string
  initialProviderId: ProviderId | null
  providerOptions: Provider[]
}): ProviderId {
  if (input.initialProviderId) {
    return input.initialProviderId
  }

  const currentProviderId = getProviderIdFromModelId(input.currentModelId)
  if (currentProviderId) {
    return currentProviderId
  }

  const firstProvider = input.providerOptions[0]
  if (firstProvider) {
    return firstProvider.id
  }

  return ""
}

function getInitialThinkingEffort(
  defaultModelOptions: DefaultModelOptions["llm"]
): ThinkingEffort {
  return defaultModelOptions.thinkingEffort ?? "off"
}

function findSelectedModelConfig(input: {
  models: ModelConfig[]
  providerModels: ModelConfig[]
  selectedModelId: string
  selectedModelName: string
}): ModelConfig | null {
  const providerModel = input.providerModels.find(
    (model) =>
      model.id === input.selectedModelId ||
      model.id === input.selectedModelName ||
      model.model === input.selectedModelName
  )
  if (providerModel) {
    return providerModel
  }

  return input.models.find((model) => model.id === input.selectedModelId) ?? null
}

function isReasoningModel(input: {
  modelConfig: ModelConfig | null
  modelName: string
}): boolean {
  if (input.modelConfig) {
    return input.modelConfig.reasoning === true
  }
  if (!input.modelName) {
    return false
  }

  return modelLooksReasoning(input.modelName)
}

function getCurrentModelNameForProvider(input: {
  currentModelId: string
  selectedProviderId: ProviderId
}): string | null {
  if (getProviderIdFromModelId(input.currentModelId) !== input.selectedProviderId) {
    return null
  }

  return getModelNameFromId(input.currentModelId)
}

function getSelectedModelValueAfterLoad(input: {
  canUseUnlisted: boolean
  currentModelId: string
  currentModelName: string | null
  models: ModelConfig[]
}): { customModelName: string; selectedModelValue: string } {
  if (input.currentModelName) {
    const currentModel = input.models.find(
      (model) =>
        model.id === input.currentModelId ||
        model.model === input.currentModelName
    )
    if (currentModel) {
      return {
        customModelName: "",
        selectedModelValue: currentModel.model
      }
    }

    if (input.canUseUnlisted) {
      return {
        customModelName: input.currentModelName,
        selectedModelValue: "__custom__"
      }
    }
  }

  const firstModel = input.models[0]
  return {
    customModelName: "",
    selectedModelValue: firstModel ? firstModel.model : ""
  }
}

function getSelectedModelValueAfterLoadFailure(input: {
  canUseUnlisted: boolean
  currentModelName: string | null
}): { customModelName: string; selectedModelValue: string } {
  if (input.currentModelName && input.canUseUnlisted) {
    return {
      customModelName: input.currentModelName,
      selectedModelValue: "__custom__"
    }
  }

  return {
    customModelName: "",
    selectedModelValue: ""
  }
}

export interface ModelSetupSurfaceProps {
  activeProviderId: ProviderId | null
  defaultModelId: string
  defaultModelOptions: DefaultModelOptions["llm"]
  focusProviderId?: ProviderId | null
  modelProviderPaths?: ModelProviderPaths | null
  models: ModelConfig[]
  onActivateProvider: (providerId: ProviderId) => Promise<void>
  onCreateCustomProvider: (provider: CustomProviderInput) => Promise<ProviderId>
  onDeleteCredentials: (providerId: ProviderId) => Promise<void>
  onFocusProviderConsumed?: () => void
  onRefresh: () => Promise<void>
  onSaveCredentials: (providerId: ProviderId, credentials: Record<string, string>) => Promise<void>
  onSelectModel: (modelId: string, options?: SetDefaultModelOptions) => Promise<void>
  providers: Provider[]
  title?: string
  variant: "onboarding" | "settings"
}

export function ModelSetupSurface(props: ModelSetupSurfaceProps): React.JSX.Element {
  const {
    activeProviderId,
    defaultModelId,
    defaultModelOptions,
    focusProviderId,
    modelProviderPaths,
    models,
    onActivateProvider,
    onCreateCustomProvider,
    onDeleteCredentials,
    onFocusProviderConsumed,
    onRefresh,
    onSaveCredentials,
    onSelectModel,
    providers,
    title = "欢迎使用 Jingle",
    variant
  } = props
  const [surfaceState, dispatchSurface] = useReducer(
    modelSetupSurfaceReducer,
    variant,
    createModelSetupSurfaceState
  )
  const {
    editor,
    editorLoadingProviderId,
    mode,
    providerPageError,
    query,
    switchInitialProviderId,
    switchOpen
  } = surfaceState
  const focusedProvider = focusProviderId
    ? (providers.find((provider) => provider.id === focusProviderId) ?? null)
    : null
  const effectiveMode: SetupMode = focusedProvider ? "providers" : mode

  const currentModel = models.find((model) => model.id === defaultModelId) ?? null
  const currentProviderId = resolveCurrentProviderId(currentModel, defaultModelId)
  const currentProvider = currentProviderId
    ? (providers.find((provider) => provider.id === currentProviderId) ?? null)
    : null
  const freeProviders = providers.filter(
    (provider) => ["codex", "local"].includes(provider.id) || provider.source === "registry"
  )
  const remoteProviders = providers.filter((provider) => !freeProviders.includes(provider))
  const providerPageProviders = variant === "settings" ? providers : remoteProviders
  const visibleProviders = providerPageProviders
    .filter((provider) => {
      const normalizedQuery = query.trim().toLowerCase()
      if (!normalizedQuery) {
        return true
      }

      return getProviderSearchText(provider).toLowerCase().includes(normalizedQuery)
    })
    .sort((left, right) => left.name.localeCompare(right.name))

  function openSwitchDialog(providerId?: ProviderId | null): void {
    dispatchSurface({
      providerId: resolveSwitchInitialProviderId({
        activeProviderId,
        currentProvider,
        requestedProviderId: providerId
      }),
      type: "open-switch"
    })
  }

  async function handleProviderConfigured(providerId: ProviderId): Promise<void> {
    await onRefresh()
    dispatchSurface({ providerId, type: "open-switch" })
  }

  function closeProviderEditor(): void {
    dispatchSurface({ editor: { kind: "closed" }, type: "set-editor" })
  }

  function closeProviderSettingsPage(): void {
    onFocusProviderConsumed?.()
    dispatchSurface({
      mode: getInitialSetupMode(variant),
      type: "set-mode"
    })
  }

  async function openProviderEditor(provider: Provider): Promise<void> {
    onFocusProviderConsumed?.()
    dispatchSurface({ error: null, type: "set-provider-page-error" })

    if (provider.source === "custom") {
      dispatchSurface({ providerId: provider.id, type: "set-editor-loading-provider" })
      try {
        const config = await window.api.models.getCustomProvider(provider.id)
        if (!config) {
          throw new Error(`Custom provider is not configured: ${provider.name}`)
        }
        dispatchSurface({ editor: { config, kind: "custom", provider }, type: "set-editor" })
      } catch (error) {
        dispatchSurface({
          error: error instanceof Error ? error.message : String(error),
          type: "set-provider-page-error"
        })
      } finally {
        dispatchSurface({ providerId: null, type: "set-editor-loading-provider" })
      }
      return
    }

    if (provider.providerCredentialSchema.credentialFormSchemas.length > 0) {
      dispatchSurface({ editor: { kind: "credentials", provider }, type: "set-editor" })
      return
    }

    dispatchSurface({ editor: { kind: "activation", provider }, type: "set-editor" })
  }

  return (
    <div className={cn("w-full", variant === "onboarding" ? "min-h-screen bg-background" : "")}>
      <div
        className={cn(
          "mx-auto w-full",
          variant === "onboarding"
            ? "max-w-[860px] px-[calc(var(--window-controls-offset-inline)+18px)] pb-16 pt-[120px]"
            : "max-w-[1024px] space-y-[var(--ow-space-5)]"
        )}
      >
        {variant === "onboarding" && (
          <div className="mb-[var(--ow-space-7)]">
            <div className="mb-[var(--ow-space-4)] flex h-7 w-7 items-center justify-center text-foreground">
              <ProviderLogo providerId="codex" className="h-5 w-5" />
            </div>
            <h1 className="[font-size:32px] font-normal leading-tight tracking-normal text-foreground">
              {title}
            </h1>
            <p className="mt-[var(--ow-space-3)] [font-size:17px] leading-[var(--ow-line-body)] text-muted-foreground">
              你的本地 AI agent。连接 AI 模型提供商即可开始。
            </p>
          </div>
        )}

        {variant === "settings" && effectiveMode === "settings-home" && (
          <CurrentModelPanel
            activeProviderId={activeProviderId}
            currentModel={currentModel}
            currentProvider={currentProvider}
            onConfigureProvider={() =>
              dispatchSurface({ mode: "providers", type: "set-mode" })
            }
            onSwitchModels={() => openSwitchDialog()}
          />
        )}

        {effectiveMode === "landing" ? (
          <LandingChoices
            onChooseFree={() => dispatchSurface({ mode: "free", type: "set-mode" })}
            onChooseProvider={() => dispatchSurface({ mode: "providers", type: "set-mode" })}
          />
        ) : null}

        {effectiveMode === "free" ? (
          <FreeProviderGrid
            defaultModelId={defaultModelId}
            models={models}
            providers={freeProviders}
            onBack={() => dispatchSurface({ mode: "landing", type: "set-mode" })}
            onConfigureProvider={(providerId) => {
              const provider = providers.find((item) => item.id === providerId)
              if (provider) {
                void openProviderEditor(provider)
              }
            }}
          />
        ) : null}

        {effectiveMode === "providers" ? (
          <ProviderSettingsPage
            editorLoadingProviderId={editorLoadingProviderId}
            errorText={providerPageError}
            models={models}
            providers={visibleProviders}
            query={query}
            title="提供商配置项"
            onAddCustom={() => dispatchSurface({ mode: "custom", type: "set-mode" })}
            onBack={closeProviderSettingsPage}
            onConfigureProvider={(provider) => void openProviderEditor(provider)}
            onQueryChange={(nextQuery) =>
              dispatchSurface({ query: nextQuery, type: "set-query" })
            }
            onSwitchModel={(providerId) => openSwitchDialog(providerId)}
          />
        ) : null}

        {effectiveMode === "custom" ? (
          <CustomProviderForm
            modelProviderPaths={modelProviderPaths}
            onBack={() => dispatchSurface({ mode: "providers", type: "set-mode" })}
            onSubmit={async (input) => {
              const providerId = await onCreateCustomProvider(input)
              await handleProviderConfigured(providerId)
              dispatchSurface({ mode: "providers", type: "set-mode" })
            }}
            submitLabel="保存 provider"
            title="添加自定义 provider"
          />
        ) : null}
      </div>

      <SwitchModelDialog
        currentModelId={defaultModelId}
        defaultModelOptions={defaultModelOptions}
        initialProviderId={switchInitialProviderId}
        models={models}
        open={switchOpen}
        providers={providers}
        onConfigureProviders={() => {
          dispatchSurface({ open: false, type: "set-switch-open" })
          dispatchSurface({ mode: "providers", type: "set-mode" })
        }}
        onOpenChange={(open) => dispatchSurface({ open, type: "set-switch-open" })}
        onRefresh={onRefresh}
        onSelectModel={onSelectModel}
      />

      <ProviderEditorDialogs
        activeProviderId={activeProviderId}
        editor={editor}
        modelProviderPaths={modelProviderPaths}
        onActivateProvider={onActivateProvider}
        onClose={closeProviderEditor}
        onConfigured={handleProviderConfigured}
        onDeleteCredentials={onDeleteCredentials}
        onRefresh={onRefresh}
        onSaveCredentials={onSaveCredentials}
      />
    </div>
  )
}

function LandingChoices(props: {
  onChooseFree: () => void
  onChooseProvider: () => void
}): React.JSX.Element {
  return (
    <div className="grid gap-[var(--ow-space-4)] sm:grid-cols-2">
      <ChoiceCard
        description="使用本地模型、Codex CLI 或已经注册在 registry 的模型"
        icon={<Gift className="h-5 w-5" />}
        title="使用免费/本地提供商"
        onClick={props.onChooseFree}
      />
      <ChoiceCard
        description="连接 OpenAI、Anthropic、Google、DashScope、DeepSeek 等"
        icon={<KeyRound className="h-5 w-5" />}
        title="连接提供商"
        onClick={props.onChooseProvider}
      />
    </div>
  )
}

function ChoiceCard(props: {
  description: string
  icon: React.ReactNode
  onClick: () => void
  title: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="group flex min-h-[110px] w-full items-start gap-[var(--ow-space-4)] rounded-[var(--ow-settings-card-radius)] border border-border bg-background-elevated px-[var(--ow-space-4)] py-[var(--ow-space-4)] text-left transition hover:border-border-emphasis hover:bg-background-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onClick={props.onClick}
    >
      <span className="mt-0.5 text-muted-foreground group-hover:text-foreground">{props.icon}</span>
      <span className="min-w-0">
        <span className="block [font-size:var(--ow-font-title)] font-medium text-foreground">
          {props.title}
        </span>
        <span className="mt-[var(--ow-space-1)] block [font-size:var(--ow-font-body)] leading-[var(--ow-line-body)] text-muted-foreground">
          {props.description}
        </span>
      </span>
    </button>
  )
}

function CurrentModelPanel(props: {
  activeProviderId: ProviderId | null
  currentModel: ModelConfig | null
  currentProvider: Provider | null
  onConfigureProvider: () => void
  onSwitchModels: () => void
}): React.JSX.Element {
  const { activeProviderId, currentModel, currentProvider, onConfigureProvider, onSwitchModels } =
    props
  const view = getCurrentModelPanelView({ activeProviderId, currentModel, currentProvider })
  return (
    <div className="rounded-[var(--ow-settings-card-radius)] border border-border bg-background-secondary/60 px-[var(--ow-space-4)] py-[var(--ow-space-4)]">
      <div className="flex flex-col gap-[var(--ow-space-4)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-[var(--ow-space-3)]">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--ow-radius-md)] border border-border bg-background-elevated text-foreground">
            <ProviderLogo
              providerId={view.providerLogoId}
              className="h-5 w-5"
            />
          </div>
          <div className="min-w-0">
            <div className="mb-0.5 [font-size:var(--ow-font-caption)] font-medium text-muted-foreground">
              新线程默认模型
            </div>
            <div className="[font-size:var(--ow-font-title)] font-semibold text-foreground">
              {view.modelName}
            </div>
            <div className="mt-0.5 truncate [font-size:var(--ow-font-body)] text-muted-foreground">
              {view.providerName}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 gap-[var(--ow-gap-sm)]">
          <Button type="button" variant="outline" onClick={onSwitchModels}>
            设置默认模型
          </Button>
          <Button type="button" variant="outline" onClick={onConfigureProvider}>
            配置提供商
          </Button>
        </div>
      </div>
    </div>
  )
}

function ProviderSettingsPage(props: {
  editorLoadingProviderId: ProviderId | null
  errorText: string | null
  models: ModelConfig[]
  onAddCustom: () => void
  onBack: () => void
  onConfigureProvider: (provider: Provider) => void
  onQueryChange: (query: string) => void
  onSwitchModel: (providerId: ProviderId) => void
  providers: Provider[]
  query: string
  title: string
}): React.JSX.Element {
  const configuredProviders = props.providers.filter(
    (provider) => getProviderReadiness(provider, props.models) === "ready"
  )
  const availableProviders = props.providers.filter(
    (provider) => getProviderReadiness(provider, props.models) !== "ready"
  )
  const hasProviders = props.providers.length > 0

  return (
    <div className="space-y-[var(--ow-space-6)]">
      <div className="border-b border-border pb-[var(--ow-space-5)]">
        <button
          type="button"
          className="inline-flex h-8 items-center gap-[var(--ow-space-2)] rounded-[var(--ow-radius-md)] bg-background-secondary px-[var(--ow-space-3)] [font-size:var(--ow-font-body)] text-muted-foreground transition hover:bg-background-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={props.onBack}
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </button>
        <div className="mt-[var(--ow-space-5)] flex flex-col gap-[var(--ow-space-4)] sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="[font-size:28px] font-normal leading-tight tracking-normal text-foreground">
              {props.title}
            </h1>
            <div className="mt-[var(--ow-space-2)] flex flex-wrap items-center gap-[var(--ow-space-2)] [font-size:var(--ow-font-caption)] text-muted-foreground">
              <ProviderCountBadge label="已可用" value={configuredProviders.length} />
              <ProviderCountBadge label="待处理" value={availableProviders.length} />
            </div>
          </div>
          <div className="flex w-full flex-col gap-[var(--ow-space-2)] sm:w-auto sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-[260px]">
              <Search className="pointer-events-none absolute left-[var(--ow-space-3)] top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                aria-label="搜索 provider"
                className="min-h-[var(--ow-settings-control-h)] w-full rounded-[var(--ow-radius-md)] border border-border bg-background-elevated px-[var(--ow-space-3)] py-[var(--ow-space-1)] pl-9 [font-size:var(--ow-settings-control-font)] outline-none transition focus:border-[var(--ring)]"
                placeholder="搜索 provider"
                value={props.query}
                onChange={(event) => props.onQueryChange(event.target.value)}
              />
            </div>
            <button
              type="button"
              className="inline-flex h-[var(--ow-settings-control-h)] shrink-0 items-center justify-center gap-[var(--ow-space-2)] rounded-[var(--ow-radius-md)] border border-border bg-background-elevated px-[var(--ow-space-3)] [font-size:var(--ow-font-body)] font-medium text-foreground transition hover:bg-background-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={props.onAddCustom}
            >
              <Plus className="h-4 w-4" />
              自定义 provider
            </button>
          </div>
        </div>
      </div>

      {props.errorText ? <InlineError text={props.errorText} /> : null}

      {configuredProviders.length > 0 ? (
        <ProviderSection
          editorLoadingProviderId={props.editorLoadingProviderId}
          models={props.models}
          providers={configuredProviders}
          title="已可用"
          onConfigureProvider={props.onConfigureProvider}
          onSwitchModel={props.onSwitchModel}
        />
      ) : null}

      {availableProviders.length > 0 ? (
        <ProviderSection
          editorLoadingProviderId={props.editorLoadingProviderId}
          models={props.models}
          providers={availableProviders}
          title="待配置或检测"
          onConfigureProvider={props.onConfigureProvider}
          onSwitchModel={props.onSwitchModel}
        />
      ) : null}

      {!hasProviders ? (
        <div className="rounded-[var(--ow-radius-md)] border border-dashed border-border bg-background-secondary px-[var(--ow-space-4)] py-[var(--ow-space-6)] text-center [font-size:var(--ow-font-body)] text-muted-foreground">
          没有匹配的 provider
        </div>
      ) : null}
    </div>
  )
}

function ProviderCountBadge(props: { label: string; value: number }): React.JSX.Element {
  return (
    <span className="inline-flex h-6 items-center gap-[var(--ow-space-1)] rounded-full border border-border bg-background-secondary px-[var(--ow-space-2)]">
      <span>{props.label}</span>
      <span className="font-mono text-foreground">{props.value}</span>
    </span>
  )
}

function ProviderSection(props: {
  editorLoadingProviderId: ProviderId | null
  models: ModelConfig[]
  onConfigureProvider: (provider: Provider) => void
  onSwitchModel: (providerId: ProviderId) => void
  providers: Provider[]
  title: string
}): React.JSX.Element {
  return (
    <section className="space-y-[var(--ow-space-3)]">
      <div className="flex items-center gap-[var(--ow-space-2)]">
        <h2 className="[font-size:var(--ow-font-title)] font-semibold text-foreground">
          {props.title}
        </h2>
        <span className="rounded-full bg-background-secondary px-[var(--ow-space-2)] py-[2px] [font-size:var(--ow-font-caption)] font-mono text-muted-foreground">
          {props.providers.length}
        </span>
      </div>
      <div className="grid gap-[var(--ow-space-2)]">
        {props.providers.map((provider) => (
          <ProviderCard
            key={provider.id}
            loading={props.editorLoadingProviderId === provider.id}
            models={props.models}
            provider={provider}
            onConfigure={() => props.onConfigureProvider(provider)}
            onSwitchModel={() => props.onSwitchModel(provider.id)}
          />
        ))}
      </div>
    </section>
  )
}

function FreeProviderGrid(props: {
  defaultModelId: string
  models: ModelConfig[]
  onBack: () => void
  onConfigureProvider: (providerId: ProviderId) => void
  providers: Provider[]
}): React.JSX.Element {
  const { defaultModelId, models, onBack, onConfigureProvider, providers } = props

  return (
    <div className="space-y-[var(--ow-space-4)]">
      <SectionHeader onBack={onBack} title="免费/本地提供商" />
      <div className="grid gap-[var(--ow-space-3)] sm:grid-cols-2">
        {providers.map((provider) => {
          const providerModels = models.filter((model) => model.provider === provider.id)
          const selected = providerModels.some((model) => model.id === defaultModelId)
          return (
            <button
              key={provider.id}
              type="button"
              className="flex min-h-[132px] items-start gap-[var(--ow-space-3)] rounded-[var(--ow-settings-card-radius)] border border-border bg-background-elevated p-[var(--ow-space-4)] text-left transition hover:border-border-emphasis hover:bg-background-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => onConfigureProvider(provider.id)}
            >
              <ProviderLogo
                providerId={provider.id}
                className="mt-1 h-5 w-5 shrink-0 text-foreground"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-title)] font-medium text-foreground">
                  {provider.name}
                  {selected ? <Check className="h-4 w-4 text-status-nominal" /> : null}
                </span>
                <span className="mt-[var(--ow-space-1)] block [font-size:var(--ow-font-body)] leading-[var(--ow-line-body)] text-muted-foreground">
                  {getProviderDescription(provider, "本地模型 provider")}
                </span>
              </span>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ProviderCard(props: {
  loading: boolean
  models: ModelConfig[]
  onConfigure: () => void
  onSwitchModel: () => void
  provider: Provider
}): React.JSX.Element {
  const { loading, models, onConfigure, onSwitchModel, provider } = props
  const readiness = getProviderReadiness(provider, models)
  const configured = provider.customConfiguration.status === "active"

  return (
    <div className="group flex min-h-[92px] flex-col gap-[var(--ow-space-3)] rounded-[var(--ow-radius-md)] border border-border bg-background-elevated px-[var(--ow-space-4)] py-[var(--ow-space-3)] text-left transition hover:border-border-emphasis hover:bg-background-secondary sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-[var(--ow-space-3)]">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--ow-radius-md)] border border-border bg-background text-foreground">
          <ProviderLogo providerId={provider.id} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-[var(--ow-space-2)]">
            <div className="truncate [font-size:var(--ow-font-title)] font-medium text-foreground">
              {provider.name}
            </div>
            <ProviderStatusPill readiness={readiness} />
          </div>
          <div className="mt-[var(--ow-space-1)] line-clamp-2 [font-size:var(--ow-font-body)] leading-[var(--ow-line-body)] text-muted-foreground">
            {getProviderDescription(provider, "自定义 provider")}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-[var(--ow-space-2)] pl-[52px] sm:pl-0">
        <button
          type="button"
          className="inline-flex h-8 items-center gap-[var(--ow-space-1)] rounded-[var(--ow-radius-md)] border border-border bg-background px-[var(--ow-space-3)] [font-size:var(--ow-font-body)] font-medium text-foreground transition hover:bg-background-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          disabled={loading}
          onClick={onConfigure}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <SlidersHorizontal className="h-3.5 w-3.5" />
          )}
          {configured ? "编辑" : "配置"}
        </button>
        {configured ? (
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-[var(--ow-radius-md)] border border-border bg-background px-[var(--ow-space-3)] [font-size:var(--ow-font-body)] font-medium text-muted-foreground transition hover:bg-background-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={onSwitchModel}
          >
            {readiness === "needs-models" ? "检测" : "切换"}
          </button>
        ) : null}
      </div>
    </div>
  )
}

type ProviderReadiness = "ready" | "error" | "needs-models" | "needs-setup"

function ProviderStatusPill(props: { readiness: ProviderReadiness }): React.JSX.Element {
  const label = getProviderReadinessLabel(props.readiness)
  const icon = props.readiness === "ready" ? <Check className="h-3 w-3" /> : null

  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-[var(--ow-space-1)] rounded-full border px-[var(--ow-space-2)] [font-size:var(--ow-font-caption)]",
        getProviderReadinessClassName(props.readiness)
      )}
    >
      {icon}
      {label}
    </span>
  )
}

function getProviderReadiness(provider: Provider, models: ModelConfig[]): ProviderReadiness {
  if (provider.customConfiguration.status !== "active") {
    return "needs-setup"
  }
  if (provider.modelListStatus === "error") {
    return "error"
  }
  if (
    provider.modelListStatus !== "active" ||
    models.every((model) => model.provider !== provider.id || model.status !== "active")
  ) {
    return "needs-models"
  }

  return "ready"
}

function getProviderReadinessLabel(readiness: ProviderReadiness): string {
  if (readiness === "ready") {
    return "已可用"
  }
  if (readiness === "error") {
    return "模型列表失败"
  }
  if (readiness === "needs-models") {
    return "待检测"
  }

  return "未配置"
}

function getProviderReadinessClassName(readiness: ProviderReadiness): string {
  if (readiness === "ready") {
    return "border-status-nominal/20 bg-status-nominal/10 text-status-nominal"
  }
  if (readiness === "error") {
    return "border-status-critical/20 bg-status-critical/10 text-status-critical"
  }
  if (readiness === "needs-models") {
    return "border-status-warning/20 bg-status-warning/10 text-status-warning"
  }

  return "border-border bg-background-secondary text-muted-foreground"
}

function ProviderEditorDialogs(props: {
  activeProviderId: ProviderId | null
  editor: ProviderEditorState
  modelProviderPaths?: ModelProviderPaths | null
  onActivateProvider: (providerId: ProviderId) => Promise<void>
  onClose: () => void
  onConfigured: (providerId: ProviderId) => Promise<void>
  onDeleteCredentials: (providerId: ProviderId) => Promise<void>
  onRefresh: () => Promise<void>
  onSaveCredentials: (providerId: ProviderId, credentials: Record<string, string>) => Promise<void>
}): React.JSX.Element | null {
  const {
    activeProviderId,
    editor,
    modelProviderPaths,
    onActivateProvider,
    onClose,
    onConfigured,
    onDeleteCredentials,
    onRefresh,
    onSaveCredentials
  } = props

  if (editor.kind === "closed") {
    return null
  }

  if (editor.kind === "custom") {
    return (
      <CustomProviderDialog
        initialProvider={editor.config}
        modelProviderPaths={modelProviderPaths}
        provider={editor.provider}
        onClose={onClose}
        onSaved={async (providerId) => {
          onClose()
          await onConfigured(providerId)
        }}
      />
    )
  }

  if (editor.kind === "credentials") {
    return (
      <ProviderCredentialsDialog
        activeProviderId={activeProviderId}
        provider={editor.provider}
        onClose={onClose}
        onConfigured={async (providerId) => {
          onClose()
          await onConfigured(providerId)
        }}
        onDeleteCredentials={onDeleteCredentials}
        onRefresh={onRefresh}
        onSaveCredentials={onSaveCredentials}
      />
    )
  }

  return (
    <ProviderActivationDialog
      provider={editor.provider}
      onActivateProvider={onActivateProvider}
      onClose={onClose}
      onConfigured={async (providerId) => {
        onClose()
        await onConfigured(providerId)
      }}
    />
  )
}

function ProviderCredentialsDialog(props: {
  activeProviderId: ProviderId | null
  onClose: () => void
  onConfigured: (providerId: ProviderId) => Promise<void>
  onDeleteCredentials: (providerId: ProviderId) => Promise<void>
  onRefresh: () => Promise<void>
  onSaveCredentials: (providerId: ProviderId, credentials: Record<string, string>) => Promise<void>
  provider: Provider
}): React.JSX.Element {
  const {
    activeProviderId,
    onClose,
    onConfigured,
    onDeleteCredentials,
    onRefresh,
    onSaveCredentials,
    provider
  } = props
  const credentialSchemas = provider.providerCredentialSchema.credentialFormSchemas
  const configured = provider.customConfiguration.status === "active"
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const canSave =
    !loading &&
    credentialSchemas.every(
      (schema) => !schema.required || Boolean(credentials[schema.variable]?.trim())
    )

  useEffect(() => {
    let cancelled = false

    async function loadCredentials(): Promise<void> {
      try {
        const storedCredentials = await window.api.models.getCredentials(provider.id)
        if (!cancelled) {
          setCredentials(storedCredentials ?? {})
        }
      } catch (error) {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadCredentials()
    return () => {
      cancelled = true
    }
  }, [provider.id])

  async function handleSave(): Promise<void> {
    if (!canSave || saving) {
      return
    }

    setSaving(true)
    setErrorText(null)
    try {
      await onSaveCredentials(provider.id, credentials)
      await onConfigured(provider.id)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (saving || provider.id === activeProviderId) {
      return
    }

    setSaving(true)
    setErrorText(null)
    try {
      await onDeleteCredentials(provider.id)
      await onRefresh()
      onClose()
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[var(--ow-dialog-mobile-w)] rounded-[var(--ow-radius-dialog)] sm:max-w-[520px] sm:rounded-[var(--ow-radius-dialog)]">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-[var(--ow-space-2)]">
            <ProviderLogo providerId={provider.id} className="h-5 w-5" />
            {configured ? "编辑" : "配置"} {provider.name}
          </DialogTitle>
          <DialogDescription>保存后会读取可用模型。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-[var(--ow-space-4)]">
          {loading ? (
            <div className="flex items-center gap-[var(--ow-space-2)] [font-size:var(--ow-font-body)] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              读取配置
            </div>
          ) : null}

          {credentialSchemas.map((schema) => {
            const label = getCredentialFieldLabel(schema)
            const placeholder = getCredentialPlaceholder(schema)
            return (
              <SettingsField key={schema.variable} label={label} required={schema.required}>
                {schema.type === "secret-input" ? (
                  <SettingsPasswordInput
                    value={getCredentialInputValue(credentials, schema.variable)}
                    placeholder={placeholder}
                    showLabel="显示"
                    hideLabel="隐藏"
                    onChange={(event) =>
                      setCredentials((current) => ({
                        ...current,
                        [schema.variable]: event.target.value
                      }))
                    }
                  />
                ) : (
                  <SettingsTextInput
                    value={getCredentialInputValue(credentials, schema.variable)}
                    placeholder={placeholder}
                    onChange={(event) =>
                      setCredentials((current) => ({
                        ...current,
                        [schema.variable]: event.target.value
                      }))
                    }
                  />
                )}
              </SettingsField>
            )
          })}

          {errorText ? <InlineError text={errorText} /> : null}
        </div>

        <DialogFooter className="flex-col-reverse gap-[var(--ow-space-2)] sm:flex-row sm:items-center sm:justify-between">
          {configured ? (
            <button
              type="button"
              className={secondaryButtonClassName}
              disabled={saving || provider.id === activeProviderId}
              onClick={handleDelete}
            >
              <Trash2 className="h-4 w-4" />
              删除配置
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center justify-end gap-[var(--ow-space-2)]">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="button" disabled={!canSave || saving} onClick={handleSave}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "保存配置"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProviderActivationDialog(props: {
  onActivateProvider: (providerId: ProviderId) => Promise<void>
  onClose: () => void
  onConfigured: (providerId: ProviderId) => Promise<void>
  provider: Provider
}): React.JSX.Element {
  const { onActivateProvider, onClose, onConfigured, provider } = props
  const [saving, setSaving] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const unavailableMessage = provider.customConfiguration.message

  async function handleActivate(): Promise<void> {
    if (saving || unavailableMessage) {
      return
    }

    setSaving(true)
    setErrorText(null)
    try {
      await onActivateProvider(provider.id)
      await onConfigured(provider.id)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[var(--ow-dialog-mobile-w)] rounded-[var(--ow-radius-dialog)] sm:max-w-[460px] sm:rounded-[var(--ow-radius-dialog)]">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-[var(--ow-space-2)]">
            <ProviderLogo providerId={provider.id} className="h-5 w-5" />
            配置 {provider.name}
          </DialogTitle>
          <DialogDescription>
            {getProviderDescription(provider, "此 provider 不需要凭据。")}
          </DialogDescription>
        </DialogHeader>

        {errorText ? <InlineError text={errorText} /> : null}
        {unavailableMessage ? <InlineError text={unavailableMessage} /> : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            disabled={saving || Boolean(unavailableMessage)}
            onClick={handleActivate}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "启用 provider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CustomProviderDialog(props: {
  initialProvider: CustomProviderConfig
  modelProviderPaths?: ModelProviderPaths | null
  onClose: () => void
  onSaved: (providerId: ProviderId) => Promise<void>
  provider: Provider
}): React.JSX.Element {
  const { initialProvider, modelProviderPaths, onClose, onSaved, provider } = props

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[var(--ow-dialog-mobile-w)] max-h-[90vh] overflow-y-auto rounded-[var(--ow-radius-dialog)] sm:max-w-[600px] sm:rounded-[var(--ow-radius-dialog)]">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-[var(--ow-space-2)]">
            <ProviderLogo providerId={provider.id} className="h-5 w-5" />
            编辑 {provider.name}
          </DialogTitle>
        </DialogHeader>

        <CustomProviderForm
          initialProvider={initialProvider}
          modelProviderPaths={modelProviderPaths}
          onBack={onClose}
          onSubmit={async (input) => {
            const providerId = await window.api.models.upsertCustomProvider(input)
            await onSaved(providerId)
          }}
          submitLabel="保存 provider"
          title={null}
        />
      </DialogContent>
    </Dialog>
  )
}

function SwitchModelDialog(props: {
  currentModelId: string
  defaultModelOptions: DefaultModelOptions["llm"]
  initialProviderId: ProviderId | null
  models: ModelConfig[]
  onConfigureProviders: () => void
  onOpenChange: (open: boolean) => void
  onRefresh: () => Promise<void>
  onSelectModel: (modelId: string, options?: SetDefaultModelOptions) => Promise<void>
  open: boolean
  providers: Provider[]
}): React.JSX.Element | null {
  const {
    currentModelId,
    defaultModelOptions,
    initialProviderId,
    models,
    onConfigureProviders,
    onOpenChange,
    onRefresh,
    onSelectModel,
    open,
    providers
  } = props
  const providerOptions = providers
    .filter(
      (provider) =>
        provider.customConfiguration.status === "active" || provider.id === initialProviderId
    )
    .sort((left, right) => left.name.localeCompare(right.name))

  if (!open) {
    return null
  }

  const initialSelectedProviderId = getInitialSelectedProviderId({
    currentModelId,
    initialProviderId,
    providerOptions
  })

  return (
    <SwitchModelDialogContent
      currentModelId={currentModelId}
      defaultModelOptions={defaultModelOptions}
      initialSelectedProviderId={initialSelectedProviderId}
      models={models}
      providerOptions={providerOptions}
      providers={providers}
      onConfigureProviders={onConfigureProviders}
      onOpenChange={onOpenChange}
      onRefresh={onRefresh}
      onSelectModel={onSelectModel}
    />
  )
}

interface SwitchModelDialogState {
  customModelName: string
  errorText: string | null
  loadingModels: boolean
  providerModels: ModelConfig[]
  saving: boolean
  selectedModelValue: string
  selectedProviderId: ProviderId
  thinkingEffort: ThinkingEffort
}

type SwitchModelDialogAction =
  | { type: "select-provider"; providerId: ProviderId }
  | { type: "select-model"; modelValue: string }
  | { type: "set-custom-model-name"; modelName: string }
  | { type: "set-thinking-effort"; thinkingEffort: ThinkingEffort }
  | { type: "load-start" }
  | { type: "load-success"; customModelName: string; models: ModelConfig[]; selectedModelValue: string }
  | { type: "load-failure"; customModelName: string; errorText: string; selectedModelValue: string }
  | { type: "save-start" }
  | { type: "save-success" }
  | { type: "save-failure"; errorText: string }

function switchModelDialogReducer(
  state: SwitchModelDialogState,
  action: SwitchModelDialogAction
): SwitchModelDialogState {
  switch (action.type) {
    case "select-provider":
      return {
        ...state,
        customModelName: "",
        selectedModelValue: "",
        selectedProviderId: action.providerId
      }
    case "select-model":
      return {
        ...state,
        customModelName: action.modelValue === "__custom__" ? state.customModelName : "",
        selectedModelValue: action.modelValue
      }
    case "set-custom-model-name":
      return {
        ...state,
        customModelName: action.modelName
      }
    case "set-thinking-effort":
      return {
        ...state,
        thinkingEffort: action.thinkingEffort
      }
    case "load-start":
      return {
        ...state,
        errorText: null,
        loadingModels: true
      }
    case "load-success":
      return {
        ...state,
        customModelName: action.customModelName,
        loadingModels: false,
        providerModels: action.models,
        selectedModelValue: action.selectedModelValue
      }
    case "load-failure":
      return {
        ...state,
        customModelName: action.customModelName,
        errorText: action.errorText,
        loadingModels: false,
        providerModels: [],
        selectedModelValue: action.selectedModelValue
      }
    case "save-start":
      return {
        ...state,
        errorText: null,
        saving: true
      }
    case "save-success":
      return {
        ...state,
        saving: false
      }
    case "save-failure":
      return {
        ...state,
        errorText: action.errorText,
        saving: false
      }
  }
}

function SwitchModelDialogContent(props: {
  currentModelId: string
  defaultModelOptions: DefaultModelOptions["llm"]
  initialSelectedProviderId: ProviderId
  models: ModelConfig[]
  onConfigureProviders: () => void
  onOpenChange: (open: boolean) => void
  onRefresh: () => Promise<void>
  onSelectModel: (modelId: string, options?: SetDefaultModelOptions) => Promise<void>
  providerOptions: Provider[]
  providers: Provider[]
}): React.JSX.Element {
  const {
    currentModelId,
    defaultModelOptions,
    initialSelectedProviderId,
    models,
    onConfigureProviders,
    onOpenChange,
    onRefresh,
    onSelectModel,
    providerOptions,
    providers
  } = props
  const [dialogState, dispatchDialog] = useReducer(switchModelDialogReducer, {
    customModelName: "",
    errorText: null,
    loadingModels: false,
    providerModels: [],
    saving: false,
    selectedModelValue: "",
    selectedProviderId: initialSelectedProviderId,
    thinkingEffort: getInitialThinkingEffort(defaultModelOptions)
  })
  const {
    customModelName,
    errorText,
    loadingModels,
    providerModels,
    saving,
    selectedModelValue,
    selectedProviderId,
    thinkingEffort
  } = dialogState
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? null
  const customMode = selectedModelValue === "__custom__"
  const selectedModelName = customMode ? customModelName.trim() : selectedModelValue
  const selectedModelId = selectedProviderId ? `${selectedProviderId}:${selectedModelName}` : ""
  const selectedModelConfig = findSelectedModelConfig({
    models,
    providerModels,
    selectedModelId,
    selectedModelName
  })
  const reasoningEnabled = isReasoningModel({
    modelConfig: selectedModelConfig,
    modelName: selectedModelName
  })
  const canUseUnlisted = Boolean(
    selectedProvider?.configurateMethods.includes("customizable-model")
  )
  const canSave = Boolean(selectedProviderId && selectedModelName && !loadingModels && !saving)

  useEffect(() => {
    if (!selectedProviderId) {
      return
    }

    let cancelled = false
    async function loadModels(): Promise<void> {
      dispatchDialog({ type: "load-start" })
      try {
        const response = await window.api.models.listByProvider(selectedProviderId, "llm")
        if (cancelled) {
          return
        }
        const currentModelName = getCurrentModelNameForProvider({
          currentModelId,
          selectedProviderId
        })
        const selectedModel = getSelectedModelValueAfterLoad({
          canUseUnlisted,
          currentModelId,
          currentModelName,
          models: response.models
        })
        dispatchDialog({
          customModelName: selectedModel.customModelName,
          models: response.models,
          selectedModelValue: selectedModel.selectedModelValue,
          type: "load-success"
        })
      } catch (error) {
        if (!cancelled) {
          const currentModelName = getCurrentModelNameForProvider({
            currentModelId,
            selectedProviderId
          })
          const selectedModel = getSelectedModelValueAfterLoadFailure({
            canUseUnlisted,
            currentModelName
          })
          dispatchDialog({
            customModelName: selectedModel.customModelName,
            errorText: error instanceof Error ? error.message : String(error),
            selectedModelValue: selectedModel.selectedModelValue,
            type: "load-failure"
          })
        }
      }
    }

    void loadModels()
    return () => {
      cancelled = true
    }
  }, [canUseUnlisted, currentModelId, selectedProviderId])

  async function handleSave(): Promise<void> {
    if (!canSave) {
      return
    }

    dispatchDialog({ type: "save-start" })
    try {
      await onSelectModel(`${selectedProviderId}:${selectedModelName}`, {
        allowUnlisted: customMode,
        thinkingEffort: reasoningEnabled ? thinkingEffort : null
      })
      await onRefresh()
      dispatchDialog({ type: "save-success" })
      onOpenChange(false)
    } catch (error) {
      dispatchDialog({
        errorText: error instanceof Error ? error.message : String(error),
        type: "save-failure"
      })
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="w-[var(--ow-dialog-mobile-w)] rounded-[var(--ow-radius-dialog)] sm:max-w-[500px] sm:rounded-[var(--ow-radius-dialog)]">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-[var(--ow-space-2)]">
            <SlidersHorizontal className="h-4 w-4" />
            设置新线程默认模型
          </DialogTitle>
          <DialogDescription>
            选择后会用于之后新建的对话；当前已有对话请在对话顶部切换。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-[var(--ow-space-3)]">
          <SettingsSelect
            value={selectedProviderId}
            onChange={(event) => {
              if (event.target.value === "__configure__") {
                onConfigureProviders()
                return
              }
              dispatchDialog({
                providerId: event.target.value,
                type: "select-provider"
              })
            }}
          >
            {providerOptions.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
            <option value="__configure__">Use other provider</option>
          </SettingsSelect>

          <SettingsSelect
            value={selectedModelValue}
            disabled={!selectedProviderId || loadingModels}
            onChange={(event) => {
              dispatchDialog({
                modelValue: event.target.value,
                type: "select-model"
              })
            }}
          >
            {loadingModels ? <option value="">读取模型</option> : null}
            {!loadingModels && providerModels.length === 0 ? (
              <option value="">{canUseUnlisted ? "选择或输入模型" : "无可用模型"}</option>
            ) : null}
            {providerModels.map((model) => (
              <option key={model.id} value={model.model}>
                {model.name}
              </option>
            ))}
            {canUseUnlisted ? <option value="__custom__">输入未列出的模型...</option> : null}
          </SettingsSelect>

          {customMode ? (
            <SettingsTextInput
              value={customModelName}
              placeholder="gpt-5.5"
              onChange={(event) =>
                dispatchDialog({
                  modelName: event.target.value,
                  type: "set-custom-model-name"
                })
              }
            />
          ) : null}

          {reasoningEnabled ? (
            <SettingsField label="思考努力">
              <SettingsSelect
                value={thinkingEffort}
                onChange={(event) =>
                  dispatchDialog({
                    thinkingEffort: event.target.value as ThinkingEffort,
                    type: "set-thinking-effort"
                  })
                }
              >
                {THINKING_EFFORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SettingsSelect>
            </SettingsField>
          ) : null}

          {errorText ? <InlineError text={errorText} /> : null}

          <div className="flex items-center justify-between gap-[var(--ow-space-3)] pt-[var(--ow-space-2)]">
            <button
              type="button"
              className={secondaryButtonClassName}
              onClick={onConfigureProviders}
            >
              Provider
            </button>
            <div className="flex items-center gap-[var(--ow-space-2)]">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="button" disabled={!canSave} onClick={handleSave}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "选择模型"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SectionHeader(props: {
  onBack?: () => void
  title: string
  trailing?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-[var(--ow-space-3)] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-[var(--ow-space-2)]">
        {props.onBack ? (
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--ow-radius-md)] text-muted-foreground transition hover:bg-background-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={props.onBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : null}
        <h2 className="[font-size:var(--ow-settings-title-size)] font-semibold text-foreground">
          {props.title}
        </h2>
      </div>
      {props.trailing}
    </div>
  )
}

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

function CustomProviderForm(props: {
  initialProvider?: CustomProviderConfig
  modelProviderPaths?: ModelProviderPaths | null
  onBack: () => void
  onSubmit: (input: CustomProviderInput) => Promise<void>
  submitLabel: string
  title: string | null
}): React.JSX.Element {
  const { initialProvider, modelProviderPaths, onBack, onSubmit, submitLabel, title } = props
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
    }
    dispatchForm({ type: "submit-end" })
  }

  return (
    <div className="space-y-[var(--ow-space-4)]">
      {title ? <SectionHeader onBack={onBack} title={title} /> : null}
      <div className="rounded-[var(--ow-settings-card-radius)] border border-border bg-background-elevated p-[var(--ow-space-4)]">
        <div className="grid gap-[var(--ow-space-4)]">
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
          <div className="grid gap-[var(--ow-space-4)] sm:grid-cols-2">
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
          <div className="flex items-center justify-between rounded-[var(--ow-radius-md)] border border-border bg-background-secondary px-[var(--ow-space-3)] py-[var(--ow-space-2)]">
            <span className="[font-size:var(--ow-font-body)] text-foreground">
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
          <div className="flex items-center justify-between rounded-[var(--ow-radius-md)] border border-border bg-background-secondary px-[var(--ow-space-3)] py-[var(--ow-space-2)]">
            <span className="[font-size:var(--ow-font-body)] text-foreground">
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
            <div className="grid gap-[var(--ow-space-2)]">
              {headers.map((header) => (
                <div
                  key={header.key}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-[var(--ow-space-2)]"
                >
                  <SettingsTextInput value={header.key} readOnly />
                  <SettingsTextInput value={header.value} readOnly />
                  <button
                    type="button"
                    className="inline-flex h-[var(--ow-settings-control-h)] w-[var(--ow-settings-control-h)] items-center justify-center rounded-[var(--ow-radius-md)] border border-border bg-background-elevated text-muted-foreground transition hover:text-foreground"
                    onClick={() =>
                      dispatchForm({ key: header.key, type: "remove-header" })
                    }
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-[var(--ow-space-2)]">
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
                  className="inline-flex h-[var(--ow-settings-control-h)] items-center gap-[var(--ow-space-1)] rounded-[var(--ow-radius-md)] border border-border bg-background-elevated px-[var(--ow-space-3)] text-muted-foreground transition hover:text-foreground"
                  onClick={handleAddHeader}
                >
                  <Plus className="h-4 w-4" />
                  Add
                </button>
              </div>
            </div>
          </SettingsField>
          {modelProviderPaths ? (
            <div className="rounded-[var(--ow-radius-md)] border border-border bg-background-secondary px-[var(--ow-space-3)] py-[var(--ow-space-2)] [font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-muted-foreground">
              自定义 provider 会写入 {modelProviderPaths.customProvidersDir}
            </div>
          ) : null}
          {errorText ? <InlineError text={errorText} /> : null}
          <div className="flex items-center justify-between gap-[var(--ow-space-3)]">
            <button type="button" className={secondaryButtonClassName} onClick={onBack}>
              <Trash2 className="h-4 w-4" />
              取消
            </button>
            <Button type="button" disabled={!canSave || saving} onClick={handleSubmit}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : submitLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function InlineError(props: { text: string }): React.JSX.Element {
  return (
    <div className="flex items-start gap-[var(--ow-space-2)] rounded-[var(--ow-radius-md)] border border-destructive/30 bg-destructive/10 px-[var(--ow-space-3)] py-[var(--ow-space-2)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-body)] text-destructive">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{props.text}</span>
    </div>
  )
}

function getProviderIdFromModelId(modelId: string): ProviderId | null {
  const separatorIndex = modelId.indexOf(":")
  return separatorIndex > 0 ? modelId.slice(0, separatorIndex) : null
}

function getModelNameFromId(modelId: string): string | null {
  const separatorIndex = modelId.indexOf(":")
  return separatorIndex > 0 && separatorIndex < modelId.length - 1
    ? modelId.slice(separatorIndex + 1)
    : null
}

function modelLooksReasoning(modelId: string): boolean {
  const normalized = modelId.toLowerCase()
  return (
    /^o\d/.test(normalized) ||
    normalized.includes("reasoner") ||
    normalized.includes("reasoning") ||
    normalized.includes("thinking") ||
    normalized.includes("gpt-5") ||
    normalized.includes("claude-4") ||
    normalized.includes("deepseek-v4") ||
    normalized.includes("gemini-2.5") ||
    normalized.includes("gemini-3") ||
    normalized.startsWith("qwq-")
  )
}
