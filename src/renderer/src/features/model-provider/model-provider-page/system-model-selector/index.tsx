import { Loader2, SlidersHorizontal } from "lucide-react"
import { useEffect, useState } from "react"
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
  "w-full rounded-md border border-border bg-background-elevated px-3 py-2 pr-8 text-[13px] text-foreground outline-none transition focus:border-[var(--ring)]"

export default function SystemModelSelector(props: SystemModelSelectorProps): React.JSX.Element {
  const { availableModels, defaultModel, notConfigured, onSave } = props
  const { locale } = useI18n()
  const copy = getSettingsCopy(locale)
  const [open, setOpen] = useState(false)
  const [draftModelId, setDraftModelId] = useState("")
  const [saving, setSaving] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    setDraftModelId(
      defaultModel?.status === "active" ? defaultModel.id : (availableModels[0]?.id ?? "")
    )
    setErrorText(null)
  }, [availableModels, defaultModel, open])

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
        className="relative h-8 rounded-lg"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        {copy.provider.systemSettings}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100%-2rem)] rounded-2xl sm:max-w-[480px] sm:rounded-2xl">
          <DialogHeader className="text-left">
            <DialogTitle>{copy.provider.systemSettings}</DialogTitle>
            <DialogDescription>{copy.provider.defaultModelDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <div className="text-[13px] font-medium text-foreground">
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
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-900">
                {copy.provider.defaultModelUnavailable}
              </div>
            )}
            {errorText && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] leading-5 text-destructive">
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
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : copy.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
