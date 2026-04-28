import { useEffect, useEffectEvent, useMemo, useState } from "react"
import { Puzzle, Search, Settings2, TerminalSquare } from "lucide-react"
import type { ModelConfig } from "@shared/app-types"
import type { AppLocale } from "@shared/i18n"
import type {
  InstalledNativeExtensionSettingsSchema,
  NativeExtensionPreferenceSchema
} from "@shared/native-extensions"
import type { SettingsWindowTarget } from "@shared/settings-window"
import { getSettingsCopy } from "./copy"

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
  useEnvironmentFallbackLabel: string
  value: unknown
}): React.JSX.Element {
  const {
    disabledLabel,
    enabledLabel,
    modelOptions,
    onChange,
    preference,
    useEnvironmentFallbackLabel,
    value
  } = props
  const inputClassName =
    "h-[var(--ow-control-h-md)] w-full rounded-[var(--ow-radius-md)] border border-border bg-background-elevated px-[var(--ow-space-3)] [font-size:var(--ow-font-control)] text-foreground outline-none transition focus:border-[var(--ring)]"

  return (
    <div className="block space-y-[var(--ow-space-1-5)]">
      <div className="flex items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-meta)] font-medium text-foreground">
        <span>{preference.title || preference.label || preference.name}</span>
        {preference.required ? (
          <span className="[font-size:var(--ow-font-meta)] text-muted-foreground">*</span>
        ) : null}
      </div>
      {preference.description ? (
        <div className="[font-size:var(--ow-font-meta)] leading-4 text-muted-foreground">
          {preference.description}
        </div>
      ) : null}
      {preference.type === "checkbox" ? (
        <label className="flex h-[var(--ow-control-h-md)] items-center justify-between gap-[var(--ow-gap-md)] rounded-[var(--ow-radius-md)] border border-border bg-background-elevated px-[var(--ow-space-3)] [font-size:var(--ow-font-control)] text-foreground">
          <span className="text-muted-foreground">
            {value === true ? enabledLabel : disabledLabel}
          </span>
          <input
            type="checkbox"
            checked={value === true}
            onChange={(event) => {
              onChange(event.target.checked)
            }}
          />
        </label>
      ) : preference.type === "dropdown" ? (
        <select
          className={inputClassName}
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
        </select>
      ) : preference.type === "model" ? (
        <select
          className={inputClassName}
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
        </select>
      ) : (
        <input
          className={inputClassName}
          type={preference.type === "password" ? "password" : "text"}
          value={String(value ?? "")}
          placeholder={preference.placeholder}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          spellCheck={false}
        />
      )}
    </div>
  )
}

