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

const PROVIDER_INFO: Record<string, { placeholder: string; envVar: string }> = {
  anthropic: { placeholder: "sk-ant-...", envVar: "ANTHROPIC_API_KEY" },
  openai: { placeholder: "sk-...", envVar: "OPENAI_API_KEY" },
  google: { placeholder: "AIza...", envVar: "GOOGLE_API_KEY" },
  dashscope: { placeholder: "sk-...", envVar: "DASHSCOPE_API_KEY" }
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

  const { setApiKey: saveApiKey, deleteApiKey } = useHistoryShellStore()

  // Check if there's an existing key when dialog opens
  useEffect(() => {
    if (open && provider) {
      setHasExistingKey(provider.hasApiKey)
      setApiKey("")
      setShowKey(false)
    }
  }, [open, provider])

  if (!provider) return null

  const info = PROVIDER_INFO[provider.id] || { placeholder: "...", envVar: "" }

  async function handleSave(): Promise<void> {
    if (!apiKey.trim()) return
    if (!provider) return

    console.log("[ApiKeyDialog] Saving API key for provider:", provider.id)
    setSaving(true)
    try {
      await saveApiKey(provider.id, apiKey.trim())
      console.log("[ApiKeyDialog] API key saved successfully")
      onOpenChange(false)
    } catch (e) {
      console.error("[ApiKeyDialog] Failed to save API key:", e)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (!provider) return
    setDeleting(true)
    try {
      await deleteApiKey(provider.id)
      onOpenChange(false)
    } catch (e) {
      console.error("Failed to delete API key:", e)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>
            {hasExistingKey
              ? copy.apiKeyDialog.updateTitle(provider.name)
              : copy.apiKeyDialog.addTitle(provider.name)}
          </DialogTitle>
          <DialogDescription>
            {hasExistingKey
              ? copy.apiKeyDialog.updateDescription
              : copy.apiKeyDialog.addDescription(provider.name)}
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
            <p className="text-xs text-muted-foreground">
              {copy.apiKeyDialog.envVar}: <code className="text-foreground">{info.envVar}</code>
            </p>
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
