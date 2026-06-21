import { useEffect, useEffectEvent, useMemo, useState } from "react"
import { Link, Search, Settings2 } from "lucide-react"
import type { ModelConfig } from "@shared/app-types"
import { resolveLocalizedText, type AppLocale, type LocalizedTextValue } from "@shared/i18n"
import type {
  InstalledNativeExtensionSettingsSchema,
  NativeExtensionConnectionManifest,
  NativeExtensionPreferenceSchema,
  NativeExtensionResolvedConnection
} from "@shared/native-extensions"
import {
  getNativeExtensionApplicationPreferenceLabel,
  normalizeNativeExtensionApplicationPreferenceValue
} from "@shared/native-extensions"
import type { SettingsWindowTarget } from "@shared/settings-window"
import { ExtensionIcon } from "@/extensions/ExtensionIcon"
import { getSettingsCopy } from "./copy"
import {
  inputClassName,
  settingsCardClassName,
  settingsInsetCardClassName,
  SettingsField,
  SettingsPasswordInput,
  SettingsSelect,
  SettingsSwitch,
  SettingsTextInput
} from "./settings-ui"

function formatCommandMode(mode: string, locale: AppLocale): string {
  if (locale === "zh-CN") {
    if (mode === "no-view") {
      return "无界面"
    }

    if (mode === "menu-bar") {
      return "菜单栏"
    }

    if (mode === "background") {
      return "后台"
    }

    if (mode === "view") {
      return "视图"
    }
  }

  if (mode === "no-view") {
    return "No View"
  }

  if (mode === "menu-bar") {
    return "Menu Bar"
  }

  return mode.charAt(0).toUpperCase() + mode.slice(1)
}

function resolveExtensionText(
  text: LocalizedTextValue | null | undefined,
  locale: AppLocale,
  fallback = ""
): string {
  return resolveLocalizedText(text, locale, fallback)
}

function resolvePreferenceLabel(
  preference: NativeExtensionPreferenceSchema,
  locale: AppLocale
): string {
  return resolveExtensionText(preference.title ?? preference.label, locale, preference.name)
}

function isLocalSecretConnection(
  connection: NativeExtensionConnectionManifest
): connection is NativeExtensionConnectionManifest & {
  auth: Extract<
    NativeExtensionConnectionManifest["auth"],
    { type: "apiKey" | "personalAccessToken" }
  >
} {
  return connection.auth.type === "apiKey" || connection.auth.type === "personalAccessToken"
}

function PreferenceField(props: {
  disabledLabel: string
  enabledLabel: string
  modelOptions: Array<{ id: string; label: string }>
  onChange: (nextValue: unknown) => void
  onCommit: (nextValue: unknown) => void
  preference: NativeExtensionPreferenceSchema
  locale: AppLocale
  useEnvironmentFallbackLabel: string
  value: unknown
}): React.JSX.Element {
  const {
    disabledLabel,
    enabledLabel,
    locale,
    modelOptions,
    onChange,
    onCommit,
    preference,
    useEnvironmentFallbackLabel,
    value
  } = props
  const fieldLabel = resolvePreferenceLabel(preference, locale)
  const description = resolveExtensionText(preference.description, locale)
  const placeholder = resolveExtensionText(preference.placeholder, locale)

  return (
    <SettingsField label={fieldLabel} description={description} required={preference.required}>
      {preference.type === "checkbox" ? (
        <div className="flex min-h-[var(--ow-settings-control-h)] items-center justify-between gap-[var(--ow-gap-md)] rounded-[var(--ow-radius-md)] border border-border bg-background-elevated px-[var(--ow-space-3)] py-[var(--ow-space-1)] [font-size:var(--ow-settings-control-font)] text-foreground">
          <span className="min-w-0 truncate text-muted-foreground">
            {value === true ? enabledLabel : disabledLabel}
          </span>
          <SettingsSwitch
            checked={value === true}
            label={fieldLabel}
            onCheckedChange={(checked) => {
              onChange(checked)
              onCommit(checked)
            }}
          />
        </div>
      ) : preference.type === "dropdown" ? (
        <SettingsSelect
          value={String(value ?? "")}
          onChange={(event) => {
            const nextValue = event.target.value
            onChange(nextValue)
            onCommit(nextValue)
          }}
        >
          {(preference.data ?? []).map((entry) => (
            <option
              key={entry.value ?? resolveExtensionText(entry.title, locale)}
              value={entry.value ?? ""}
            >
              {resolveExtensionText(entry.title, locale, entry.value ?? "")}
            </option>
          ))}
        </SettingsSelect>
      ) : preference.type === "model" ? (
        <SettingsSelect
          value={String(value ?? "")}
          onChange={(event) => {
            const nextValue = event.target.value || null
            onChange(nextValue)
            onCommit(nextValue)
          }}
        >
          <option value="">{useEnvironmentFallbackLabel}</option>
          {modelOptions.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </SettingsSelect>
      ) : preference.type === "appPicker" ? (
        <SettingsTextInput
          type="text"
          value={getNativeExtensionApplicationPreferenceLabel(value)}
          placeholder={placeholder || (locale === "zh-CN" ? "应用名称" : "Application name")}
          onChange={(event) => {
            const nextValue = normalizeNativeExtensionApplicationPreferenceValue(event.target.value)
            onChange(nextValue)
          }}
          onBlur={(event) => {
            onCommit(normalizeNativeExtensionApplicationPreferenceValue(event.currentTarget.value))
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur()
            }
          }}
          spellCheck={false}
        />
      ) : (
        <SettingsTextInput
          type="text"
          value={String(value ?? "")}
          placeholder={placeholder}
          onChange={(event) => {
            const nextValue = event.target.value
            onChange(nextValue)
          }}
          onBlur={(event) => {
            onCommit(event.currentTarget.value)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur()
            }
          }}
          spellCheck={false}
        />
      )}
    </SettingsField>
  )
}

