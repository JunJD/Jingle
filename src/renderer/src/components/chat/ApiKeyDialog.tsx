import { useState, useEffect } from "react"
import { Loader2, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { getIpcErrorDisplayMessage } from "@/lib/ipc-errors"
import { getSettingsCopy } from "@/settings/copy"
import { SettingsField, SettingsPasswordInput, SettingsTextInput } from "@/settings/settings-ui"
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
  const settingsCopy = getSettingsCopy(locale)
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [hasExistingKey, setHasExistingKey] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  const setProviderCredentials = useHistoryShellStore((state) => state.setProviderCredentials)
  const deleteProviderCredentials = useHistoryShellStore((state) => state.deleteProviderCredentials)

  useEffect(() => {
    if (!open || !provider) {
      return
    }

    let cancelled = false

    async function loadCredentials(): Promise<void> {
      if (!provider) return
      const credentialValues = Object.fromEntries(
        provider.providerCredentialSchema.credentialFormSchemas.map((schema) => [
          schema.variable,
          ""
        ])
      )

      try {
        const existingCredentials =
          provider.customConfiguration.status === "active"
            ? await window.api.models.getCredentials(provider.id)
            : null

        if (cancelled) {
          return
        }

        setHasExistingKey(provider.customConfiguration.status === "active")
        setCredentials({
          ...credentialValues,
          ...(existingCredentials ?? {})
        })
        setErrorText(null)
      } catch (error) {
        if (cancelled) {
          return
        }

        setCredentials(credentialValues)
        setErrorText(getDialogErrorMessage(error, copy.apiKeyDialog.saveError))
      }
    }

    void loadCredentials()

    return () => {
      cancelled = true
    }
  }, [copy.apiKeyDialog.saveError, open, provider])

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
      <DialogContent className="w-[var(--ow-dialog-mobile-w)] rounded-[var(--ow-radius-dialog)] sm:max-w-[var(--ow-dialog-w-sm)] sm:rounded-[var(--ow-radius-dialog)]">
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

        <div className="space-y-[var(--ow-space-4)] py-[var(--ow-space-2)]">
          <div className="space-y-[var(--ow-space-3)]">
            {credentialSchemas.map((schema, index) => {
              const isSecret = schema.type === "secret-input"
              const placeholder = schema.placeholder
                ? getLocalizedText(schema.placeholder, locale)
                : undefined

              return (
                <SettingsField key={schema.variable} label={getLocalizedText(schema.label, locale)}>
                  {isSecret ? (
                    <SettingsPasswordInput
                      value={credentials[schema.variable] ?? ""}
                      onChange={(event) =>
                        setCredentials((currentCredentials) => ({
                          ...currentCredentials,
                          [schema.variable]: event.target.value
                        }))
                      }
                      placeholder={hasExistingKey ? "••••••••••••••••" : placeholder}
                      showLabel={settingsCopy.common.showSecret}
                      hideLabel={settingsCopy.common.hideSecret}
                      autoFocus={index === 0}
                    />
                  ) : (
                    <SettingsTextInput
                      type="text"
                      value={credentials[schema.variable] ?? ""}
                      onChange={(event) =>
                        setCredentials((currentCredentials) => ({
                          ...currentCredentials,
                          [schema.variable]: event.target.value
                        }))
                      }
                      placeholder={hasExistingKey ? "••••••••••••••••" : placeholder}
                      autoFocus={index === 0}
                    />
                  )}
                </SettingsField>
              )
            })}
            <p className="[font-size:var(--ow-font-meta)] text-muted-foreground">
              {copy.apiKeyDialog.secureStorageHint}
            </p>
            {errorText && (
              <p className="rounded-[var(--ow-radius-lg)] border border-destructive/30 bg-destructive/10 px-[var(--ow-space-3)] py-[var(--ow-space-2)] [font-size:var(--ow-font-meta)] text-destructive">
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
                <Loader2 className="size-[var(--ow-icon-action)] animate-spin mr-[var(--ow-space-2)]" />
              ) : (
                <Trash2 className="size-[var(--ow-icon-action)] mr-[var(--ow-space-2)]" />
              )}
              {copy.apiKeyDialog.removeKey}
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-[var(--ow-gap-sm)]">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {copy.apiKeyDialog.cancel}
            </Button>
            <Button type="button" onClick={handleSave} disabled={!canSave || saving}>
              {saving ? (
                <Loader2 className="size-[var(--ow-icon-action)] animate-spin" />
              ) : (
                copy.apiKeyDialog.save
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
