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
import { getIpcErrorDisplayMessage } from "@/lib/ipc-errors"
import type { Provider } from "@/types"
import { useI18n } from "@/lib/i18n"
import type { AppLocale } from "@shared/i18n"
import type { LocalizedText } from "@shared/app-types"

interface ApiKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: Provider | null
}

function getDialogErrorMessage(error: unknown, fallback: string): string {
  return getIpcErrorDisplayMessage(error, fallback)
}

function getLocalizedText(text: LocalizedText, locale: AppLocale): string {
  return locale === "zh-CN" ? text.zh_Hans : text.en_US
}

export function ApiKeyDialog({
  open,
  onOpenChange,
  provider
}: ApiKeyDialogProps): React.JSX.Element | null {
  const { copy, locale } = useI18n()
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [visibleCredentials, setVisibleCredentials] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [hasExistingKey, setHasExistingKey] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  const setProviderCredentials = useHistoryShellStore((state) => state.setProviderCredentials)
  const deleteProviderCredentials = useHistoryShellStore((state) => state.deleteProviderCredentials)

  // Check if there's an existing key when dialog opens
  useEffect(() => {
    if (open && provider) {
      const credentialValues = Object.fromEntries(
        provider.providerCredentialSchema.credentialFormSchemas.map((schema) => [
          schema.variable,
          ""
        ])
      )
      setHasExistingKey(provider.customConfiguration.status === "active")
      setCredentials(credentialValues)
      setVisibleCredentials({})
      setErrorText(null)
    }
  }, [open, provider])

  if (!provider) return null

  const selectedProvider = provider
  const credentialSchemas = selectedProvider.providerCredentialSchema.credentialFormSchemas
  const canSave = credentialSchemas.every((schema) => {
    if (!schema.required) {
      return true
    }

    return Boolean(credentials[schema.variable]?.trim())
  })

  async function handleSave(): Promise<void> {
    if (!canSave) return

    setSaving(true)
    setErrorText(null)
    try {
      await setProviderCredentials(selectedProvider.id, credentials)
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
      await deleteProviderCredentials(selectedProvider.id)
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
      <DialogContent className="w-[calc(100%-2rem)] rounded-[var(--ow-radius-dialog)] sm:max-w-[400px] sm:rounded-[var(--ow-radius-dialog)]">
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
          <div className="space-y-3">
            {credentialSchemas.map((schema, index) => {
              const isSecret = schema.type === "secret-input"
              const visible = visibleCredentials[schema.variable] === true
              const placeholder = schema.placeholder
                ? getLocalizedText(schema.placeholder, locale)
                : undefined

              return (
                <label key={schema.variable} className="block space-y-1.5">
                  <span className="text-[12px] font-medium text-foreground">
                    {getLocalizedText(schema.label, locale)}
                  </span>
                  <div className="relative">
                    <Input
                      type={isSecret && !visible ? "password" : "text"}
                      value={credentials[schema.variable] ?? ""}
                      onChange={(event) =>
                        setCredentials((currentCredentials) => ({
                          ...currentCredentials,
                          [schema.variable]: event.target.value
                        }))
                      }
                      placeholder={hasExistingKey ? "••••••••••••••••" : placeholder}
                      className={isSecret ? "pr-10" : undefined}
                      autoFocus={index === 0}
                    />
                    {isSecret && (
                      <button
                        type="button"
                        onClick={() =>
                          setVisibleCredentials((current) => ({
                            ...current,
                            [schema.variable]: !visible
                          }))
                        }
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    )}
                  </div>
                </label>
              )
            })}
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
            <Button type="button" onClick={handleSave} disabled={!canSave || saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : copy.apiKeyDialog.save}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