function PreferenceSection(props: {
  disabledLabel: string
  emptyLabel: string
  enabledLabel: string
  modelOptions: Array<{ id: string; label: string }>
  onChange: (preferenceName: string, nextValue: unknown) => void
  onCommit: (preferenceName: string, nextValue: unknown) => void
  preferences: NativeExtensionPreferenceSchema[]
  locale: AppLocale
  title?: string
  useEnvironmentFallbackLabel: string
  values: Record<string, unknown>
}): React.JSX.Element {
  const {
    disabledLabel,
    emptyLabel,
    enabledLabel,
    locale,
    modelOptions,
    onChange,
    onCommit,
    preferences,
    title,
    useEnvironmentFallbackLabel,
    values
  } = props

  return (
    <div className="space-y-[var(--ow-space-3)]">
      {title ? (
        <div className="[font-size:var(--ow-font-label)] font-semibold text-foreground">
          {title}
        </div>
      ) : null}
      {preferences.length === 0 ? (
        <div
          className={`${settingsInsetCardClassName} border-dashed [font-size:var(--ow-font-body)] text-muted-foreground`}
        >
          {emptyLabel}
        </div>
      ) : (
        <div className="space-y-[var(--ow-space-3)]">
          {preferences.map((preference) => (
            <PreferenceField
              key={preference.name}
              disabledLabel={disabledLabel}
              enabledLabel={enabledLabel}
              modelOptions={modelOptions}
              locale={locale}
              onChange={(nextValue) => {
                onChange(preference.name, nextValue)
              }}
              onCommit={(nextValue) => {
                onCommit(preference.name, nextValue)
              }}
              preference={preference}
              useEnvironmentFallbackLabel={useEnvironmentFallbackLabel}
              value={values[preference.name]}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function buildPreferenceUpdateRecord(params: {
  currentRecord: Record<string, unknown>
  nextValue: unknown
  preferenceName: string
}): Record<string, unknown> {
  return {
    ...params.currentRecord,
    [params.preferenceName]: params.nextValue
  }
}

function CommandCard(props: {
  commandName: string
  commandNameFocus?: string
  disabledLabel: string
  emptyLabel: string
  enabledLabel: string
  labelMode: string
  locale: AppLocale
  modelOptions: Array<{ id: string; label: string }>
  onChange: (preferenceName: string, nextValue: unknown) => void
  onCommit: (preferenceName: string, nextValue: unknown) => void
  preferences: NativeExtensionPreferenceSchema[]
  title: string
  useEnvironmentFallbackLabel: string
  values: Record<string, unknown>
  description: string
  extensionName: string
  icon?: string
  iconName?: string
  mode: string
}): React.JSX.Element {
  const {
    commandName,
    commandNameFocus,
    description,
    disabledLabel,
    emptyLabel,
    enabledLabel,
    extensionName,
    icon,
    iconName,
    labelMode,
    locale,
    modelOptions,
    mode,
    onChange,
    onCommit,
    preferences,
    title,
    useEnvironmentFallbackLabel,
    values
  } = props

  const isFocused = commandNameFocus === commandName

  return (
    <div
      className={`rounded-[var(--ow-settings-card-radius)] border bg-background-elevated/65 px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)] ${
        isFocused ? "border-[var(--ring)]" : "border-border/80"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-[var(--ow-gap-md)]">
        <div className="space-y-[var(--ow-space-1)]">
          <div className="flex items-center gap-[var(--ow-gap-sm)]">
            <ExtensionIcon
              className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)] text-muted-foreground"
              extensionName={extensionName}
              icon={icon}
              iconName={iconName}
            />
            <span className="[font-size:var(--ow-font-label)] font-semibold text-foreground">
              {title}
            </span>
          </div>
          <div className="[font-size:var(--ow-font-body)] text-muted-foreground">{description}</div>
        </div>
        <div className="rounded-full border border-border bg-background px-[var(--ow-space-2-5)] py-[var(--ow-space-1)] [font-size:var(--ow-font-meta)] uppercase tracking-[0.08em] text-muted-foreground">
          {labelMode}: {formatCommandMode(mode, locale)}
        </div>
      </div>
      <div className="mt-[var(--ow-space-3)]">
        <PreferenceSection
          disabledLabel={disabledLabel}
          emptyLabel={emptyLabel}
          enabledLabel={enabledLabel}
          modelOptions={modelOptions}
          locale={locale}
          onChange={onChange}
          onCommit={onCommit}
          preferences={preferences}
          useEnvironmentFallbackLabel={useEnvironmentFallbackLabel}
          values={values}
        />
      </div>
    </div>
  )
}

function ConnectionStatusBadge(props: {
  connected: boolean
  labels: {
    connected: string
    missing: string
  }
}): React.JSX.Element {
  return (
    <span
      className={`rounded-full border px-[var(--ow-space-2-5)] py-[var(--ow-space-1)] [font-size:var(--ow-font-meta)] ${
        props.connected
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
          : "border-border bg-background text-muted-foreground"
      }`}
    >
      {props.connected ? props.labels.connected : props.labels.missing}
    </span>
  )
}

function OAuthConnectionCard(props: {
  connection: NativeExtensionResolvedConnection | null
  error: string | null
  isConnecting: boolean
  onConnect: () => void
  statusLabels: {
    connected: string
    connect: string
    connecting: string
    description: string
    missing: string
    title: string
  }
}): React.JSX.Element {
  const { connection, error, isConnecting, onConnect, statusLabels } = props
  const connected = connection?.status === "connected"

  return (
    <div
      className={`${settingsCardClassName} px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)]`}
    >
      <div className="flex flex-wrap items-center justify-between gap-[var(--ow-gap-md)]">
        <div className="min-w-0 space-y-[var(--ow-space-1)]">
          <div className="flex items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-label)] font-semibold text-foreground">
            <Link className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)] text-muted-foreground" />
            <span>{statusLabels.title}</span>
          </div>
          <div className="[font-size:var(--ow-font-body)] leading-[var(--ow-line-body)] text-muted-foreground">
            {statusLabels.description}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-[var(--ow-gap-sm)]">
          <ConnectionStatusBadge
            connected={connected}
            labels={{
              connected: statusLabels.connected,
              missing: statusLabels.missing
            }}
          />
          <button
            type="button"
            disabled={isConnecting}
            onClick={onConnect}
            className="rounded-[var(--ow-radius-md)] border border-border bg-background px-[var(--ow-space-3)] py-[var(--ow-space-2)] [font-size:var(--ow-font-label)] font-medium text-foreground transition hover:bg-background-elevated disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isConnecting ? statusLabels.connecting : statusLabels.connect}
          </button>
        </div>
      </div>
      {error ? (
        <div className="mt-[var(--ow-space-2)] [font-size:var(--ow-font-meta)] text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  )
}

function SecretConnectionCard(props: {
  connection: NativeExtensionResolvedConnection | null
  connectionManifest: NativeExtensionConnectionManifest & {
    auth: Extract<
      NativeExtensionConnectionManifest["auth"],
      { type: "apiKey" | "personalAccessToken" }
    >
  }
  error: string | null
  hideSecretLabel: string
  isSecretDirty: (secretName: string) => boolean
  onSecretChange: (secretName: string, nextValue: string) => void
  onSecretCommit: (secretName: string, nextValue: string) => void
  secretValues: Record<string, string>
  showSecretLabel: string
  statusLabels: {
    connected: string
    description: string
    missing: string
    title: string
  }
}): React.JSX.Element {
  const {
    connection,
    connectionManifest,
    error,
    hideSecretLabel,
    isSecretDirty,
    onSecretChange,
    onSecretCommit,
    secretValues,
    showSecretLabel,
    statusLabels
  } = props
  const connected = connection?.status === "connected"
  const secretTitle = connectionManifest.auth.type === "apiKey" ? "API Key" : "Access Token"

  return (
    <div
      className={`${settingsCardClassName} px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)]`}
    >
      <div className="flex flex-wrap items-start justify-between gap-[var(--ow-gap-md)]">
        <div className="min-w-0 space-y-[var(--ow-space-1)]">
          <div className="flex items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-label)] font-semibold text-foreground">
            <Link className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)] text-muted-foreground" />
            <span>{statusLabels.title}</span>
          </div>
          <div className="[font-size:var(--ow-font-body)] leading-[var(--ow-line-body)] text-muted-foreground">
            {connectionManifest.connectGuide ?? statusLabels.description}
          </div>
        </div>
        <ConnectionStatusBadge
          connected={connected}
          labels={{
            connected: statusLabels.connected,
            missing: statusLabels.missing
          }}
        />
      </div>
      <div className="mt-[var(--ow-space-3)] space-y-[var(--ow-space-3)]">
        {connectionManifest.auth.secretNames.map((secretName) => (
          <SettingsField key={secretName} label={secretTitle} required>
            <SettingsPasswordInput
              value={secretValues[secretName] ?? ""}
              placeholder={secretName === "apiKey" ? "sk-..." : ""}
              showLabel={showSecretLabel}
              hideLabel={hideSecretLabel}
              onChange={(event) => {
                const nextValue = event.target.value
                onSecretChange(secretName, nextValue)
              }}
              onBlur={(event) => {
                if (isSecretDirty(secretName)) {
                  onSecretCommit(secretName, event.currentTarget.value)
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur()
                }
              }}
              spellCheck={false}
            />
          </SettingsField>
        ))}
      </div>
      {error ? (
        <div className="mt-[var(--ow-space-2)] [font-size:var(--ow-font-meta)] text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  )
}

export function ExtensionsTab(props: {
  focusTarget?: SettingsWindowTarget | null
  locale: AppLocale
}): React.JSX.Element {
  const { focusTarget = null, locale } = props
  const focusedCommandName = focusTarget?.commandName
  const focusedExtensionName = focusTarget?.extensionName ?? null
  const copy = getSettingsCopy(locale)
  const [models, setModels] = useState<ModelConfig[]>([])
  const [schemas, setSchemas] = useState<InstalledNativeExtensionSettingsSchema[]>([])
  const [extensionRecords, setExtensionRecords] = useState<Record<string, Record<string, unknown>>>(
    {}
  )
  const [commandRecords, setCommandRecords] = useState<Record<string, Record<string, unknown>>>({})
  const [connectionRecords, setConnectionRecords] = useState<
    Record<string, NativeExtensionResolvedConnection>
  >({})
  const [connectionErrors, setConnectionErrors] = useState<Record<string, string>>({})
  const [connectingExtensions, setConnectingExtensions] = useState<Record<string, boolean>>({})
  const [connectionSecretRecords, setConnectionSecretRecords] = useState<
    Record<string, Record<string, string>>
  >({})
  const [selectedExtName, setSelectedExtName] = useState<string | null>(focusedExtensionName)
  const [search, setSearch] = useState("")

  const loadModels = useEffectEvent(async (signal: AbortSignal): Promise<void> => {
    const nextModels = await window.api.models.list("llm")
    if (signal.aborted) {
      return
    }

    setModels(nextModels)
  })

  const loadSchemas = useEffectEvent(
    async (targetExtensionName: string | null, signal: AbortSignal): Promise<void> => {
      const nextSchemas = await window.api.nativeExtensions.listSettingsSchemas()
      if (signal.aborted) {
        return
      }
      const sortedSchemas = [...nextSchemas].sort((left, right) =>
        resolveExtensionText(left.title, locale, left.extName).localeCompare(
          resolveExtensionText(right.title, locale, right.extName)
        )
      )
      setSchemas(sortedSchemas)
      setSelectedExtName((current) => {
        if (targetExtensionName) {
          return targetExtensionName
        }

        if (current && sortedSchemas.some((schema) => schema.extName === current)) {
          return current
        }

        return sortedSchemas[0]?.extName ?? null
      })

      const extensionEntries = await Promise.all(
        sortedSchemas.map(async (schema) => [
          schema.extName,
          await window.api.nativeExtensions.getPreferences(schema.extName)
        ])
      )
      const connectionEntries = await Promise.all(
        sortedSchemas
          .filter((schema) => schema.connection)
          .map(
            async (schema) =>
              [
                schema.extName,
                await window.api.nativeExtensions.getConnection(schema.extName)
              ] as const
          )
      )
      const commandEntries = await Promise.all(
        sortedSchemas.flatMap((schema) =>
          schema.commands.map(async (command) => [
            `${schema.extName}:${command.name}`,
            await window.api.nativeExtensions.getCommandPreferences(schema.extName, command.name)
          ])
        )
      )
      if (signal.aborted) {
        return
      }

      setExtensionRecords(Object.fromEntries(extensionEntries))
      setConnectionRecords(Object.fromEntries(connectionEntries))
      setCommandRecords(Object.fromEntries(commandEntries))
    }
  )

  const refreshExtensionConnection = useEffectEvent(
    async (extensionName: string): Promise<void> => {
      const schema = schemas.find((candidate) => candidate.extName === extensionName)
      if (!schema?.connection) {
        return
      }

      const connection = await window.api.nativeExtensions.getConnection(extensionName)
      setConnectionRecords((current) => ({
        ...current,
        [extensionName]: connection
      }))
    }
  )

  useEffect(() => {
    const controller = new AbortController()
    const handleFocus = (): void => {
      void loadSchemas(focusedExtensionName, controller.signal)
      void loadModels(controller.signal)
    }

    handleFocus()
    window.addEventListener("focus", handleFocus)
    return () => {
      controller.abort()
      window.removeEventListener("focus", handleFocus)
    }
  }, [focusedExtensionName, locale])

  useEffect(() => {
    return window.api.nativeExtensions.onPreferencesChanged((event) => {
      if (event.scope !== "extension") {
        return
      }

      void refreshExtensionConnection(event.extensionName)
    })
  }, [])

  const modelOptions = useMemo(
    () =>
      models
        .filter((model) => model.status === "active")
        .map((model) => ({
          id: model.id,
          label: `${model.name} · ${model.provider}`
        })),
    [models]
  )

  const filteredSchemas = useMemo(() => {
    const normalizedQuery = search.trim().toLowerCase()
    if (!normalizedQuery) {
      return schemas
    }

    return schemas.filter((schema) => {
      const extensionPreferenceHaystack = schema.preferences
        .flatMap((preference) => [
          resolvePreferenceLabel(preference, locale),
          preference.name,
          resolveExtensionText(preference.description, locale)
        ])
        .join(" ")
        .toLowerCase()
      const commandHaystack = schema.commands
        .flatMap((command) => [
          resolveExtensionText(command.title, locale, command.name),
          command.name,
          resolveExtensionText(command.description, locale),
          ...(command.keywords ?? [])
        ])
        .join(" ")
        .toLowerCase()
      const title = resolveExtensionText(schema.title, locale, schema.extName)
      const description = resolveExtensionText(schema.description, locale)

      return (
        title.toLowerCase().includes(normalizedQuery) ||
        schema.extName.toLowerCase().includes(normalizedQuery) ||
        description.toLowerCase().includes(normalizedQuery) ||
        extensionPreferenceHaystack.includes(normalizedQuery) ||
        commandHaystack.includes(normalizedQuery)
      )
    })
  }, [locale, schemas, search])

  const selectedSchema =
    filteredSchemas.find((schema) => schema.extName === selectedExtName) ??
    schemas.find((schema) => schema.extName === selectedExtName) ??
    filteredSchemas[0] ??
    null

  const updateCommandPreferenceDraft = (
    extensionName: string,
    commandName: string,
    preferenceName: string,
    nextValue: unknown
  ): void => {
    const recordKey = `${extensionName}:${commandName}`
    setCommandRecords((current) => ({
      ...current,
      [recordKey]: {
        ...(current[recordKey] ?? {}),
        [preferenceName]: nextValue
      }
    }))
  }

  const updateCommandPreference = async (
    extensionName: string,
    commandName: string,
    preferenceName: string,
    nextValue: unknown
  ): Promise<void> => {
    const recordKey = `${extensionName}:${commandName}`
    const currentRecord = commandRecords[recordKey] ?? {}
    const nextRecord = await window.api.nativeExtensions.setCommandPreferences(
      extensionName,
      commandName,
      buildPreferenceUpdateRecord({
        currentRecord,
        nextValue,
        preferenceName
      })
    )

    setCommandRecords((current) => {
      const currentRecord = current[recordKey] ?? {}
      return {
        ...current,
        [recordKey]: {
          ...nextRecord,
          ...currentRecord,
          [preferenceName]: Object.is(currentRecord[preferenceName], nextValue)
            ? nextRecord[preferenceName]
            : currentRecord[preferenceName]
        }
      }
    })
  }

  const updateExtensionPreferenceDraft = (
    extensionName: string,
    preferenceName: string,
    nextValue: unknown
  ): void => {
    setExtensionRecords((current) => ({
      ...current,
      [extensionName]: {
        ...(current[extensionName] ?? {}),
        [preferenceName]: nextValue
      }
    }))
  }

  const updateExtensionPreference = async (
    extensionName: string,
    preferenceName: string,
    nextValue: unknown
  ): Promise<void> => {
    const currentRecord = extensionRecords[extensionName] ?? {}
    const nextRecord = await window.api.nativeExtensions.setPreferences(
      extensionName,
      buildPreferenceUpdateRecord({
        currentRecord,
        nextValue,
        preferenceName
      })
    )

    setExtensionRecords((current) => {
      const currentRecord = current[extensionName] ?? {}
      return {
        ...current,
        [extensionName]: {
          ...nextRecord,
          ...currentRecord,
          [preferenceName]: Object.is(currentRecord[preferenceName], nextValue)
            ? nextRecord[preferenceName]
            : currentRecord[preferenceName]
        }
      }
    })
  }

  const startOAuthConnection = async (extensionName: string): Promise<void> => {
    try {
      setConnectionErrors((current) => {
        const next = { ...current }
        delete next[extensionName]
        return next
      })
      setConnectingExtensions((current) => ({
        ...current,
        [extensionName]: true
      }))
      await window.api.nativeExtensions.startOAuthConnection({ extensionName })
      const connection = await window.api.nativeExtensions.getConnection(extensionName)
      setConnectionRecords((current) => ({
        ...current,
        [extensionName]: connection
      }))
    } catch (error) {
      console.error("[ExtensionsTab] Failed to start OAuth connection:", error)
      setConnectionErrors((current) => ({
        ...current,
        [extensionName]: copy.extensions.connectFailed
      }))
    } finally {
      setConnectingExtensions((current) => {
        const next = { ...current }
        delete next[extensionName]
        return next
      })
    }
  }

  const updateConnectionSecretDraft = (
    extensionName: string,
    secretName: string,
    nextValue: string
  ): void => {
    setConnectionSecretRecords((current) => ({
      ...current,
      [extensionName]: {
        ...(current[extensionName] ?? {}),
        [secretName]: nextValue
      }
    }))
  }

  const updateConnectionSecret = async (
    extensionName: string,
    secretName: string,
    nextValue: string
  ): Promise<void> => {
    try {
      setConnectionErrors((current) => {
        const next = { ...current }
        delete next[extensionName]
        return next
      })
      const currentRecord = connectionSecretRecords[extensionName] ?? {}
      const connection = await window.api.nativeExtensions.setConnectionSecrets({
        extensionName,
        secrets: {
          ...currentRecord,
          [secretName]: nextValue
        }
      })
      setConnectionRecords((current) => ({
        ...current,
        [extensionName]: connection
      }))
      setConnectionSecretRecords((current) => {
        const extensionDraft = current[extensionName]
        if (!extensionDraft || !Object.prototype.hasOwnProperty.call(extensionDraft, secretName)) {
          return current
        }

        const nextExtensionDraft = { ...extensionDraft }
        delete nextExtensionDraft[secretName]
        if (Object.keys(nextExtensionDraft).length === 0) {
          const next = { ...current }
          delete next[extensionName]
          return next
        }

        return {
          ...current,
          [extensionName]: nextExtensionDraft
        }
      })
    } catch (error) {
      console.error("[ExtensionsTab] Failed to save connection secret:", error)
      setConnectionErrors((current) => ({
        ...current,
        [extensionName]: copy.extensions.connectFailed
      }))
    }
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[var(--ow-settings-sidebar-w)_minmax(0,1fr)] gap-[var(--ow-gap-lg)]">
      <aside
        className={`${settingsCardClassName} flex min-h-0 flex-col gap-[var(--ow-gap-md)] p-[var(--ow-settings-card-y)]`}
      >
        <div className="space-y-[var(--ow-space-1)]">
          <div className="[font-size:var(--ow-settings-title-size)] font-semibold text-foreground">
            {copy.extensions.title}
          </div>
          <div className="[font-size:var(--ow-settings-description-size)] leading-[var(--ow-line-body)] text-muted-foreground">
            {copy.extensions.rootsDescription}
          </div>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-[var(--ow-space-3)] top-1/2 h-[var(--ow-icon-action)] w-[var(--ow-icon-action)] -translate-y-1/2 text-muted-foreground" />
          <input
            className={`${inputClassName} pl-[var(--ow-control-icon-inset)]`}
            placeholder={copy.extensions.installedTitle}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
        </div>

        <div className="min-h-0 flex-1 space-y-[var(--ow-space-2)] overflow-y-auto pr-[var(--ow-space-1)]">
          {filteredSchemas.length === 0 ? (
            <div
              className={`${settingsInsetCardClassName} border-dashed [font-size:var(--ow-font-body)] text-muted-foreground`}
            >
              {copy.extensions.empty}
            </div>
          ) : (
            filteredSchemas.map((schema) => {
              const isSelected = selectedSchema?.extName === schema.extName
              const title = resolveExtensionText(schema.title, locale, schema.extName)
              const description = resolveExtensionText(schema.description, locale, schema.extName)

              return (
                <button
                  key={schema.extName}
                  type="button"
                  data-extension-selected={isSelected ? schema.extName : undefined}
                  onClick={() => setSelectedExtName(schema.extName)}
                  className={`w-full rounded-[var(--ow-settings-card-radius)] border px-[var(--ow-space-3)] py-[var(--ow-space-2)] text-left transition ${
                    isSelected
                      ? "border-[var(--ring)] bg-background"
                      : "border-border/70 bg-background-elevated/60 hover:bg-background"
                  }`}
                >
                  <div className="flex items-start justify-between gap-[var(--ow-gap-md)]">
                    <div className="min-w-0 space-y-[var(--ow-space-1)]">
                      <div className="flex items-center gap-[var(--ow-gap-sm)]">
                        <ExtensionIcon
                          className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)] text-muted-foreground"
                          extensionName={schema.extName}
                          icon={schema.icon}
                          iconName={schema.iconName}
                        />
                        <span className="truncate [font-size:var(--ow-font-label)] font-semibold text-foreground">
                          {title}
                        </span>
                      </div>
                      <div className="line-clamp-2 [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-muted-foreground">
                        {description}
                      </div>
                    </div>
                    <div className="shrink-0 rounded-full border border-border bg-background px-[var(--ow-space-2)] py-0.5 [font-size:var(--ow-font-caption)] uppercase tracking-[0.08em] text-muted-foreground">
                      {schema.commands.length}
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </aside>

      <section className="min-h-0 overflow-y-auto pr-[var(--ow-space-1)]">
        {selectedSchema ? (
          <div className="space-y-[var(--ow-space-4)]">
            <div
              className={`${settingsCardClassName} px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)]`}
            >
              <div className="space-y-[var(--ow-space-1)]">
                <div className="flex items-center gap-[var(--ow-gap-sm)]">
                  <Settings2 className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)] text-muted-foreground" />
                  <h2 className="[font-size:var(--ow-settings-title-size)] font-semibold text-foreground">
                    {resolveExtensionText(selectedSchema.title, locale, selectedSchema.extName)}
                  </h2>
                </div>
                <div className="[font-size:var(--ow-settings-description-size)] leading-[var(--ow-line-body)] text-muted-foreground">
                  {resolveExtensionText(selectedSchema.description, locale, selectedSchema.extName)}
                </div>
              </div>
            </div>

            <div className="space-y-[var(--ow-space-3)]">
              {selectedSchema.connection ? (
                selectedSchema.connection.auth.type === "oauth" ? (
                  <OAuthConnectionCard
                    connection={connectionRecords[selectedSchema.extName] ?? null}
                    error={connectionErrors[selectedSchema.extName] ?? null}
                    isConnecting={connectingExtensions[selectedSchema.extName] ?? false}
                    onConnect={() => {
                      void startOAuthConnection(selectedSchema.extName)
                    }}
                    statusLabels={{
                      connected: copy.extensions.connectionConnected,
                      connect: copy.extensions.connectAccount,
                      connecting: copy.extensions.connectingAccount,
                      description: copy.extensions.connectionDescription,
                      missing: copy.extensions.connectionMissing,
                      title: copy.extensions.connectionTitle
                    }}
                  />
                ) : isLocalSecretConnection(selectedSchema.connection) ? (
                  <SecretConnectionCard
                    connection={connectionRecords[selectedSchema.extName] ?? null}
                    connectionManifest={selectedSchema.connection}
                    error={connectionErrors[selectedSchema.extName] ?? null}
	                    hideSecretLabel={copy.common.hideSecret}
                    isSecretDirty={(secretName) =>
                      Object.prototype.hasOwnProperty.call(
                        connectionSecretRecords[selectedSchema.extName] ?? {},
                        secretName
                      )
                    }
	                    onSecretChange={(secretName, nextValue) => {
	                      updateConnectionSecretDraft(selectedSchema.extName, secretName, nextValue)
	                    }}
                    onSecretCommit={(secretName, nextValue) => {
                      void updateConnectionSecret(selectedSchema.extName, secretName, nextValue)
                    }}
                    secretValues={connectionSecretRecords[selectedSchema.extName] ?? {}}
                    showSecretLabel={copy.common.showSecret}
                    statusLabels={{
                      connected: copy.extensions.connectionConnected,
                      description: copy.extensions.connectionDescription,
                      missing: copy.extensions.connectionMissing,
                      title: copy.extensions.connectionTitle
                    }}
                  />
                ) : null
              ) : null}

              {selectedSchema.preferences.length > 0 ? (
                <div
                  className={`${settingsCardClassName} px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)]`}
                >
                  <PreferenceSection
                    disabledLabel={copy.extensions.disabled}
                    emptyLabel={copy.extensions.noPreferences}
                    enabledLabel={copy.extensions.enabled}
                    locale={locale}
                    modelOptions={modelOptions}
                    onChange={(preferenceName, nextValue) => {
                      updateExtensionPreferenceDraft(
                        selectedSchema.extName,
                        preferenceName,
                        nextValue
                      )
                    }}
                    onCommit={(preferenceName, nextValue) => {
                      void updateExtensionPreference(
                        selectedSchema.extName,
                        preferenceName,
                        nextValue
                      )
                    }}
                    preferences={selectedSchema.preferences}
                    useEnvironmentFallbackLabel={copy.general.useEnvironmentFallback}
                    values={extensionRecords[selectedSchema.extName] ?? {}}
                  />
                </div>
              ) : null}

              {selectedSchema.commands.map((command) => (
                <CommandCard
                  commandName={command.name}
                  key={`${selectedSchema.extName}:${command.name}`}
                  commandNameFocus={focusedCommandName}
                  description={resolveExtensionText(command.description, locale, command.name)}
                  disabledLabel={copy.extensions.disabled}
                  emptyLabel={copy.extensions.noPreferences}
                  enabledLabel={copy.extensions.enabled}
                  extensionName={selectedSchema.extName}
                  icon={command.icon}
                  iconName={command.iconName}
                  labelMode={copy.extensions.mode}
                  locale={locale}
                  mode={command.mode}
                  modelOptions={modelOptions}
                  onChange={(preferenceName, nextValue) => {
                    updateCommandPreferenceDraft(
                      selectedSchema.extName,
                      command.name,
                      preferenceName,
                      nextValue
                    )
                  }}
                  onCommit={(preferenceName, nextValue) => {
                    void updateCommandPreference(
                      selectedSchema.extName,
                      command.name,
                      preferenceName,
                      nextValue
                    )
                  }}
                  preferences={command.preferences}
                  title={resolveExtensionText(command.title, locale, command.name)}
                  useEnvironmentFallbackLabel={copy.general.useEnvironmentFallback}
                  values={commandRecords[`${selectedSchema.extName}:${command.name}`] ?? {}}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded-[var(--ow-settings-card-radius)] border border-dashed border-border bg-background-elevated/60 [font-size:var(--ow-font-label)] text-muted-foreground">
            {copy.extensions.empty}
          </div>
        )}
      </section>
    </div>
  )
}
