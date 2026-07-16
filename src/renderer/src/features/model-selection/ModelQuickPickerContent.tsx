import { Search } from "lucide-react"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { InlineNotice } from "@/components/ui/inline-notice"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { ProviderId } from "@/types"
import {
  projectModelQuickPicker,
  type ModelSelectionCatalogProjection,
  type ModelSelectionLoadState
} from "./model-selection-projection"
import { ProviderIcon } from "./provider-icon"

export function ModelQuickPickerContent(props: {
  catalog: ModelSelectionCatalogProjection
  currentModelId: string | null
  loadState: ModelSelectionLoadState
  onOpenProviderSettings: (providerId: ProviderId) => void
  onRetry: () => Promise<void>
  onSelectModel: (modelId: string) => void
}): React.JSX.Element {
  const { catalog, currentModelId, loadState, onOpenProviderSettings, onRetry, onSelectModel } =
    props
  const { copy } = useI18n()
  const [searchQuery, setSearchQuery] = useState("")
  const projection = useMemo(
    () => projectModelQuickPicker(catalog, currentModelId, searchQuery),
    [catalog, currentModelId, searchQuery]
  )
  const notice = projection.notice

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-[var(--jingle-space-1)]">
        {loadState === "loading" ? (
          <div
            aria-live="polite"
            className="flex items-center justify-center gap-[var(--jingle-gap-sm)] px-[var(--jingle-space-3)] py-[var(--jingle-space-6)] [font-size:var(--jingle-font-meta)] text-muted-foreground"
            role="status"
          >
            <Spinner />
            <span>{copy.modelSwitcher.loading}</span>
          </div>
        ) : loadState === "error" ? (
          <InlineNotice
            className="m-[var(--jingle-space-2)] flex items-center justify-between gap-[var(--jingle-space-2)]"
            tone="critical"
          >
            <span>{copy.modelSwitcher.loadError}</span>
            <Button size="sm" variant="outline" onClick={() => void onRetry()}>
              {copy.modelSwitcher.retry}
            </Button>
          </InlineNotice>
        ) : (
          <>
            {notice.kind === "catalog-error" ? (
              <InlineNotice className="m-[var(--jingle-space-2)]" tone="critical">
                {copy.modelSwitcher.catalogError}
              </InlineNotice>
            ) : null}
            {notice.kind === "configuration-required" ? (
              <InlineNotice
                className="m-[var(--jingle-space-2)] flex items-center justify-between gap-[var(--jingle-space-2)]"
                tone="neutral"
              >
                <span>{copy.modelSwitcher.apiKeyRequired(notice.providerName)}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenProviderSettings(notice.providerId)}
                >
                  {copy.modelSwitcher.configureApiKey}
                </Button>
              </InlineNotice>
            ) : null}
            {notice.kind === "discovery-required" ? (
              <InlineNotice
                className="m-[var(--jingle-space-2)] flex items-center justify-between gap-[var(--jingle-space-2)]"
                tone="neutral"
              >
                <span>{copy.modelSwitcher.modelDiscoveryPending}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenProviderSettings(notice.providerId)}
                >
                  {copy.modelSwitcher.openProviderSettings}
                </Button>
              </InlineNotice>
            ) : null}
            {notice.kind === "provider-error" ? (
              <InlineNotice
                className="m-[var(--jingle-space-2)] flex items-center justify-between gap-[var(--jingle-space-2)]"
                tone="critical"
              >
                <span className="min-w-0">
                  <span>{copy.modelSwitcher.providerError(notice.providerName)}</span>
                  {notice.detail ? (
                    <span className="block truncate text-muted-foreground">{notice.detail}</span>
                  ) : null}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenProviderSettings(notice.providerId)}
                >
                  {copy.modelSwitcher.editApiKey}
                </Button>
              </InlineNotice>
            ) : null}
            {projection.rows.length > 0 ? (
              projection.rows.map((model) => {
                return (
                  <Button
                    key={model.id}
                    type="button"
                    onClick={() => onSelectModel(model.id)}
                    size="sm"
                    variant="ghost"
                    className={cn(
                      "h-[34px] w-full justify-start gap-[var(--jingle-gap-sm)] rounded-[var(--jingle-radius-md)] px-[var(--jingle-space-2)] text-left font-normal",
                      model.isSelected
                        ? "bg-background-secondary text-foreground"
                        : "text-muted-foreground hover:bg-background-secondary/72 hover:text-foreground"
                    )}
                  >
                    <ProviderIcon
                      className="size-[var(--jingle-icon-sm)] shrink-0"
                      providerId={model.providerId}
                    />
                    <span className="min-w-0 flex-1 truncate [font-size:var(--jingle-font-control)] font-medium leading-[var(--jingle-line-control)]">
                      {model.name}
                    </span>
                    <span className="max-w-[96px] shrink-0 truncate text-right [font-size:var(--jingle-font-meta)] leading-[var(--jingle-line-tight)] text-muted-foreground">
                      {model.providerName}
                    </span>
                  </Button>
                )
              })
            ) : notice.kind !== "none" && !searchQuery.trim() ? null : (
              <div className="px-[var(--jingle-space-3)] py-[var(--jingle-space-6)] text-center [font-size:var(--jingle-font-meta)] text-muted-foreground">
                {copy.modelSwitcher.noModelsAvailable}
              </div>
            )}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-border/64 p-[var(--jingle-space-1)]">
        <label className="flex h-[30px] items-center gap-[var(--jingle-gap-sm)] rounded-[var(--jingle-radius-md)] px-[var(--jingle-space-2)] text-muted-foreground">
          <Search className="size-[var(--jingle-icon-sm)] shrink-0" />
          <Input
            autoFocus
            className="h-auto min-w-0 flex-1 border-0 bg-transparent p-0 [font-size:var(--jingle-font-control)] text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-0"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={copy.modelSwitcher.searchModels}
            value={searchQuery}
          />
        </label>
      </div>
    </>
  )
}
