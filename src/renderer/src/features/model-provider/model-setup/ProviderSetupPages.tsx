import type { ReactNode } from "react"
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  Gift,
  KeyRound,
  Plus,
  Search,
  SlidersHorizontal
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProviderLogo } from "@/components/model-provider-logo"
import { cn } from "@/lib/utils"
import type { ProviderId } from "@shared/app-types"
import type { ModelSetupModel, ModelSetupProvider } from "@shared/model-setup"
import {
  getProviderDescription,
  getProviderReadiness,
  type ProviderReadiness
} from "./model-setup-projection"

export function LandingChoices(props: {
  onChooseFree: () => void
  onChooseProvider: () => void
}): React.JSX.Element {
  return (
    <div className="grid gap-[var(--jingle-space-4)] sm:grid-cols-2">
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
  icon: ReactNode
  onClick: () => void
  title: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="group flex min-h-[110px] w-full items-start gap-[var(--jingle-space-4)] rounded-[var(--jingle-settings-card-radius)] border border-border bg-background-elevated px-[var(--jingle-space-4)] py-[var(--jingle-space-4)] text-left transition hover:border-border-emphasis hover:bg-background-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onClick={props.onClick}
    >
      <span className="mt-0.5 text-muted-foreground group-hover:text-foreground">{props.icon}</span>
      <span className="min-w-0">
        <span className="block [font-size:var(--jingle-font-title)] font-medium text-foreground">
          {props.title}
        </span>
        <span className="mt-[var(--jingle-space-1)] block [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-body)] text-muted-foreground">
          {props.description}
        </span>
      </span>
    </button>
  )
}

export function CurrentModelPanel(props: {
  currentModel: ModelSetupModel
  currentProvider: ModelSetupProvider
  onConfigureProvider: () => void
  onSwitchModels: () => void
}): React.JSX.Element {
  const { currentModel, currentProvider, onConfigureProvider, onSwitchModels } = props

  return (
    <div className="rounded-[var(--jingle-settings-card-radius)] border border-border bg-background-secondary/60 px-[var(--jingle-space-4)] py-[var(--jingle-space-4)]">
      <div className="flex flex-col gap-[var(--jingle-space-4)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-[var(--jingle-space-3)]">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--jingle-radius-md)] border border-border bg-background-elevated text-foreground">
            <ProviderLogo providerId={currentProvider.id} className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="mb-0.5 [font-size:var(--jingle-font-caption)] font-medium text-muted-foreground">
              新线程默认模型
            </div>
            <div className="[font-size:var(--jingle-font-title)] font-semibold text-foreground">
              {currentModel.name}
            </div>
            <div className="mt-0.5 truncate [font-size:var(--jingle-font-body)] text-muted-foreground">
              {currentProvider.name}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 gap-[var(--jingle-gap-sm)]">
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

