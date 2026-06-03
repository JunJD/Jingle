import { useEffect, useMemo, useState } from "react"
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

const THINKING_EFFORT_OPTIONS: Array<{ label: string; value: ThinkingEffort }> = [
  { label: "Off - No extended thinking", value: "off" },
  { label: "Low - Minimal thinking, fastest responses", value: "low" },
  { label: "Medium - Moderate thinking", value: "medium" },
  { label: "High - Deep reasoning (default)", value: "high" },
  { label: "Max - No constraints on thinking depth", value: "max" }
]

export interface ModelSetupSurfaceProps {
  activeProviderId: ProviderId | null
  defaultModelId: string
  defaultModelOptions: DefaultModelOptions["llm"]
  focusProviderId?: ProviderId | null
  modelProviderPaths?: ModelProviderPaths | null
  models: ModelConfig[]
  onCreateCustomProvider: (provider: CustomProviderInput) => Promise<ProviderId>
  onFocusProviderConsumed?: () => void
  onRefresh: () => Promise<void>
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
    onCreateCustomProvider,
    onFocusProviderConsumed,
    onRefresh,
    onSelectModel,
    providers,
    title = "欢迎使用 Jingle",
    variant
  } = props
  const [mode, setMode] = useState<SetupMode>(
    variant === "onboarding" ? "landing" : "settings-home"
  )
  const [query, setQuery] = useState("")
  const [switchOpen, setSwitchOpen] = useState(false)
  const [switchInitialProviderId, setSwitchInitialProviderId] = useState<ProviderId | null>(null)
  const [editor, setEditor] = useState<ProviderEditorState>({ kind: "closed" })
  const [editorLoadingProviderId, setEditorLoadingProviderId] = useState<ProviderId | null>(null)
  const [providerPageError, setProviderPageError] = useState<string | null>(null)
  const focusedProvider = focusProviderId
    ? (providers.find((provider) => provider.id === focusProviderId) ?? null)
    : null
  const effectiveMode: SetupMode = focusedProvider ? "providers" : mode

  const currentModel = models.find((model) => model.id === defaultModelId) ?? null
  const currentProvider = currentModel
    ? (providers.find((provider) => provider.id === currentModel.provider) ?? null)
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

      return `${provider.name} ${provider.description?.zh_Hans ?? ""} ${provider.description?.en_US ?? ""}`
        .toLowerCase()
        .includes(normalizedQuery)
    })
    .sort((left, right) => left.name.localeCompare(right.name))

  function openSwitchDialog(providerId?: ProviderId | null): void {
    setSwitchInitialProviderId(providerId ?? currentProvider?.id ?? activeProviderId)
    setSwitchOpen(true)
  }

  async function handleProviderConfigured(providerId: ProviderId): Promise<void> {
    await onRefresh()
    setSwitchInitialProviderId(providerId)
    setSwitchOpen(true)
  }

  function closeProviderEditor(): void {
    setEditor({ kind: "closed" })
  }

  function closeProviderSettingsPage(): void {
    onFocusProviderConsumed?.()
    setMode(variant === "onboarding" ? "landing" : "settings-home")
  }

  async function openProviderEditor(provider: Provider): Promise<void> {
    onFocusProviderConsumed?.()
    setProviderPageError(null)

    if (provider.source === "custom") {
      setEditorLoadingProviderId(provider.id)
      try {
        const config = await window.api.models.getCustomProvider(provider.id)
        if (!config) {
          throw new Error(`Custom provider is not configured: ${provider.name}`)
        }
        setEditor({ config, kind: "custom", provider })
      } catch (error) {
        setProviderPageError(error instanceof Error ? error.message : String(error))
      } finally {
        setEditorLoadingProviderId(null)
      }
      return
    }

    if (provider.providerCredentialSchema.credentialFormSchemas.length > 0) {
      setEditor({ kind: "credentials", provider })
      return
    }

    setEditor({ kind: "activation", provider })
  }

  return (
    <div className={cn("w-full", variant === "onboarding" ? "min-h-screen bg-background" : "")}>
      <div
        className={cn(
          "mx-auto w-full max-w-[860px]",
          variant === "onboarding"
            ? "px-[calc(var(--window-controls-offset-inline)+18px)] pb-16 pt-[120px]"
            : "space-y-[var(--ow-space-5)]"
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
            onConfigureProvider={() => setMode("providers")}
            onSwitchModels={() => openSwitchDialog()}
          />
        )}

        {effectiveMode === "landing" ? (
          <LandingChoices
            onChooseFree={() => setMode("free")}
            onChooseProvider={() => setMode("providers")}
          />
        ) : null}

        {effectiveMode === "free" ? (
          <FreeProviderGrid
            defaultModelId={defaultModelId}
            models={models}
            providers={freeProviders}
            onBack={() => setMode("landing")}
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
            providers={visibleProviders}
            query={query}
            title="提供商配置项"
            onAddCustom={() => setMode("custom")}
            onBack={closeProviderSettingsPage}
            onConfigureProvider={(provider) => void openProviderEditor(provider)}
            onQueryChange={setQuery}
            onSwitchModel={(providerId) => openSwitchDialog(providerId)}
          />
        ) : null}

        {effectiveMode === "custom" ? (
          <CustomProviderForm
            modelProviderPaths={modelProviderPaths}
            onBack={() => setMode("providers")}
            onSubmit={async (input) => {
              const providerId = await onCreateCustomProvider(input)
              await handleProviderConfigured(providerId)
              setMode("providers")
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
          setSwitchOpen(false)
          setMode("providers")
        }}
        onOpenChange={setSwitchOpen}
        onRefresh={onRefresh}
        onSelectModel={onSelectModel}
      />

      <ProviderEditorDialogs
        activeProviderId={activeProviderId}
        editor={editor}
        modelProviderPaths={modelProviderPaths}
        onClose={closeProviderEditor}
        onConfigured={handleProviderConfigured}
        onRefresh={onRefresh}
        onSelectModel={onSelectModel}
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

  return (
    <div className="rounded-[var(--ow-settings-card-radius)] border border-border bg-background-secondary/60 px-[var(--ow-space-4)] py-[var(--ow-space-4)]">
      <div className="flex flex-col gap-[var(--ow-space-4)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-[var(--ow-space-3)]">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--ow-radius-md)] border border-border bg-background-elevated text-foreground">
            <ProviderLogo
              providerId={currentProvider?.id ?? activeProviderId ?? "openai"}
              className="h-5 w-5"
            />
          </div>
          <div className="min-w-0">
            <div className="[font-size:var(--ow-font-title)] font-semibold text-foreground">
              {currentModel?.name ?? getModelNameFromId(currentModel?.id ?? "") ?? "尚未选择模型"}
            </div>
            <div className="mt-0.5 truncate [font-size:var(--ow-font-body)] text-muted-foreground">
              {currentProvider?.name ?? "选择一个 provider 后即可开始"}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 gap-[var(--ow-gap-sm)]">
          <Button type="button" variant="outline" onClick={onSwitchModels}>
            切换模型
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
  onAddCustom: () => void
  onBack: () => void
  onConfigureProvider: (provider: Provider) => void
  onQueryChange: (query: string) => void
  onSwitchModel: (providerId: ProviderId) => void
  providers: Provider[]
  query: string
  title: string
}): React.JSX.Element {
  return (
    <div className="space-y-[var(--ow-space-7)]">
      <div className="border-b border-border pb-[var(--ow-space-7)]">
        <button
          type="button"
          className="inline-flex h-9 items-center gap-[var(--ow-space-2)] rounded-full bg-background-secondary px-[var(--ow-space-3)] [font-size:var(--ow-font-body)] text-muted-foreground transition hover:bg-background-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={props.onBack}
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </button>
        <h1 className="mt-[var(--ow-space-6)] [font-size:34px] font-light leading-tight tracking-normal text-foreground">
          {props.title}
        </h1>
      </div>

      <div className="flex justify-end">
        <div className="relative w-full sm:w-[280px]">
          <Search className="pointer-events-none absolute left-[var(--ow-space-3)] top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="min-h-[var(--ow-settings-control-h)] w-full rounded-[var(--ow-radius-md)] border border-border bg-background-elevated px-[var(--ow-space-3)] py-[var(--ow-space-1)] pl-9 [font-size:var(--ow-settings-control-font)] outline-none transition focus:border-[var(--ring)]"
            placeholder="搜索 provider"
            value={props.query}
            onChange={(event) => props.onQueryChange(event.target.value)}
          />
        </div>
      </div>

      {props.errorText ? <InlineError text={props.errorText} /> : null}

      <div className="grid justify-center gap-[var(--ow-space-4)] [grid-template-columns:repeat(auto-fill,minmax(198px,198px))]">
        {props.providers.map((provider) => (
          <ProviderCard
            key={provider.id}
            loading={props.editorLoadingProviderId === provider.id}
            provider={provider}
            onConfigure={() => props.onConfigureProvider(provider)}
            onSwitchModel={() => props.onSwitchModel(provider.id)}
          />
        ))}
        <button
          type="button"
          className="flex min-h-[164px] flex-col items-center justify-center gap-[var(--ow-space-2)] rounded-[var(--ow-settings-card-radius)] border border-dashed border-border bg-background text-muted-foreground transition hover:border-border-emphasis hover:bg-background-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={props.onAddCustom}
        >
          <Plus className="h-5 w-5" />
          <span className="[font-size:var(--ow-font-body)] font-medium">添加自定义 provider</span>
        </button>
      </div>
    </div>
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
                  {selected ? <Check className="h-4 w-4 text-status-success" /> : null}
                </span>
                <span className="mt-[var(--ow-space-1)] block [font-size:var(--ow-font-body)] leading-[var(--ow-line-body)] text-muted-foreground">
                  {provider.description?.zh_Hans ??
                    provider.description?.en_US ??
                    "本地模型 provider"}
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
  onConfigure: () => void
  onSwitchModel: () => void
  provider: Provider
}): React.JSX.Element {
  const { loading, onConfigure, onSwitchModel, provider } = props
  const configured = provider.customConfiguration.status === "active"

  return (
    <div className="flex min-h-[164px] flex-col justify-between rounded-[var(--ow-settings-card-radius)] border border-border bg-background-elevated p-[var(--ow-space-3)] text-left transition hover:border-border-emphasis hover:bg-background-secondary">
      <div className="flex w-full items-start justify-between gap-[var(--ow-space-2)]">
        {configured ? <Check className="ml-auto h-4 w-4 text-status-success" /> : null}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-[var(--ow-space-2)]">
          <ProviderLogo providerId={provider.id} className="h-5 w-5 shrink-0 text-foreground" />
          <div className="truncate [font-size:var(--ow-font-title)] font-medium text-foreground">
            {provider.name}
          </div>
        </div>
        <div className="mt-[var(--ow-space-2)] line-clamp-3 min-h-[54px] [font-size:var(--ow-font-body)] leading-[var(--ow-line-body)] text-muted-foreground">
          {provider.description?.zh_Hans ?? provider.description?.en_US ?? "自定义 provider"}
        </div>
      </div>
      <div className="mt-[var(--ow-space-3)] flex items-center gap-[var(--ow-space-2)]">
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
            模型
          </button>
        ) : null}
      </div>
    </div>
  )
}

