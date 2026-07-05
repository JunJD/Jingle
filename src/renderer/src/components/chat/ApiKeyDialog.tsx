import { useEffect, useReducer } from "react"
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

interface ApiKeyDialogState {
  credentials: Record<string, string>
  deleting: boolean
  errorText: string | null
  hasExistingKey: boolean
  saving: boolean
}

type ApiKeyDialogAction =
  | { type: "credential-changed"; variable: string; value: string }
  | { type: "delete-finished" }
  | { type: "delete-started" }
  | { type: "load-failed"; credentials: Record<string, string>; errorText: string }
  | {
      type: "loaded"
      credentials: Record<string, string>
      hasExistingKey: boolean
    }
  | { type: "operation-failed"; errorText: string }
  | { type: "save-finished" }
  | { type: "save-started" }

const initialApiKeyDialogState: ApiKeyDialogState = {
  credentials: {},
  deleting: false,
  errorText: null,
  hasExistingKey: false,
  saving: false
}

function apiKeyDialogReducer(
  state: ApiKeyDialogState,
  action: ApiKeyDialogAction
): ApiKeyDialogState {
  switch (action.type) {
    case "credential-changed":
      return {
        ...state,
        credentials: {
          ...state.credentials,
          [action.variable]: action.value
        }
      }
    case "delete-finished":
      return { ...state, deleting: false }
    case "delete-started":
      return { ...state, deleting: true, errorText: null }
    case "load-failed":
      return {
        ...state,
        credentials: action.credentials,
        errorText: action.errorText
      }
    case "loaded":
      return {
        ...state,
        credentials: action.credentials,
        errorText: null,
        hasExistingKey: action.hasExistingKey
      }
    case "operation-failed":
      return { ...state, errorText: action.errorText }
    case "save-finished":
      return { ...state, saving: false }
    case "save-started":
      return { ...state, errorText: null, saving: true }
  }
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
  const [state, dispatch] = useReducer(apiKeyDialogReducer, initialApiKeyDialogState)
  const { credentials, deleting, errorText, hasExistingKey, saving } = state

  const setProviderCredentials = useHistoryShellStore((state) => state.setProviderCredentials)
  const deleteProviderCredentials = useHistoryShellStore((state) => state.deleteProviderCredentials)

  useEffect(() => {
    if (!open || !provider) {
      return
    }

    const selectedProvider = provider
    let cancelled = false

    async function loadCredentials(): Promise<void> {
      const credentialValues = Object.fromEntries(
        selectedProvider.providerCredentialSchema.credentialFormSchemas.map((schema) => [
          schema.variable,
          ""
        ])
      )

      try {
        const existingCredentials =
          selectedProvider.customConfiguration.status === "active"
            ? await window.api.models.getCredentials(selectedProvider.id)
            : null

        if (cancelled) {
          return
        }

        dispatch({
          type: "loaded",
          credentials: {
            ...credentialValues,
            ...(existingCredentials ?? {})
          },
          hasExistingKey: selectedProvider.customConfiguration.status === "active"
        })
      } catch (error) {
        if (cancelled) {
          return
        }

        dispatch({
          type: "load-failed",
          credentials: credentialValues,
          errorText: getDialogErrorMessage(error, copy.apiKeyDialog.saveError)
        })
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

    dispatch({ type: "save-started" })
    try {
      await setProviderCredentials(selectedProvider.id, credentials)
      onOpenChange(false)
    } catch (e) {
      console.error("[ApiKeyDialog] Failed to save API key:", e)
      dispatch({
        type: "operation-failed",
        errorText: getDialogErrorMessage(e, copy.apiKeyDialog.saveError)
      })
    } finally {
      dispatch({ type: "save-finished" })
    }
  }

  async function handleDelete(): Promise<void> {
    dispatch({ type: "delete-started" })
    try {
      await deleteProviderCredentials(selectedProvider.id)
      onOpenChange(false)
    } catch (e) {
      console.error("Failed to delete API key:", e)
      dispatch({
        type: "operation-failed",
        errorText: getDialogErrorMessage(e, copy.apiKeyDialog.deleteError)
      })
    } finally {
      dispatch({ type: "delete-finished" })
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
                        dispatch({
                          type: "credential-changed",
                          value: event.target.value,
                          variable: schema.variable
                        })
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
                        dispatch({
                          type: "credential-changed",
                          value: event.target.value,
                          variable: schema.variable
                        })
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