export function ProviderSettingsPage(props: {
  editorLoadingProviderId: ProviderId | null
  errorText: string | null
  models: ModelSetupModel[]
  onAddCustom: () => void
  onBack: () => void
  onConfigureProvider: (provider: ModelSetupProvider) => void
  onQueryChange: (query: string) => void
  onSwitchModel: (providerId: ProviderId) => void
  providers: ModelSetupProvider[]
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
    <div className="space-y-[var(--jingle-space-6)]">
      <div className="border-b border-border pb-[var(--jingle-space-5)]">
        <button
          type="button"
          className="inline-flex h-8 items-center gap-[var(--jingle-space-2)] rounded-[var(--jingle-radius-md)] bg-background-secondary px-[var(--jingle-space-3)] [font-size:var(--jingle-font-body)] text-muted-foreground transition hover:bg-background-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={props.onBack}
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </button>
        <div className="mt-[var(--jingle-space-5)] flex flex-col gap-[var(--jingle-space-4)] sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="[font-size:28px] font-normal leading-tight tracking-normal text-foreground">
              {props.title}
            </h1>
            <div className="mt-[var(--jingle-space-2)] flex flex-wrap items-center gap-[var(--jingle-space-2)] [font-size:var(--jingle-font-caption)] text-muted-foreground">
              <ProviderCountBadge label="已可用" value={configuredProviders.length} />
              <ProviderCountBadge label="待处理" value={availableProviders.length} />
            </div>
          </div>
          <div className="flex w-full flex-col gap-[var(--jingle-space-2)] sm:w-auto sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-[260px]">
              <Search className="pointer-events-none absolute left-[var(--jingle-space-3)] top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                aria-label="搜索 provider"
                className="min-h-[var(--jingle-settings-control-h)] w-full rounded-[var(--jingle-radius-md)] border border-border bg-background-elevated px-[var(--jingle-space-3)] py-[var(--jingle-space-1)] pl-9 [font-size:var(--jingle-settings-control-font)] outline-none transition focus:border-[var(--ring)]"
                placeholder="搜索 provider"
                value={props.query}
                onChange={(event) => props.onQueryChange(event.target.value)}
              />
            </div>
            <button
              type="button"
              className="inline-flex h-[var(--jingle-settings-control-h)] shrink-0 items-center justify-center gap-[var(--jingle-space-2)] rounded-[var(--jingle-radius-md)] border border-border bg-background-elevated px-[var(--jingle-space-3)] [font-size:var(--jingle-font-body)] font-medium text-foreground transition hover:bg-background-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
        <div className="rounded-[var(--jingle-radius-md)] border border-dashed border-border bg-background-secondary px-[var(--jingle-space-4)] py-[var(--jingle-space-6)] text-center [font-size:var(--jingle-font-body)] text-muted-foreground">
          没有匹配的 provider
        </div>
      ) : null}
    </div>
  )
}

function ProviderCountBadge(props: { label: string; value: number }): React.JSX.Element {
  return (
    <span className="inline-flex h-6 items-center gap-[var(--jingle-space-1)] rounded-full border border-border bg-background-secondary px-[var(--jingle-space-2)]">
      <span>{props.label}</span>
      <span className="font-mono text-foreground">{props.value}</span>
    </span>
  )
}

