import { Loader2, SlidersHorizontal } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n"
import { getSettingsCopy } from "@/settings/copy"
import type { ModelConfig } from "@/types"

type SystemModelSelectorProps = {
  availableModels: ModelConfig[]
  defaultModel: ModelConfig | undefined
  notConfigured: boolean
  onSave: (modelId: string) => Promise<void>
}

const selectClassName =
  "w-full rounded-md border border-border bg-background-elevated px-[var(--ow-space-3)] py-[var(--ow-space-2)] pr-[var(--ow-control-icon-inset)] [font-size:var(--ow-font-label)] text-foreground outline-none transition focus:border-[var(--ring)]"

function getInitialDraftModelId(
  defaultModel: ModelConfig | undefined,
  availableModels: ModelConfig[]
): string {
  if (defaultModel && defaultModel.status === "active") {
    return defaultModel.id
  }

  const firstAvailableModel = availableModels[0]
  if (firstAvailableModel) {
    return firstAvailableModel.id
  }

  return ""
}

export default function SystemModelSelector(props: SystemModelSelectorProps): React.JSX.Element {
  const { availableModels, defaultModel, notConfigured, onSave } = props
  const { locale } = useI18n()
  const copy = getSettingsCopy(locale)
  const [open, setOpen] = useState(false)
  const [draftModelId, setDraftModelId] = useState("")
  const [saving, setSaving] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  const openSelector = (): void => {
    setDraftModelId(getInitialDraftModelId(defaultModel, availableModels))
    setErrorText(null)
    setOpen(true)
  }

  const handleSave = async (): Promise<void> => {
    if (!draftModelId) {
      return
    }

    setSaving(true)
    setErrorText(null)

    try {
      await onSave(draftModelId)
      setOpen(false)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={notConfigured ? "warning" : "outline"}
        className="relative h-[var(--ow-control-h-md)] rounded-lg"
        onClick={openSelector}
      >
        <SlidersHorizontal className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
        {copy.provider.systemSettings}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="system-model-selector-dialog w-[var(--ow-dialog-mobile-w)] rounded-[var(--ow-radius-dialog)] sm:max-w-[var(--ow-dialog-w-model-selector)] sm:rounded-[var(--ow-radius-dialog)]">
          <DialogHeader className="text-left">
            <DialogTitle>{copy.provider.systemSettings}</DialogTitle>
            <DialogDescription>{copy.provider.defaultModelDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-[var(--ow-space-2)]">
            <div className="[font-size:var(--ow-font-label)] font-medium text-foreground">
              {copy.provider.defaultModelTitle}
            </div>
            {availableModels.length > 0 ? (
              <select
                className={selectClassName}
                value={draftModelId}
                onChange={(event) => setDraftModelId(event.target.value)}
              >
                {availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} · {model.model}
                  </option>
                ))}
              </select>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-[var(--ow-space-3)] py-[var(--ow-space-2)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-amber-900">
                {copy.provider.defaultModelUnavailable}
              </div>
            )}
            {errorText && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-[var(--ow-space-3)] py-[var(--ow-space-2)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-destructive">
                {errorText}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {copy.common.cancel}
            </Button>
            <Button
              type="button"
              disabled={!draftModelId || saving}
              onClick={() => {
                void handleSave()
              }}
            >
              {saving ? (
                <Loader2 className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)] animate-spin" />
              ) : (
                copy.common.save
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
