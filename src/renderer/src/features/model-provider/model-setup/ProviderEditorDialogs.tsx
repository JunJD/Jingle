import { useEffect, useRef, useState } from "react"
import { Loader2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { ProviderLogo } from "@/components/model-provider-logo"
import {
  SettingsField,
  SettingsPasswordInput,
  SettingsTextInput,
  secondaryButtonClassName
} from "@/settings/settings-ui"
import type { CustomProviderConfig, ModelProviderPaths, ProviderId } from "@shared/app-types"
import type { ModelSetupProvider } from "@shared/model-setup"
import { resolveLocalizedText } from "@shared/i18n"
import { CustomProviderForm } from "./CustomProviderForm"
import { InlineError } from "./ProviderSetupPages"
import { getProviderDescription } from "./model-setup-projection"
import type { ModelSetupCommands } from "./useModelSetupController"

export type ProviderEditorState =
  | { kind: "closed" }
  | { kind: "activation"; providerId: ProviderId }
  | { kind: "credentials"; providerId: ProviderId }
  | { kind: "custom"; config: CustomProviderConfig; providerId: ProviderId }

type ProviderCredentialFormSchema =
  ModelSetupProvider["providerCredentialSchema"]["credentialFormSchemas"][number]

export function ProviderEditorDialogs(props: {
  activeProviderId: ProviderId | null
  commands: ModelSetupCommands
  editor: ProviderEditorState
  modelProviderPaths: ModelProviderPaths
  onClose: () => void
  onConfigured: (providerId: ProviderId) => void
  providers: ModelSetupProvider[]
}): React.JSX.Element | null {
  const {
    activeProviderId,
    commands,
    editor,
    modelProviderPaths,
    onClose,
    onConfigured,
    providers
  } = props

  if (editor.kind === "closed") {
    return null
  }
  const provider = requireEditorProvider(providers, editor.providerId)

  if (editor.kind === "custom") {
    return (
      <CustomProviderDialog
        commands={commands}
        initialProvider={editor.config}
        modelProviderPaths={modelProviderPaths}
        provider={provider}
        onClose={onClose}
        onSaved={(providerId, snapshotReady) => {
          onClose()
          if (snapshotReady) {
            onConfigured(providerId)
          }
        }}
      />
    )
  }

  if (editor.kind === "credentials") {
    return (
      <ProviderCredentialsDialog
        activeProviderId={activeProviderId}
        commands={commands}
        provider={provider}
        onClose={onClose}
        onConfigured={(providerId) => {
          onClose()
          onConfigured(providerId)
        }}
      />
    )
  }

  return (
    <ProviderActivationDialog
      commands={commands}
      provider={provider}
      onClose={onClose}
      onConfigured={(providerId) => {
        onClose()
        onConfigured(providerId)
      }}
    />
  )
}

function ProviderCredentialsDialog(props: {
  activeProviderId: ProviderId | null
  commands: ModelSetupCommands
  onClose: () => void
  onConfigured: (providerId: ProviderId) => void
  provider: ModelSetupProvider
}): React.JSX.Element {
  const { activeProviderId, commands, onClose, onConfigured, provider } = props
  const credentialSchemas = provider.providerCredentialSchema.credentialFormSchemas
  const configured = provider.customConfiguration.status === "active"
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const canSave =
    !loading &&
    credentialSchemas.every(
      (schema) => !schema.required || Boolean(credentials[schema.variable]?.trim())
    )

  useEffect(() => {
    let cancelled = false

    async function loadCredentials(): Promise<void> {
      try {
        const storedCredentials = await commands.getCredentials(provider.id)
        if (!cancelled) {
          setCredentials(storedCredentials ?? {})
        }
      } catch (error) {
        if (!cancelled) {
          setErrorText(getErrorMessage(error))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadCredentials()
    return () => {
      cancelled = true
    }
  }, [commands, provider.id])

  async function handleSave(): Promise<void> {
    if (!canSave || saving) {
      return
    }

    setSaving(true)
    setErrorText(null)
    try {
      const result = await commands.saveCredentials(provider.id, credentials)
      if (result.snapshotReady) {
        onConfigured(provider.id)
      } else {
        onClose()
      }
    } catch (error) {
      setErrorText(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (saving || provider.id === activeProviderId) {
      return
    }

    setSaving(true)
    setErrorText(null)
    try {
      await commands.deleteCredentials(provider.id)
      onClose()
    } catch (error) {
      setErrorText(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="w-[var(--ow-dialog-mobile-w)] rounded-[var(--ow-radius-dialog)] sm:max-w-[520px] sm:rounded-[var(--ow-radius-dialog)]">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-[var(--ow-space-2)]">
            <ProviderLogo providerId={provider.id} className="h-5 w-5" />
            {configured ? "编辑" : "配置"} {provider.name}
          </DialogTitle>
          <DialogDescription>保存后会读取可用模型。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-[var(--ow-space-4)]">
          {loading ? (
            <div className="flex items-center gap-[var(--ow-space-2)] [font-size:var(--ow-font-body)] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              读取配置
            </div>
          ) : null}

          {credentialSchemas.map((schema) => {
            const label = getCredentialFieldLabel(schema)
            const placeholder = getCredentialPlaceholder(schema)
            return (
              <SettingsField key={schema.variable} label={label} required={schema.required}>
                {schema.type === "secret-input" ? (
                  <SettingsPasswordInput
                    disabled={loading || saving}
                    value={credentials[schema.variable] ?? ""}
                    placeholder={placeholder}
                    showLabel="显示"
                    hideLabel="隐藏"
                    onChange={(event) =>
                      setCredentials((current) => ({
                        ...current,
                        [schema.variable]: event.target.value
                      }))
                    }
                  />
                ) : (
                  <SettingsTextInput
                    disabled={loading || saving}
                    value={credentials[schema.variable] ?? ""}
                    placeholder={placeholder}
                    onChange={(event) =>
                      setCredentials((current) => ({
                        ...current,
                        [schema.variable]: event.target.value
                      }))
                    }
                  />
                )}
              </SettingsField>
            )
          })}

          {errorText ? <InlineError text={errorText} /> : null}
        </div>

        <DialogFooter className="flex-col-reverse gap-[var(--ow-space-2)] sm:flex-row sm:items-center sm:justify-between">
          {configured ? (
            <button
              type="button"
              className={secondaryButtonClassName}
              disabled={saving || provider.id === activeProviderId}
              onClick={handleDelete}
            >
              <Trash2 className="h-4 w-4" />
              删除配置
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center justify-end gap-[var(--ow-space-2)]">
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              取消
            </Button>
            <Button type="button" disabled={!canSave || saving} onClick={handleSave}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "保存配置"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProviderActivationDialog(props: {
  commands: ModelSetupCommands
  onClose: () => void
  onConfigured: (providerId: ProviderId) => void
  provider: ModelSetupProvider
}): React.JSX.Element {
  const { commands, onClose, onConfigured, provider } = props
  const [saving, setSaving] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const unavailableMessage = provider.customConfiguration.message

  async function handleActivate(): Promise<void> {
    if (saving || unavailableMessage) {
      return
    }

    setSaving(true)
    setErrorText(null)
    try {
      const result = await commands.activateProvider(provider.id)
      if (result.snapshotReady) {
        onConfigured(provider.id)
      } else {
        onClose()
      }
    } catch (error) {
      setErrorText(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="w-[var(--ow-dialog-mobile-w)] rounded-[var(--ow-radius-dialog)] sm:max-w-[460px] sm:rounded-[var(--ow-radius-dialog)]">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-[var(--ow-space-2)]">
            <ProviderLogo providerId={provider.id} className="h-5 w-5" />
            配置 {provider.name}
          </DialogTitle>
          <DialogDescription>{getProviderDescription(provider)}</DialogDescription>
        </DialogHeader>

        {errorText ? <InlineError text={errorText} /> : null}
        {unavailableMessage ? <InlineError text={unavailableMessage} /> : null}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            disabled={saving || Boolean(unavailableMessage)}
            onClick={handleActivate}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "启用 provider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CustomProviderDialog(props: {
  commands: ModelSetupCommands
  initialProvider: CustomProviderConfig
  modelProviderPaths: ModelProviderPaths
  onClose: () => void
  onSaved: (providerId: ProviderId, snapshotReady: boolean) => void
  provider: ModelSetupProvider
}): React.JSX.Element {
  const { commands, initialProvider, modelProviderPaths, onClose, onSaved, provider } = props
  const savingRef = useRef(false)

  return (
    <Dialog open onOpenChange={(open) => !open && !savingRef.current && onClose()}>
      <DialogContent className="w-[var(--ow-dialog-mobile-w)] max-h-[90vh] overflow-y-auto rounded-[var(--ow-radius-dialog)] sm:max-w-[600px] sm:rounded-[var(--ow-radius-dialog)]">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-[var(--ow-space-2)]">
            <ProviderLogo providerId={provider.id} className="h-5 w-5" />
            编辑 {provider.name}
          </DialogTitle>
        </DialogHeader>

        <CustomProviderForm
          key={provider.id}
          initialProvider={initialProvider}
          modelProviderPaths={modelProviderPaths}
          onBack={onClose}
          onSavingChange={(saving) => {
            savingRef.current = saving
          }}
          onSubmit={async (input) => {
            const result = await commands.upsertCustomProvider(input)
            onSaved(result.providerId, result.snapshotReady)
          }}
          submitLabel="保存 provider"
          title={null}
        />
      </DialogContent>
    </Dialog>
  )
}

function getCredentialFieldLabel(schema: ProviderCredentialFormSchema): string {
  const label = resolveLocalizedText(schema.label, "zh-CN")
  if (!label) {
    throw new Error(`Provider credential label is missing: ${schema.variable}`)
  }

  return label
}

function getCredentialPlaceholder(schema: ProviderCredentialFormSchema): string | undefined {
  if (schema.placeholder?.zh_Hans) {
    return schema.placeholder.zh_Hans
  }

  return schema.placeholder?.en_US
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function requireEditorProvider(
  providers: ModelSetupProvider[],
  providerId: ProviderId
): ModelSetupProvider {
  const provider = providers.find((candidate) => candidate.id === providerId)
  if (!provider) {
    throw new Error(`Provider editor target is missing from the setup snapshot: ${providerId}`)
  }

  return provider
}