function ProviderSection(props: {
  editorLoadingProviderId: ProviderId | null
  models: ModelSetupModel[]
  onConfigureProvider: (provider: ModelSetupProvider) => void
  onSwitchModel: (providerId: ProviderId) => void
  providers: ModelSetupProvider[]
  title: string
}): React.JSX.Element {
  return (
    <section className="space-y-[var(--jingle-space-3)]">
      <div className="flex items-center gap-[var(--jingle-space-2)]">
        <h2 className="[font-size:var(--jingle-font-title)] font-semibold text-foreground">
          {props.title}
        </h2>
        <span className="rounded-full bg-background-secondary px-[var(--jingle-space-2)] py-[2px] [font-size:var(--jingle-font-caption)] font-mono text-muted-foreground">
          {props.providers.length}
        </span>
      </div>
      <div className="grid gap-[var(--jingle-space-2)]">
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

export function FreeProviderGrid(props: {
  defaultModelId: string
  models: ModelSetupModel[]
  onBack: () => void
  onConfigureProvider: (providerId: ProviderId) => void
  providers: ModelSetupProvider[]
}): React.JSX.Element {
  const { defaultModelId, models, onBack, onConfigureProvider, providers } = props

  return (
    <div className="space-y-[var(--jingle-space-4)]">
      <SectionHeader onBack={onBack} title="免费/本地提供商" />
      <div className="grid gap-[var(--jingle-space-3)] sm:grid-cols-2">
        {providers.map((provider) => {
          const providerModels = models.filter((model) => model.provider === provider.id)
          const selected = providerModels.some((model) => model.id === defaultModelId)
          return (
            <button
              key={provider.id}
              type="button"
              className="flex min-h-[132px] items-start gap-[var(--jingle-space-3)] rounded-[var(--jingle-settings-card-radius)] border border-border bg-background-elevated p-[var(--jingle-space-4)] text-left transition hover:border-border-emphasis hover:bg-background-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => onConfigureProvider(provider.id)}
            >
              <ProviderLogo
                providerId={provider.id}
                className="mt-1 h-5 w-5 shrink-0 text-foreground"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-[var(--jingle-gap-sm)] [font-size:var(--jingle-font-title)] font-medium text-foreground">
                  {provider.name}
                  {selected ? <Check className="h-4 w-4 text-status-nominal" /> : null}
                </span>
                <span className="mt-[var(--jingle-space-1)] block [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-body)] text-muted-foreground">
                  {getProviderDescription(provider)}
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
  models: ModelSetupModel[]
  onConfigure: () => void
  onSwitchModel: () => void
  provider: ModelSetupProvider
}): React.JSX.Element {
  const { loading, models, onConfigure, onSwitchModel, provider } = props
  const readiness = getProviderReadiness(provider, models)
  const configured = provider.customConfiguration.status === "active"

  return (
    <div className="group flex min-h-[92px] flex-col gap-[var(--jingle-space-3)] rounded-[var(--jingle-radius-md)] border border-border bg-background-elevated px-[var(--jingle-space-4)] py-[var(--jingle-space-3)] text-left transition hover:border-border-emphasis hover:bg-background-secondary sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-[var(--jingle-space-3)]">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--jingle-radius-md)] border border-border bg-background text-foreground">
          <ProviderLogo providerId={provider.id} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-[var(--jingle-space-2)]">
            <div className="truncate [font-size:var(--jingle-font-title)] font-medium text-foreground">
              {provider.name}
            </div>
            <ProviderStatusPill readiness={readiness} />
          </div>
          <div className="mt-[var(--jingle-space-1)] line-clamp-2 [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-body)] text-muted-foreground">
            {getProviderDescription(provider)}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-[var(--jingle-space-2)] pl-[52px] sm:pl-0">
        <Button
          type="button"
          className="h-8 gap-[var(--jingle-space-1)] bg-background px-[var(--jingle-space-3)] [font-size:var(--jingle-font-body)]"
          loading={loading}
          loadingLabel={configured ? "正在读取 provider 配置" : "正在准备 provider 配置"}
          onClick={onConfigure}
          size="sm"
          variant="outline"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {configured ? "编辑" : "配置"}
        </Button>
        {configured ? (
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-[var(--jingle-radius-md)] border border-border bg-background px-[var(--jingle-space-3)] [font-size:var(--jingle-font-body)] font-medium text-muted-foreground transition hover:bg-background-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={onSwitchModel}
          >
            {readiness === "needs-models" ? "检测" : "切换"}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function ProviderStatusPill(props: { readiness: ProviderReadiness }): React.JSX.Element {
  const label = getProviderReadinessLabel(props.readiness)
  const icon = props.readiness === "ready" ? <Check className="h-3 w-3" /> : null

  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-[var(--jingle-space-1)] rounded-full border px-[var(--jingle-space-2)] [font-size:var(--jingle-font-caption)]",
        getProviderReadinessClassName(props.readiness)
      )}
    >
      {icon}
      {label}
    </span>
  )
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

export function SectionHeader(props: {
  backDisabled?: boolean
  onBack?: () => void
  title: string
  trailing?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-[var(--jingle-space-3)] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-[var(--jingle-space-2)]">
        {props.onBack ? (
          <button
            type="button"
            aria-label="返回"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--jingle-radius-md)] text-muted-foreground transition hover:bg-background-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50"
            disabled={props.backDisabled}
            onClick={props.onBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : null}
        <h2 className="[font-size:var(--jingle-settings-title-size)] font-semibold text-foreground">
          {props.title}
        </h2>
      </div>
      {props.trailing}
    </div>
  )
}

export function InlineError(props: { text: string }): React.JSX.Element {
  return (
    <div className="flex items-start gap-[var(--jingle-space-2)] rounded-[var(--jingle-radius-md)] border border-destructive/30 bg-destructive/10 px-[var(--jingle-space-3)] py-[var(--jingle-space-2)] [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-body)] text-destructive">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{props.text}</span>
    </div>
  )
}