function PreferenceSection(props: {
  disabledLabel: string
  emptyLabel: string
  enabledLabel: string
  modelOptions: Array<{ id: string; label: string }>
  onChange: (preferenceName: string, nextValue: unknown) => void
  preferences: NativeExtensionPreferenceSchema[]
  title?: string
  useEnvironmentFallbackLabel: string
  values: Record<string, unknown>
}): React.JSX.Element {
  const {
    disabledLabel,
    emptyLabel,
    enabledLabel,
    modelOptions,
    onChange,
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
        <div className="rounded-lg border border-dashed border-border bg-background px-[var(--ow-space-3)] py-[var(--ow-space-3)] [font-size:var(--ow-font-body)] text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <div className="space-y-[var(--ow-space-4)]">
          {preferences.map((preference) => (
            <PreferenceField
              key={preference.name}
              disabledLabel={disabledLabel}
              enabledLabel={enabledLabel}
              modelOptions={modelOptions}
              onChange={(nextValue) => {
                onChange(preference.name, nextValue)
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

function CommandCard(props: {
  commandName: string
  commandNameFocus?: string
  disabledLabel: string
  emptyLabel: string
  enabledLabel: string
  labelMode: string
  modelOptions: Array<{ id: string; label: string }>
  onChange: (preferenceName: string, nextValue: unknown) => void
  preferences: NativeExtensionPreferenceSchema[]
  title: string
  useEnvironmentFallbackLabel: string
  values: Record<string, unknown>
  description: string
  mode: string
}): React.JSX.Element {
  const {
    commandName,
    commandNameFocus,
    description,
    disabledLabel,
    emptyLabel,
    enabledLabel,
    labelMode,
    modelOptions,
    mode,
    onChange,
    preferences,
    title,
    useEnvironmentFallbackLabel,
    values
  } = props

  const isFocused = commandNameFocus === commandName

  return (
    <div
      className={`rounded-[var(--ow-radius-panel)] border bg-background-elevated/65 p-[var(--ow-space-4)] ${
        isFocused ? "border-[var(--ring)]" : "border-border/80"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-[var(--ow-gap-md)]">
        <div className="space-y-[var(--ow-space-1)]">
          <div className="flex items-center gap-[var(--ow-gap-sm)]">
            <TerminalSquare className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)] text-muted-foreground" />
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
      <div className="mt-[var(--ow-space-4)]">
        <PreferenceSection
          disabledLabel={disabledLabel}
          emptyLabel={emptyLabel}
          enabledLabel={enabledLabel}
          modelOptions={modelOptions}
          onChange={onChange}
          preferences={preferences}
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
    preferenceName: string,
    nextValue: unknown
  ): Promise<void> => {
    const recordKey = `${extensionName}:${commandName}`
    const currentRecord = commandRecords[recordKey] ?? {}
    const nextRecord = await window.api.nativeExtensions.setCommandPreferences(
      extensionName,
      commandName,
      {
        ...currentRecord,
        [preferenceName]: nextValue
      }
    )

    setCommandRecords((current) => ({
      ...current,
      [recordKey]: nextRecord
    }))
  }

  const updateExtensionPreference = async (
    extensionName: string,
    preferenceName: string,
    nextValue: unknown
  ): Promise<void> => {
    const currentRecord = extensionRecords[extensionName] ?? {}
    const nextRecord = await window.api.nativeExtensions.setPreferences(extensionName, {
      ...currentRecord,
      [preferenceName]: nextValue
    })

    setExtensionRecords((current) => ({
      ...current,
      [extensionName]: nextRecord
    }))
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[var(--ow-settings-sidebar-w)_minmax(0,1fr)] gap-[var(--ow-gap-lg)]">
      <aside className="flex min-h-0 flex-col gap-[var(--ow-gap-md)] overflow-hidden rounded-[var(--ow-radius-panel)] border border-border/80 bg-background-secondary/55 p-[var(--ow-space-3)] shadow-[0_12px_32px_rgba(32,38,45,0.05)]">
        <div className="space-y-[var(--ow-space-1)]">
          <div className="[font-size:var(--ow-font-display)] font-semibold text-foreground">
            {copy.extensions.title}
          </div>
          <div className="[font-size:var(--ow-font-label)] text-muted-foreground">
            {copy.extensions.rootsDescription}
          </div>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-[var(--ow-space-3)] top-1/2 h-[var(--ow-icon-action)] w-[var(--ow-icon-action)] -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full rounded-[var(--ow-radius-md)] border border-border bg-background-elevated py-[var(--ow-space-1-5)] pl-[var(--ow-control-icon-inset)] pr-[var(--ow-space-3)] [font-size:var(--ow-font-label)] text-foreground outline-none transition focus:border-[var(--ring)]"
            placeholder={copy.extensions.installedTitle}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
        </div>

        <div className="min-h-0 flex-1 space-y-[var(--ow-space-2)] overflow-y-auto pr-[var(--ow-space-1)]">
          {filteredSchemas.length === 0 ? (
            <div className="rounded-[var(--ow-radius-lg)] border border-dashed border-border bg-background px-[var(--ow-space-3)] py-[var(--ow-space-3)] [font-size:var(--ow-font-body)] text-muted-foreground">
              {copy.extensions.empty}
            </div>
          ) : (
            filteredSchemas.map((schema) => {
              const isSelected = selectedSchema?.extName === schema.extName

              return (
                <button
                  key={schema.extName}
                  type="button"
                  onClick={() => setSelectedExtName(schema.extName)}
                  className={`w-full rounded-[var(--ow-radius-lg)] border px-[var(--ow-space-3)] py-[var(--ow-space-2-5)] text-left transition ${
                    isSelected
                      ? "border-[var(--ring)] bg-background"
                      : "border-border/70 bg-background-elevated/60 hover:bg-background"
                  }`}
                >
                  <div className="flex items-start justify-between gap-[var(--ow-gap-md)]">
                    <div className="min-w-0 space-y-[var(--ow-space-1)]">
                      <div className="flex items-center gap-[var(--ow-gap-sm)]">
                        <Puzzle className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)] text-muted-foreground" />
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
            <div className="rounded-[var(--ow-radius-panel)] border border-border/80 bg-background-secondary/55 p-[var(--ow-space-4)] shadow-[0_12px_32px_rgba(32,38,45,0.05)]">
              <div className="space-y-[var(--ow-space-1)]">
                <div className="flex items-center gap-[var(--ow-gap-sm)]">
                  <Settings2 className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)] text-muted-foreground" />
                  <h2 className="[font-size:var(--ow-font-display)] font-semibold text-foreground">
                    {selectedSchema.title}
                  </h2>
                </div>
                <div className="[font-size:var(--ow-font-label)] leading-[var(--ow-line-control-sm)] text-muted-foreground">
                  {selectedSchema.description || selectedSchema.extName}
                </div>
              </div>
            </div>

            <div className="space-y-[var(--ow-space-3)]">
              {selectedSchema.preferences.length > 0 ? (
                <div className="rounded-[var(--ow-radius-panel)] border border-border/80 bg-background-secondary/55 p-[var(--ow-space-4)] shadow-[0_12px_32px_rgba(32,38,45,0.05)]">
                  <PreferenceSection
                    disabledLabel={copy.extensions.disabled}
                    emptyLabel={copy.extensions.noPreferences}
                    enabledLabel={copy.extensions.enabled}
                    modelOptions={modelOptions}
                    onChange={(preferenceName, nextValue) => {
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
                  description={command.description || command.name}
                  disabledLabel={copy.extensions.disabled}
                  emptyLabel={copy.extensions.noPreferences}
                  enabledLabel={copy.extensions.enabled}
                  labelMode={copy.extensions.mode}
                  mode={command.mode}
                  modelOptions={modelOptions}
                  onChange={(preferenceName, nextValue) => {
                    void updateCommandPreference(
                      selectedSchema.extName,
                      command.name,
                      preferenceName,
                      nextValue
                    )
                  }}
                  preferences={command.preferences}
                  title={command.title}
                  useEnvironmentFallbackLabel={copy.general.useEnvironmentFallback}
                  values={commandRecords[`${selectedSchema.extName}:${command.name}`] ?? {}}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded-[var(--ow-radius-panel)] border border-dashed border-border bg-background-elevated/60 [font-size:var(--ow-font-label)] text-muted-foreground">
            {copy.extensions.empty}
          </div>
        )}
      </section>
    </div>
  )
}
