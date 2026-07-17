import { ChevronDown } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  resolveModelSelection,
  projectSelectedModelSummary
} from "@/features/model-selection/model-selection-projection"
import { ProviderIcon } from "@/features/model-selection/provider-icon"
import { ModelQuickPickerContent } from "@/features/model-selection/ModelQuickPickerContent"
import { useI18n } from "@/lib/i18n"
import type { ProviderId } from "@/types"
import type { ModelRuntimeSelection } from "@shared/app-types"
import { useLauncherAiModelPickerController } from "./use-launcher-ai-model-picker-controller"

interface LauncherAiHeaderModelPickerProps {
  currentSelection: ModelRuntimeSelection | null
  fallbackLabel: string
  onSelectSelection: (selection: ModelRuntimeSelection) => Promise<boolean>
  selectionRevision: number | null
}

export function LauncherAiHeaderModelPicker(
  props: LauncherAiHeaderModelPickerProps
): React.JSX.Element {
  const { currentSelection, fallbackLabel, onSelectSelection, selectionRevision } = props
  const { copy } = useI18n()
  const [open, setOpen] = useState(false)
  const { catalog, loadState, openProviderSettings, reload } = useLauncherAiModelPickerController()
  const effectiveSelection = resolveModelSelection(catalog, currentSelection)
  const selectedModel = projectSelectedModelSummary(catalog, effectiveSelection?.modelId ?? null)
  const displayName =
    loadState === "loading"
      ? copy.modelSwitcher.loading
      : loadState === "error"
        ? copy.modelSwitcher.loadError
        : selectedModel.kind === "configured"
          ? `${selectedModel.name}${effectiveSelection?.thinkingEffort ? ` · ${effectiveSelection.thinkingEffort}` : ""}`
          : fallbackLabel

  function handleSelectSelection(selection: ModelRuntimeSelection): void {
    void onSelectSelection(selection).then((didSelect) => {
      if (didSelect) {
        setOpen(false)
      }
    })
  }

  function handleOpenProviderSettings(providerId: ProviderId): void {
    setOpen(false)
    openProviderSettings(providerId)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          aria-label={copy.launcher.changeModel}
          className="group flex h-5 max-w-[var(--launcher-chip-max-width)] items-center gap-[var(--jingle-space-1)] rounded-[var(--jingle-radius-xs)] px-[var(--jingle-space-1)] py-0 font-normal text-muted-foreground transition hover:bg-background-secondary/72 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-model-selection={loadState === "ready" ? selectedModel.kind : loadState}
          variant="ghost"
        >
          {loadState === "ready" && selectedModel.kind === "configured" ? (
            <ProviderIcon
              className="size-[var(--jingle-icon-xs)] shrink-0 text-muted-foreground/64 transition-colors group-hover:text-foreground"
              providerId={selectedModel.providerId}
            />
          ) : null}
          <span className="min-w-0 truncate [font-size:var(--jingle-font-meta)] leading-[var(--jingle-line-tight)]">
            {displayName}
          </span>
          <ChevronDown
            className="size-3 shrink-0 opacity-40 transition group-hover:opacity-75 group-data-[state=open]:opacity-75"
            strokeWidth={1.8}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="launcher-ai-model-popover flex flex-col overflow-hidden border-border/72 bg-popover/96 p-0"
        sideOffset={6}
      >
        <ModelQuickPickerContent
          catalog={catalog}
          currentSelection={effectiveSelection}
          loadState={loadState}
          onOpenProviderSettings={handleOpenProviderSettings}
          onRetry={reload}
          onSelectSelection={handleSelectSelection}
          selectionRevision={selectionRevision}
        />
      </PopoverContent>
    </Popover>
  )
}