function ProviderEditorDialogs(props: {
  activeProviderId: ProviderId | null
  editor: ProviderEditorState
  modelProviderPaths?: ModelProviderPaths | null
  onClose: () => void
  onConfigured: (providerId: ProviderId) => Promise<void>
  onRefresh: () => Promise<void>
  onSelectModel: (modelId: string, options?: SetDefaultModelOptions) => Promise<void>
}): React.JSX.Element | null {
  const { activeProviderId, editor, modelProviderPaths, onClose, onConfigured, onRefresh } = props

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
        onRefresh={onRefresh}
      />
    )
  }

  return (
    <ProviderActivationDialog
      provider={editor.provider}
      onClose={onClose}
      onConfigured={async (providerId) => {
        onClose()
        await onConfigured(providerId)
      }}
      onSelectModel={props.onSelectModel}
    />
  )
}

function ProviderCredentialsDialog(props: {
  activeProviderId: ProviderId | null
  onClose: () => void
  onConfigured: (providerId: ProviderId) => Promise<void>
  onRefresh: () => Promise<void>
  provider: Provider
}): React.JSX.Element {
  const { activeProviderId, onClose, onConfigured, onRefresh, provider } = props
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
      await window.api.models.setCredentials(provider.id, credentials)
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
      await window.api.models.deleteCredentials(provider.id)
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
            const label = schema.label.zh_Hans || schema.label.en_US || schema.name
            const placeholder = schema.placeholder?.zh_Hans ?? schema.placeholder?.en_US
            return (
              <SettingsField key={schema.variable} label={label} required={schema.required}>
                {schema.type === "secret-input" ? (
                  <SettingsPasswordInput
                    value={credentials[schema.variable] ?? ""}
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
                    value={credentials[schema.variable] ?? ""}
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
  onClose: () => void
  onConfigured: (providerId: ProviderId) => Promise<void>
  onSelectModel: (modelId: string, options?: SetDefaultModelOptions) => Promise<void>
  provider: Provider
}): React.JSX.Element {
  const { onClose, onConfigured, onSelectModel, provider } = props
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
      const response = await window.api.models.listByProvider(provider.id, "llm")
      const firstModel = response.models[0]
      if (!firstModel) {
        throw new Error(`Provider has no available model: ${provider.name}`)
      }
      await onSelectModel(firstModel.id, {
        thinkingEffort: firstModel.reasoning ? "high" : null
      })
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
            {provider.description?.zh_Hans ??
              provider.description?.en_US ??
              "此 provider 不需要凭据。"}
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

  const currentProviderId = getProviderIdFromModelId(currentModelId)
  const initialSelectedProviderId =
    initialProviderId ?? currentProviderId ?? providerOptions[0]?.id ?? ""

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
  const [selectedProviderId, setSelectedProviderId] =
    useState<ProviderId>(initialSelectedProviderId)
  const [selectedModelValue, setSelectedModelValue] = useState("")
  const [customModelName, setCustomModelName] = useState("")
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort>(
    defaultModelOptions.thinkingEffort ?? "off"
  )
  const [providerModels, setProviderModels] = useState<ModelConfig[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? null
  const customMode = selectedModelValue === "__custom__"
  const selectedModelName = customMode ? customModelName.trim() : selectedModelValue
  const selectedModelConfig =
    providerModels.find(
      (model) => model.model === selectedModelName || model.id === selectedModelName
    ) ??
    models.find((model) => model.id === `${selectedProviderId}:${selectedModelName}`) ??
    null
  const reasoningEnabled =
    selectedModelConfig?.reasoning ??
    (selectedModelName ? modelLooksReasoning(selectedModelName) : false)
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
      setLoadingModels(true)
      setErrorText(null)
      try {
        const response = await window.api.models.listByProvider(selectedProviderId, "llm")
        if (cancelled) {
          return
        }
        setProviderModels(response.models)
        const currentModelName =
          getProviderIdFromModelId(currentModelId) === selectedProviderId
            ? getModelNameFromId(currentModelId)
            : null
        setSelectedModelValue(
          currentModelName && response.models.some((model) => model.model === currentModelName)
            ? currentModelName
            : (response.models[0]?.model ?? "")
        )
      } catch (error) {
        if (!cancelled) {
          setProviderModels([])
          setSelectedModelValue("")
          setErrorText(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (!cancelled) {
          setLoadingModels(false)
        }
      }
    }

    void loadModels()
    return () => {
      cancelled = true
    }
  }, [currentModelId, selectedProviderId])

  async function handleSave(): Promise<void> {
    if (!canSave) {
      return
    }

    setSaving(true)
    setErrorText(null)
    try {
      await onSelectModel(`${selectedProviderId}:${selectedModelName}`, {
        allowUnlisted: customMode,
        thinkingEffort: reasoningEnabled ? thinkingEffort : null
      })
      await onRefresh()
      onOpenChange(false)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="w-[var(--ow-dialog-mobile-w)] rounded-[var(--ow-radius-dialog)] sm:max-w-[500px] sm:rounded-[var(--ow-radius-dialog)]">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-[var(--ow-space-2)]">
            <SlidersHorizontal className="h-4 w-4" />
            切换模型
          </DialogTitle>
          <DialogDescription>选择用于对话的提供商和模型。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-[var(--ow-space-3)]">
          <SettingsSelect
            value={selectedProviderId}
            onChange={(event) => {
              if (event.target.value === "__configure__") {
                onConfigureProviders()
                return
              }
              setSelectedProviderId(event.target.value)
              setSelectedModelValue("")
              setCustomModelName("")
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
              setSelectedModelValue(event.target.value)
              if (event.target.value !== "__custom__") {
                setCustomModelName("")
              }
            }}
          >
            {loadingModels ? <option value="">读取模型</option> : null}
            {!loadingModels && providerModels.length === 0 ? (
              <option value="">无可用模型</option>
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
              onChange={(event) => setCustomModelName(event.target.value)}
            />
          ) : null}

          {reasoningEnabled ? (
            <SettingsField label="思考努力">
              <SettingsSelect
                value={thinkingEffort}
                onChange={(event) => setThinkingEffort(event.target.value as ThinkingEffort)}
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

function CustomProviderForm(props: {
  initialProvider?: CustomProviderConfig
  modelProviderPaths?: ModelProviderPaths | null
  onBack: () => void
  onSubmit: (input: CustomProviderInput) => Promise<void>
  submitLabel: string
  title: string | null
}): React.JSX.Element {
  const { initialProvider, modelProviderPaths, onBack, onSubmit, submitLabel, title } = props
  const [displayName, setDisplayName] = useState(() => initialProvider?.display_name ?? "")
  const [description, setDescription] = useState(() => initialProvider?.description ?? "")
  const [engine, setEngine] = useState<CustomProviderEngine>(
    () => initialProvider?.engine ?? "openai"
  )
  const [baseUrl, setBaseUrl] = useState(() => initialProvider?.base_url ?? "")
  const [basePath, setBasePath] = useState(() => initialProvider?.base_path ?? "")
  const [apiKey, setApiKey] = useState("")
  const [modelsText, setModelsText] = useState(() =>
    initialProvider ? initialProvider.models.map((model) => model.name).join(", ") : ""
  )
  const [requiresAuth, setRequiresAuth] = useState(() => initialProvider?.requires_auth ?? true)
  const [supportsStreaming, setSupportsStreaming] = useState(
    () => initialProvider?.supports_streaming ?? true
  )
  const [headers, setHeaders] = useState<Array<{ key: string; value: string }>>(() =>
    Object.entries(initialProvider?.headers ?? {}).map(([key, value]) => ({ key, value }))
  )
  const [newHeaderKey, setNewHeaderKey] = useState("")
  const [newHeaderValue, setNewHeaderValue] = useState("")
  const [saving, setSaving] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
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
      setErrorText("Header name and value are required.")
      return
    }
    if (key.includes(" ")) {
      setErrorText("Header name cannot contain spaces.")
      return
    }
    if (headers.some((header) => header.key === key)) {
      setErrorText(`Header already exists: ${key}`)
      return
    }

    setHeaders((current) => [...current, { key, value }])
    setNewHeaderKey("")
    setNewHeaderValue("")
    setErrorText(null)
  }

  async function handleSubmit(): Promise<void> {
    if (!canSave || saving) {
      return
    }

    setSaving(true)
    setErrorText(null)
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
      setErrorText(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-[var(--ow-space-4)]">
      {title ? <SectionHeader onBack={onBack} title={title} /> : null}
      <div className="rounded-[var(--ow-settings-card-radius)] border border-border bg-background-elevated p-[var(--ow-space-4)]">
        <div className="grid gap-[var(--ow-space-4)]">
          <SettingsField label="Provider Type" required>
            <SettingsSelect
              value={engine}
              onChange={(event) => setEngine(event.target.value as CustomProviderEngine)}
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
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </SettingsField>
          <SettingsField label="Description">
            <SettingsTextInput
              value={description}
              placeholder="Custom OpenAI-compatible provider."
              onChange={(event) => setDescription(event.target.value)}
            />
          </SettingsField>
          <div className="grid gap-[var(--ow-space-4)] sm:grid-cols-2">
            <SettingsField label="API URL" required={requiresBaseUrl}>
              <SettingsTextInput
                value={baseUrl}
                placeholder={
                  engine === "ollama" ? "http://localhost:11434/v1" : "https://api.example.com"
                }
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </SettingsField>
            <SettingsField label="API Base Path">
              <SettingsTextInput
                value={basePath}
                placeholder="/v1"
                onChange={(event) => setBasePath(event.target.value)}
              />
            </SettingsField>
          </div>
          <SettingsField label="Available Models" description="多个模型用英文逗号分隔" required>
            <SettingsTextInput
              value={modelsText}
              placeholder="gpt-5.5, qwen-plus"
              onChange={(event) => setModelsText(event.target.value)}
            />
          </SettingsField>
          <div className="flex items-center justify-between rounded-[var(--ow-radius-md)] border border-border bg-background-secondary px-[var(--ow-space-3)] py-[var(--ow-space-2)]">
            <span className="[font-size:var(--ow-font-body)] text-foreground">
              This provider requires an API key
            </span>
            <SettingsSwitch
              checked={requiresAuth}
              label="This provider requires an API key"
              onCheckedChange={setRequiresAuth}
            />
          </div>
          {requiresAuth ? (
            <SettingsField label="API Key" required={!initialProvider}>
              <SettingsPasswordInput
                value={apiKey}
                placeholder={initialProvider ? "保留现有 API Key" : "sk-..."}
                showLabel="显示"
                hideLabel="隐藏"
                onChange={(event) => setApiKey(event.target.value)}
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
              onCheckedChange={setSupportsStreaming}
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
                      setHeaders((current) => current.filter((item) => item.key !== header.key))
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
                  onChange={(event) => setNewHeaderKey(event.target.value)}
                />
                <SettingsTextInput
                  value={newHeaderValue}
                  placeholder="Value"
                  onChange={(event) => setNewHeaderValue(event.target.value)}
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
