import { useState, useEffect } from "react"
import { ChevronDown, Check, AlertCircle, Key, Cloud } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { useCurrentThread } from "@/lib/thread-context"
import { cn } from "@/lib/utils"
import type { Provider, ProviderId } from "@/types"
import { useI18n } from "@/lib/i18n"

// Provider icons as simple SVG components
function AnthropicIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.304 3.541h-3.672l6.696 16.918h3.672l-6.696-16.918zm-10.608 0L0 20.459h3.744l1.368-3.562h7.044l1.368 3.562h3.744L10.608 3.541H6.696zm.576 10.852l2.352-6.122 2.352 6.122H7.272z" />
    </svg>
  )
}

function OpenAIIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  )
}

function GoogleIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" />
    </svg>
  )
}

function DashScopeIcon({ className }: { className?: string }): React.JSX.Element {
  return <Cloud className={className} />
}

const PROVIDER_ICONS: Record<ProviderId, React.FC<{ className?: string }>> = {
  anthropic: AnthropicIcon,
  openai: OpenAIIcon,
  google: GoogleIcon,
  dashscope: DashScopeIcon
}

interface ModelSwitcherProps {
  threadId: string
}

export function ModelSwitcher({ threadId }: ModelSwitcherProps): React.JSX.Element {
  const { copy } = useI18n()
  const [open, setOpen] = useState(false)
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId | null>(null)

  const { models, providers, loadModelProviderState } = useHistoryShellStore()
  const { currentModel, setCurrentModel } = useCurrentThread(threadId)

  // Load models and providers on mount
  useEffect(() => {
    void loadModelProviderState()
  }, [loadModelProviderState])

  // Determine effective provider ID (manual selection > current model > default)
  const effectiveProviderId =
    selectedProviderId ||
    (currentModel ? models.find((m) => m.id === currentModel)?.provider : null) ||
    (providers.length > 0 ? providers[0].id : null)

  const selectedModel = models.find((m) => m.id === currentModel)
  const filteredModels = effectiveProviderId
    ? models.filter((m) => m.provider === effectiveProviderId)
    : []
  const selectedProvider = providers.find((p) => p.id === effectiveProviderId)
  const selectedProviderConfigured = selectedProvider?.customConfiguration.status === "active"

  function handleProviderClick(provider: Provider): void {
    setSelectedProviderId(provider.id)
  }

  function handleModelSelect(modelId: string): void {
    setCurrentModel(modelId)
    setOpen(false)
  }

  function handleOpenProviderSettings(provider: Provider): void {
    setOpen(false)
    void window.electron.openSettingsTab("provider", { providerId: provider.id })
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) {
          void loadModelProviderState()
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 rounded-full bg-background-secondary px-3 text-xs text-muted-foreground hover:bg-background-interactive hover:text-foreground"
        >
          {selectedModel ? (
            <>
              {PROVIDER_ICONS[selectedModel.provider]({ className: "size-3.5" })}
              <span className="font-mono">{selectedModel.model}</span>
            </>
          ) : (
            <span>{copy.modelSwitcher.selectModel}</span>
          )}
          <ChevronDown className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[420px] border-border bg-popover p-0"
        align="start"
        sideOffset={8}
      >
        <div className="flex min-h-[240px]">
          <div className="w-[140px] border-r border-border p-2 bg-background/35">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 py-1.5">
              {copy.modelSwitcher.provider}
            </div>
            <div className="space-y-0.5">
              {providers.map((provider) => {
                const Icon = PROVIDER_ICONS[provider.id]
                return (
                  <button
                    key={provider.id}
                    onClick={() => handleProviderClick(provider)}
                    className={cn(
                      "w-full rounded-[10px] px-2 py-1 text-left text-xs transition-colors",
                      effectiveProviderId === provider.id
                        ? "bg-background-secondary text-foreground"
                        : "text-muted-foreground hover:bg-background-secondary/70 hover:text-foreground"
                    )}
                  >
                    {Icon && <Icon className="size-3.5 shrink-0" />}
                    <span className="flex-1 truncate">{provider.name}</span>
                    {provider.modelListStatus !== "active" && (
                      <AlertCircle
                        className={cn(
                          "size-3 shrink-0",
                          provider.modelListStatus === "error"
                            ? "text-destructive"
                            : "text-status-warning"
                        )}
                      />
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex-1 p-2">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 py-1.5">
              {copy.modelSwitcher.model}
            </div>

            {selectedProvider?.modelListStatus === "error" ? (
              <div className="flex h-[180px] flex-col items-center justify-center px-4 text-center">
                <AlertCircle className="mb-2 size-6 text-destructive" />
                <p className="mb-1 text-xs font-medium text-foreground">
                  {copy.modelSwitcher.providerError(selectedProvider.name)}
                </p>
                <p className="mb-3 max-w-[220px] truncate text-xs text-muted-foreground">
                  {selectedProvider.modelListError}
                </p>
                <Button size="sm" onClick={() => handleOpenProviderSettings(selectedProvider)}>
                  {copy.modelSwitcher.editApiKey}
                </Button>
              </div>
            ) : selectedProvider && !selectedProviderConfigured ? (
              <div className="flex flex-col items-center justify-center h-[180px] px-4 text-center">
                <Key className="size-6 text-muted-foreground mb-2" />
                <p className="text-xs text-muted-foreground mb-3">
                  {copy.modelSwitcher.apiKeyRequired(selectedProvider.name)}
                </p>
                <Button size="sm" onClick={() => handleOpenProviderSettings(selectedProvider)}>
                  {copy.modelSwitcher.configureApiKey}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col h-[200px]">
                <div className="overflow-y-auto flex-1 space-y-0.5">
                  {filteredModels.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => handleModelSelect(model.id)}
                      className={cn(
                        "w-full rounded-[10px] px-2 py-1 text-left text-xs font-mono transition-colors",
                        currentModel === model.id
                          ? "bg-background-secondary text-foreground"
                          : "text-muted-foreground hover:bg-background-secondary/70 hover:text-foreground"
                      )}
                    >
                      <span className="flex-1 truncate">{model.model}</span>
                      {currentModel === model.id && (
                        <Check className="size-3.5 shrink-0 text-foreground" />
                      )}
                    </button>
                  ))}

                  {filteredModels.length === 0 && (
                    <p className="text-xs text-muted-foreground px-2 py-4">
                      {copy.modelSwitcher.noModelsAvailable}
                    </p>
                  )}
                </div>

                {selectedProviderConfigured && (
                  <button
                    onClick={() => handleOpenProviderSettings(selectedProvider)}
                    className="mt-2 w-full rounded-[10px] border-t border-border px-2 pt-2 text-left text-xs text-muted-foreground transition-colors hover:bg-background-secondary/70 hover:text-foreground"
                  >
                    <Key className="mr-2 inline size-3.5" />
                    <span>{copy.modelSwitcher.editApiKey}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
