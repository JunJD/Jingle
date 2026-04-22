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

function PreferenceField(props: {
  modelOptions: Array<{ id: string; label: string }>
  onChange: (nextValue: unknown) => void
  preference: NativeExtensionPreferenceSchema
  useEnvironmentFallbackLabel: string
  value: unknown
}): React.JSX.Element {
  const { modelOptions, onChange, preference, useEnvironmentFallbackLabel, value } = props
  const inputClassName =
    "w-full rounded-md border border-border bg-background-elevated px-3 py-2 text-[13px] text-foreground outline-none transition focus:border-[var(--ring)]"

  return (
    <label className="block space-y-2">
      <div className="flex items-center gap-2 text-[12px] font-medium text-foreground">
        <span>{preference.title || preference.label || preference.name}</span>
        {preference.required ? <span className="text-[11px] text-muted-foreground">*</span> : null}
      </div>
      {preference.description ? (
        <div className="text-[12px] leading-5 text-muted-foreground">{preference.description}</div>
      ) : null}
      {preference.type === "checkbox" ? (
        <label className="inline-flex items-center gap-2 text-[13px] text-foreground">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(event) => {
              onChange(event.target.checked)
            }}
          />
          <span>{preference.title || preference.name}</span>
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
    </label>
  )
}

function PreferenceSection(props: {
  emptyLabel: string
  modelOptions: Array<{ id: string; label: string }>
  onChange: (preferenceName: string, nextValue: unknown) => void
  preferences: NativeExtensionPreferenceSchema[]
  title: string
  useEnvironmentFallbackLabel: string
  values: Record<string, unknown>
}): React.JSX.Element {
  const {
    emptyLabel,
    modelOptions,
    onChange,
    preferences,
    title,
    useEnvironmentFallbackLabel,
    values
  } = props

  return (
    <div className="space-y-3 rounded-xl border border-border/80 bg-background-elevated/70 p-4">
      <div className="text-[13px] font-semibold text-foreground">{title}</div>
      {preferences.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-background px-3 py-3 text-[12px] text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <div className="space-y-4">
          {preferences.map((preference) => (
            <PreferenceField
              key={`${title}:${preference.name}`}
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
  emptyLabel: string
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
    emptyLabel,
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
      className={`rounded-xl border bg-background-elevated/65 p-4 ${
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
          {labelMode}: {mode}
        </div>
      </div>
      <div className="mt-4">
        <PreferenceSection
          emptyLabel={emptyLabel}
          modelOptions={modelOptions}
          onChange={onChange}
          preferences={preferences}
          title={title}
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
    <div className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)] gap-5">
      <aside className="flex min-h-0 flex-col gap-4 overflow-hidden rounded-2xl border border-border/80 bg-background-secondary/55 p-4 shadow-[0_18px_44px_rgba(32,38,45,0.06)]">
        <div className="space-y-1">
          <div className="text-[18px] font-semibold text-foreground">{copy.extensions.title}</div>
          <div className="text-[13px] text-muted-foreground">
            {copy.extensions.rootsDescription}
          </div>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full rounded-md border border-border bg-background-elevated py-2 pl-9 pr-3 text-[13px] text-foreground outline-none transition focus:border-[var(--ring)]"
            placeholder={copy.extensions.installedTitle}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {filteredSchemas.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-background px-4 py-4 text-[12px] text-muted-foreground">
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
                  className={`w-full rounded-xl border px-4 py-3 text-left transition ${
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
            <div className="rounded-2xl border border-border/80 bg-background-secondary/55 p-5 shadow-[0_18px_44px_rgba(32,38,45,0.06)]">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Settings2 className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-[18px] font-semibold text-foreground">
                    {selectedSchema.title}
                  </h2>
                </div>
                <div className="text-[13px] leading-6 text-muted-foreground">
                  {selectedSchema.description || selectedSchema.extName}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <PreferenceSection
                emptyLabel={copy.extensions.noPreferences}
                modelOptions={modelOptions}
                onChange={(preferenceName, nextValue) => {
                  void updateExtensionPreference(selectedSchema.extName, preferenceName, nextValue)
                }}
                preferences={selectedSchema.preferences}
                title={selectedSchema.title}
                useEnvironmentFallbackLabel={copy.general.useEnvironmentFallback}
                values={extensionRecords[selectedSchema.extName] ?? {}}
              />

              {selectedSchema.commands.map((command) => (
                <CommandCard
                  commandName={command.name}
                  key={`${selectedSchema.extName}:${command.name}`}
                  commandNameFocus={focusedCommandName}
                  description={command.description || command.name}
                  emptyLabel={copy.extensions.noPreferences}
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
          <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border bg-background-elevated/60 text-[13px] text-muted-foreground">
            {copy.extensions.empty}
          </div>
        )}
      </section>
    </div>
  )
}
