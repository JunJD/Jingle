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
    "h-8 w-full rounded-[var(--ow-radius-md)] border border-border bg-background-elevated px-3 text-[var(--ow-font-control)] text-foreground outline-none transition focus:border-[var(--ring)]"

  return (
    <div className="block space-y-1.5">
      <div className="flex items-center gap-2 text-[var(--ow-font-meta)] font-medium text-foreground">
        <span>{preference.title || preference.label || preference.name}</span>
        {preference.required ? <span className="text-[11px] text-muted-foreground">*</span> : null}
      </div>
      {preference.description ? (
        <div className="text-[var(--ow-font-meta)] leading-4 text-muted-foreground">
          {preference.description}
        </div>
      ) : null}
      {preference.type === "checkbox" ? (
        <label className="flex h-8 items-center justify-between gap-3 rounded-[var(--ow-radius-md)] border border-border bg-background-elevated px-3 text-[var(--ow-font-control)] text-foreground">
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
    <div className="space-y-3">
      {title ? <div className="text-[13px] font-semibold text-foreground">{title}</div> : null}
      {preferences.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-background px-3 py-3 text-[12px] text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <div className="space-y-4">
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
      className={`rounded-[var(--ow-radius-panel)] border bg-background-elevated/65 p-4 ${
        isFocused ? "border-[var(--ring)]" : "border-border/80"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <TerminalSquare className="h-4 w-4 text-muted-foreground" />
            <span className="text-[13px] font-semibold text-foreground">{title}</span>
          </div>
          <div className="text-[12px] text-muted-foreground">{description}</div>
        </div>
        <div className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
          {labelMode}: {formatCommandMode(mode)}
        </div>
      </div>
      <div className="mt-4">
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
    <div className="grid h-full min-h-0 grid-cols-[300px_minmax(0,1fr)] gap-4">
      <aside className="flex min-h-0 flex-col gap-3 overflow-hidden rounded-[var(--ow-radius-panel)] border border-border/80 bg-background-secondary/55 p-3.5 shadow-[0_12px_32px_rgba(32,38,45,0.05)]">
        <div className="space-y-1">
          <div className="text-[16px] font-semibold text-foreground">{copy.extensions.title}</div>
          <div className="text-[13px] text-muted-foreground">
            {copy.extensions.rootsDescription}
          </div>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full rounded-[var(--ow-radius-md)] border border-border bg-background-elevated py-1.5 pl-9 pr-3 text-[13px] text-foreground outline-none transition focus:border-[var(--ring)]"
            placeholder={copy.extensions.installedTitle}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {filteredSchemas.length === 0 ? (
            <div className="rounded-[var(--ow-radius-lg)] border border-dashed border-border bg-background px-3 py-3 text-[12px] text-muted-foreground">
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
                  className={`w-full rounded-[var(--ow-radius-lg)] border px-3 py-2.5 text-left transition ${
                    isSelected
                      ? "border-[var(--ring)] bg-background"
                      : "border-border/70 bg-background-elevated/60 hover:bg-background"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <Puzzle className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate text-[13px] font-semibold text-foreground">
                          {schema.title}
                        </span>
                      </div>
                      <div className="line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                        {schema.description || schema.extName}
                      </div>
                    </div>
                    <div className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                      {schema.commands.length}
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </aside>

      <section className="min-h-0 overflow-y-auto pr-1">
        {selectedSchema ? (
          <div className="space-y-4">
            <div className="rounded-[var(--ow-radius-panel)] border border-border/80 bg-background-secondary/55 p-4 shadow-[0_12px_32px_rgba(32,38,45,0.05)]">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Settings2 className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-[16px] font-semibold text-foreground">
                    {selectedSchema.title}
                  </h2>
                </div>
                <div className="text-[13px] leading-6 text-muted-foreground">
                  {selectedSchema.description || selectedSchema.extName}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {selectedSchema.preferences.length > 0 ? (
                <div className="rounded-[var(--ow-radius-panel)] border border-border/80 bg-background-secondary/55 p-4 shadow-[0_12px_32px_rgba(32,38,45,0.05)]">
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
          <div className="flex h-full items-center justify-center rounded-[var(--ow-radius-panel)] border border-dashed border-border bg-background-elevated/60 text-[13px] text-muted-foreground">
            {copy.extensions.empty}
          </div>
        )}
      </section>
    </div>
  )
}
