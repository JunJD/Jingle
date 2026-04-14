import { useState, useEffect } from "react"
import { Eye, EyeOff, Loader2, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import type { Provider } from "@/types"
import { useI18n } from "@/lib/i18n"

interface ApiKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: Provider | null
}

const PROVIDER_INFO: Record<Provider["id"], { placeholder: string }> = {
  anthropic: { placeholder: "sk-ant-..." },
  openai: { placeholder: "sk-..." },
  google: { placeholder: "AIza..." },
  dashscope: { placeholder: "sk-..." }
}

function getDialogErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback
  }

  return error.message.replace(/^Error invoking remote method '[^']+':\s*/, "")
}

export function ApiKeyDialog({
  open,
  onOpenChange,
  provider
}: ApiKeyDialogProps): React.JSX.Element | null {
  const { copy } = useI18n()
  const [apiKey, setApiKey] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [hasExistingKey, setHasExistingKey] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  const { setApiKey: saveApiKey, deleteApiKey } = useHistoryShellStore()

  // Check if there's an existing key when dialog opens
  useEffect(() => {
    if (open && provider) {
      setHasExistingKey(provider.hasApiKey)
      setApiKey("")
      setShowKey(false)
      setErrorText(null)
    }
  }, [open, provider])

  if (!provider) return null

  const selectedProvider = provider
  const info = PROVIDER_INFO[selectedProvider.id]

  async function handleSave(): Promise<void> {
    if (!apiKey.trim()) return

    setSaving(true)
    setErrorText(null)
    try {
      await saveApiKey(selectedProvider.id, apiKey.trim())
      onOpenChange(false)
    } catch (e) {
      console.error("[ApiKeyDialog] Failed to save API key:", e)
      setErrorText(getDialogErrorMessage(e, copy.apiKeyDialog.saveError))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(): Promise<void> {
    setDeleting(true)
    setErrorText(null)
    try {
      await deleteApiKey(selectedProvider.id)
      onOpenChange(false)
    } catch (e) {
      console.error("Failed to delete API key:", e)
      setErrorText(getDialogErrorMessage(e, copy.apiKeyDialog.deleteError))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] rounded-2xl sm:max-w-[400px] sm:rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle>
            {hasExistingKey
              ? copy.apiKeyDialog.updateTitle(selectedProvider.name)
              : copy.apiKeyDialog.addTitle(selectedProvider.name)}
          </DialogTitle>
          <DialogDescription>
            {hasExistingKey
              ? copy.apiKeyDialog.updateDescription
              : copy.apiKeyDialog.addDescription(selectedProvider.name)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasExistingKey ? "••••••••••••••••" : info.placeholder}
                className="pr-10"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{copy.apiKeyDialog.secureStorageHint}</p>
            {errorText && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {errorText}
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-between">
          {hasExistingKey ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleting || saving}
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="size-4 mr-2" />
              )}
              {copy.apiKeyDialog.removeKey}
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {copy.apiKeyDialog.cancel}
            </Button>
            <Button type="button" onClick={handleSave} disabled={!apiKey.trim() || saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : copy.apiKeyDialog.save}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
