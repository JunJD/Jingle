import { useEffect, useEffectEvent, useMemo, useState } from "react"
import { Search, Settings2 } from "lucide-react"
import type { ModelConfig } from "@shared/app-types"
import type { AppLocale } from "@shared/i18n"
import type {
  InstalledNativeExtensionSettingsSchema,
  NativeExtensionPreferenceSchema
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

function formatCommandMode(mode: string): string {
  if (mode === "no-view") {
    return "No View"
  }

  if (mode === "menu-bar") {
    return "Menu Bar"
  }

  return mode.charAt(0).toUpperCase() + mode.slice(1)
}

function PreferenceField(props: {
  disabledLabel: string
  enabledLabel: string
  modelOptions: Array<{ id: string; label: string }>
  onChange: (nextValue: unknown) => void
  preference: NativeExtensionPreferenceSchema
  hideSecretLabel: string
  showSecretLabel: string
  useEnvironmentFallbackLabel: string
  value: unknown
}): React.JSX.Element {
  const {
    disabledLabel,
    enabledLabel,
    hideSecretLabel,
    modelOptions,
    onChange,
    preference,
    showSecretLabel,
    useEnvironmentFallbackLabel,
    value
  } = props
  const fieldLabel = preference.title || preference.label || preference.name

  return (
    <SettingsField
      label={fieldLabel}
      description={preference.description}
      required={preference.required}
    >
      {preference.type === "checkbox" ? (
        <div className="flex min-h-[var(--ow-settings-control-h)] items-center justify-between gap-[var(--ow-gap-md)] rounded-[var(--ow-radius-md)] border border-border bg-background-elevated px-[var(--ow-space-3)] py-[var(--ow-space-1)] [font-size:var(--ow-settings-control-font)] text-foreground">
          <span className="min-w-0 truncate text-muted-foreground">
            {value === true ? enabledLabel : disabledLabel}
          </span>
          <SettingsSwitch checked={value === true} label={fieldLabel} onCheckedChange={onChange} />
        </div>
      ) : preference.type === "dropdown" ? (
        <SettingsSelect
          value={String(value ?? "")}
          onChange={(event) => {
            onChange(event.target.value)
          }}
        >
          {(preference.data ?? []).map((entry) => (
            <option key={entry.value ?? entry.title ?? ""} value={entry.value ?? ""}>
              {entry.title ?? entry.value ?? ""}
            </option>
          ))}
        </SettingsSelect>
      ) : preference.type === "model" ? (
        <SettingsSelect
          value={String(value ?? "")}
          onChange={(event) => {
            onChange(event.target.value || null)
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
          placeholder={preference.placeholder ?? "Application name"}
          onChange={(event) => {
            onChange(normalizeNativeExtensionApplicationPreferenceValue(event.target.value))
          }}
          spellCheck={false}
        />
      ) : preference.type === "password" ? (
        <SettingsPasswordInput
          value={String(value ?? "")}
          placeholder={preference.placeholder}
          showLabel={showSecretLabel}
          hideLabel={hideSecretLabel}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          spellCheck={false}
        />
      ) : (
        <SettingsTextInput
          type="text"
          value={String(value ?? "")}
          placeholder={preference.placeholder}
          onChange={(event) => {
            onChange(event.target.value)
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
  preferences: NativeExtensionPreferenceSchema[]
  hideSecretLabel: string
  showSecretLabel: string
  title?: string
  useEnvironmentFallbackLabel: string
  values: Record<string, unknown>
}): React.JSX.Element {
  const {
    disabledLabel,
    emptyLabel,
    enabledLabel,
    hideSecretLabel,
    modelOptions,
    onChange,
    preferences,
    showSecretLabel,
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
              hideSecretLabel={hideSecretLabel}
              modelOptions={modelOptions}
              onChange={(nextValue) => {
                onChange(preference.name, nextValue)
              }}
              preference={preference}
              showSecretLabel={showSecretLabel}
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
  preferences: NativeExtensionPreferenceSchema[]
}): Record<string, unknown> {
  const passwordPreferenceNames = new Set(
    params.preferences
      .filter((preference) => preference.type === "password")
      .map((preference) => preference.name)
  )

  return {
    ...Object.fromEntries(
      Object.entries(params.currentRecord).filter(
        ([key]) => !passwordPreferenceNames.has(key) || key === params.preferenceName
      )
    ),
    [params.preferenceName]: params.nextValue
  }
}

function isPasswordPreference(
  preferences: NativeExtensionPreferenceSchema[],
  preferenceName: string
): boolean {
  return preferences.some(
    (preference) => preference.name === preferenceName && preference.type === "password"
  )
}

function buildPreferenceRecordForLocalState(params: {
  nextRecord: Record<string, unknown>
  nextValue: unknown
  preferenceName: string
  preferences: NativeExtensionPreferenceSchema[]
}): Record<string, unknown> {
  if (!isPasswordPreference(params.preferences, params.preferenceName)) {
    return params.nextRecord
  }

  return {
    ...params.nextRecord,
    [params.preferenceName]: params.nextValue
  }
}

function CommandCard(props: {
  commandName: string
  commandNameFocus?: string
  disabledLabel: string
  emptyLabel: string
  enabledLabel: string
  hideSecretLabel: string
  labelMode: string
  modelOptions: Array<{ id: string; label: string }>
  onChange: (preferenceName: string, nextValue: unknown) => void
  preferences: NativeExtensionPreferenceSchema[]
  showSecretLabel: string
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
    hideSecretLabel,
    icon,
    iconName,
    labelMode,
    modelOptions,
    mode,
    onChange,
    preferences,
    showSecretLabel,
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
          {labelMode}: {formatCommandMode(mode)}
        </div>
      </div>
      <div className="mt-[var(--ow-space-3)]">
        <PreferenceSection
          disabledLabel={disabledLabel}
          emptyLabel={emptyLabel}
          enabledLabel={enabledLabel}
          hideSecretLabel={hideSecretLabel}
          modelOptions={modelOptions}
          onChange={onChange}
          preferences={preferences}
          showSecretLabel={showSecretLabel}
          useEnvironmentFallbackLabel={useEnvironmentFallbackLabel}
          values={values}
        />
      </div>
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
        left.title.localeCompare(right.title)
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
      setCommandRecords(Object.fromEntries(commandEntries))
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
  }, [focusedExtensionName])

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
          preference.title,
          preference.name,
          preference.description,
          preference.label
        ])
        .join(" ")
        .toLowerCase()
      const commandHaystack = schema.commands
        .flatMap((command) => [
          command.title,
          command.name,
          command.description,
          ...(command.keywords ?? [])
        ])
        .join(" ")
        .toLowerCase()

      return (
        schema.title.toLowerCase().includes(normalizedQuery) ||
        schema.extName.toLowerCase().includes(normalizedQuery) ||
        schema.description.toLowerCase().includes(normalizedQuery) ||
        extensionPreferenceHaystack.includes(normalizedQuery) ||
        commandHaystack.includes(normalizedQuery)
      )
    })
  }, [schemas, search])

  const selectedSchema =
    filteredSchemas.find((schema) => schema.extName === selectedExtName) ??
    schemas.find((schema) => schema.extName === selectedExtName) ??
    filteredSchemas[0] ??
    null

  const updateCommandPreference = async (
    extensionName: string,
    commandName: string,
    preferences: NativeExtensionPreferenceSchema[],
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
        preferenceName,
        preferences
      })
    )

    setCommandRecords((current) => ({
      ...current,
      [recordKey]: buildPreferenceRecordForLocalState({
        nextRecord,
        nextValue,
        preferenceName,
        preferences
      })
    }))
  }

  const updateExtensionPreference = async (
    extensionName: string,
    preferences: NativeExtensionPreferenceSchema[],
    preferenceName: string,
    nextValue: unknown
  ): Promise<void> => {
    const currentRecord = extensionRecords[extensionName] ?? {}
    const nextRecord = await window.api.nativeExtensions.setPreferences(
      extensionName,
      buildPreferenceUpdateRecord({
        currentRecord,
        nextValue,
        preferenceName,
        preferences
      })
    )

    setExtensionRecords((current) => ({
      ...current,
      [extensionName]: buildPreferenceRecordForLocalState({
        nextRecord,
        nextValue,
        preferenceName,
        preferences
      })
    }))
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
                          {schema.title}
                        </span>
                      </div>
                      <div className="line-clamp-2 [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-muted-foreground">
                        {schema.description || schema.extName}
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
                    {selectedSchema.title}
                  </h2>
                </div>
                <div className="[font-size:var(--ow-settings-description-size)] leading-[var(--ow-line-body)] text-muted-foreground">
                  {selectedSchema.description || selectedSchema.extName}
                </div>
              </div>
            </div>

            <div className="space-y-[var(--ow-space-3)]">
              {selectedSchema.preferences.length > 0 ? (
                <div
                  className={`${settingsCardClassName} px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)]`}
                >
                  <PreferenceSection
                    disabledLabel={copy.extensions.disabled}
                    emptyLabel={copy.extensions.noPreferences}
                    enabledLabel={copy.extensions.enabled}
                    hideSecretLabel={copy.common.hideSecret}
                    modelOptions={modelOptions}
                    onChange={(preferenceName, nextValue) => {
                      void updateExtensionPreference(
                        selectedSchema.extName,
                        selectedSchema.preferences,
                        preferenceName,
                        nextValue
                      )
                    }}
                    preferences={selectedSchema.preferences}
                    showSecretLabel={copy.common.showSecret}
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
                  description={command.description || command.name}
                  disabledLabel={copy.extensions.disabled}
                  emptyLabel={copy.extensions.noPreferences}
                  enabledLabel={copy.extensions.enabled}
                  extensionName={selectedSchema.extName}
                  hideSecretLabel={copy.common.hideSecret}
                  icon={command.icon}
                  iconName={command.iconName}
                  labelMode={copy.extensions.mode}
                  mode={command.mode}
                  modelOptions={modelOptions}
                  onChange={(preferenceName, nextValue) => {
                    void updateCommandPreference(
                      selectedSchema.extName,
                      command.name,
                      command.preferences,
                      preferenceName,
                      nextValue
                    )
                  }}
                  preferences={command.preferences}
                  showSecretLabel={copy.common.showSecret}
                  title={command.title}
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
