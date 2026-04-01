import { useEffect, useMemo, useState } from "react"
import {
  ChevronRight,
  Folder,
  FolderPlus,
  Puzzle,
  Search,
  Settings2,
  TerminalSquare
} from "lucide-react"
import type {
  ExternalExtensionCommandSettingsSchema,
  ExternalExtensionPreferenceSchema,
  InstalledExternalExtensionSettingsSchema
} from "../../../shared/external-extensions"
import type { AppLocale } from "../../../shared/i18n"
import type { SettingsWindowTarget } from "../../../shared/settings-window"
import {
  getExternalExtensionCommandPrefsKey,
  getExternalExtensionPrefsKey,
  readExternalExtensionPreferenceRecord,
  writeExternalExtensionPreferenceRecord
} from "../lib/external-extension-preferences"
import { getSettingsCopy } from "./copy"

function getDefaultPreferenceValue(pref: ExternalExtensionPreferenceSchema): unknown {
  if (pref.default !== undefined) {
    return pref.default
  }

  if (pref.type === "checkbox") {
    return false
  }

  if (pref.type === "dropdown") {
    return pref.data?.[0]?.value ?? ""
  }

  return ""
}

function PreferenceField(props: {
  extensionName: string
  preference: ExternalExtensionPreferenceSchema
  recordKey: string
}): React.JSX.Element {
  const { extensionName, preference, recordKey } = props
  const [record, setRecord] = useState<Record<string, unknown>>(() =>
    readExternalExtensionPreferenceRecord(recordKey)
  )
  const value = record[preference.name] ?? getDefaultPreferenceValue(preference)

  useEffect(() => {
    setRecord(readExternalExtensionPreferenceRecord(recordKey))
  }, [recordKey])

  const updateValue = (nextValue: unknown): void => {
    const nextRecord = { ...record, [preference.name]: nextValue }
    setRecord(nextRecord)
    writeExternalExtensionPreferenceRecord(recordKey, nextRecord)
  }

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
              updateValue(event.target.checked)
            }}
          />
          <span>{preference.title || preference.name}</span>
        </label>
      ) : preference.type === "dropdown" ? (
        <select
          className={inputClassName}
          value={String(value ?? "")}
          onChange={(event) => {
            updateValue(event.target.value)
          }}
        >
          {(preference.data ?? []).map((entry) => (
            <option key={entry.value ?? entry.title ?? ""} value={entry.value ?? ""}>
              {entry.title ?? entry.value ?? ""}
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
            updateValue(event.target.value)
          }}
          spellCheck={false}
          data-extension-name={extensionName}
        />
      )}
    </label>
  )
}

function PreferenceSection(props: {
  emptyLabel: string
  extensionName: string
  preferences: ExternalExtensionPreferenceSchema[]
  recordKey: string
  title: string
}): React.JSX.Element | null {
  const { emptyLabel, extensionName, preferences, recordKey, title } = props
  if (preferences.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-background-elevated/60 px-4 py-4 text-[12px] text-muted-foreground">
        {emptyLabel}
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/80 bg-background-elevated/70 p-4">
      <div className="text-[13px] font-semibold text-foreground">{title}</div>
      <div className="space-y-4">
        {preferences.map((preference) => (
          <PreferenceField
            key={`${recordKey}:${preference.name}`}
            extensionName={extensionName}
            preference={preference}
            recordKey={recordKey}
          />
        ))}
      </div>
    </div>
  )
}

function CommandCard(props: {
  command: ExternalExtensionCommandSettingsSchema
  emptyLabel: string
  extensionName: string
  labelMode: string
  sectionTitle: string
}): React.JSX.Element {
  const { command, emptyLabel, extensionName, labelMode, sectionTitle } = props
  const recordKey = getExternalExtensionCommandPrefsKey(extensionName, command.name)

  return (
    <div className="rounded-xl border border-border/80 bg-background-elevated/65 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <TerminalSquare className="h-4 w-4 text-muted-foreground" />
            <span className="text-[13px] font-semibold text-foreground">{command.title}</span>
          </div>
          <div className="text-[12px] text-muted-foreground">
            {command.description || command.name}
          </div>
        </div>
        <div className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
          {labelMode}: {command.mode}
        </div>
      </div>
      <div className="mt-4">
        <PreferenceSection
          emptyLabel={emptyLabel}
          extensionName={extensionName}
          preferences={command.preferences}
          recordKey={recordKey}
          title={sectionTitle}
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
  const copy = getSettingsCopy(locale)
  const [configuredRoots, setConfiguredRoots] = useState<string[]>([])
  const [customRoots, setCustomRoots] = useState<string[]>([])
  const [schemas, setSchemas] = useState<InstalledExternalExtensionSettingsSchema[]>([])
  const [selectedExtName, setSelectedExtName] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  useEffect(() => {
    const load = async (): Promise<void> => {
      const [nextConfiguredRoots, nextCustomRoots, nextSchemas] = await Promise.all([
        window.api.extensions.listRoots(),
        window.api.extensions.getCustomRoots(),
        window.api.extensions.listSettingsSchemas()
      ])
      const sortedSchemas = [...nextSchemas].sort((left, right) =>
        left.title.localeCompare(right.title)
      )
      setConfiguredRoots(nextConfiguredRoots)
      setCustomRoots(nextCustomRoots)
      setSchemas(sortedSchemas)
      setSelectedExtName((current) => {
        if (focusTarget?.extensionName) {
          return focusTarget.extensionName
        }

        if (current && sortedSchemas.some((schema) => schema.extName === current)) {
          return current
        }

        return sortedSchemas[0]?.extName ?? null
      })
    }

    void load()
    return window.api.extensions.onChanged(() => {
      void load()
    })
  }, [focusTarget?.extensionName])

  useEffect(() => {
    if (focusTarget?.extensionName) {
      setSelectedExtName(focusTarget.extensionName)
    }
  }, [focusTarget?.commandName, focusTarget?.extensionName])

  const filteredSchemas = useMemo(() => {
    const normalizedQuery = search.trim().toLowerCase()
    if (!normalizedQuery) {
      return schemas
    }

    return schemas.filter((schema) => {
      return (
        schema.title.toLowerCase().includes(normalizedQuery) ||
        schema.extName.toLowerCase().includes(normalizedQuery) ||
        schema.owner.toLowerCase().includes(normalizedQuery)
      )
    })
  }, [schemas, search])

  const selectedSchema =
    filteredSchemas.find((schema) => schema.extName === selectedExtName) ??
    schemas.find((schema) => schema.extName === selectedExtName) ??
    filteredSchemas[0] ??
    null

  const addRoot = async (): Promise<void> => {
    const pickedRoot = await window.api.extensions.pickRoot()
    if (!pickedRoot) {
      return
    }

    const nextRoots = Array.from(new Set([...customRoots, pickedRoot]))
    const updated = await window.api.extensions.setCustomRoots(nextRoots)
    setCustomRoots(updated)
    setConfiguredRoots(await window.api.extensions.listRoots())
  }

  const removeRoot = async (root: string): Promise<void> => {
    const updated = await window.api.extensions.setCustomRoots(
      customRoots.filter((entry) => entry !== root)
    )
    setCustomRoots(updated)
    setConfiguredRoots(await window.api.extensions.listRoots())
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

        <div className="space-y-3 rounded-xl border border-border/80 bg-background-elevated/70 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[13px] font-semibold text-foreground">
              {copy.extensions.rootsTitle}
            </div>
            <button
              type="button"
              onClick={() => void addRoot()}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-[12px] font-medium text-foreground transition hover:bg-background-secondary"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              {copy.common.addRoot}
            </button>
          </div>
          <div className="space-y-2">
            {configuredRoots.length > 0 ? (
              configuredRoots.map((root) => {
                const isCustomRoot = customRoots.includes(root)
                return (
                  <div
                    key={root}
                    className="rounded-lg border border-border/70 bg-background px-3 py-2 text-[12px] text-foreground"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="truncate">{root}</div>
                      <span className="shrink-0 rounded-full border border-border bg-background-elevated px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                        {isCustomRoot ? "custom" : "default"}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        className="text-muted-foreground transition hover:text-foreground"
                        onClick={() => {
                          void window.api.extensions.revealPath(root)
                        }}
                      >
                        {copy.common.reveal}
                      </button>
                      {isCustomRoot ? (
                        <button
                          type="button"
                          className="text-muted-foreground transition hover:text-foreground"
                          onClick={() => void removeRoot(root)}
                        >
                          {copy.common.remove}
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-background px-3 py-3 text-[12px] text-muted-foreground">
                {copy.common.none}
              </div>
            )}
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
          {filteredSchemas.length > 0 ? (
            filteredSchemas.map((schema) => {
              const active = schema.extName === selectedSchema?.extName
              return (
                <button
                  key={schema.extName}
                  type="button"
                  onClick={() => {
                    setSelectedExtName(schema.extName)
                  }}
                  className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition ${
                    active
                      ? "border-[var(--ring)] bg-background text-foreground"
                      : "border-border/70 bg-background-elevated/70 text-foreground hover:bg-background"
                  }`}
                >
                  {schema.iconDataUrl ? (
                    <img src={schema.iconDataUrl} alt="" className="h-9 w-9 rounded-lg" />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background">
                      <Puzzle className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{schema.title}</div>
                    <div className="mt-1 truncate text-[12px] text-muted-foreground">
                      {schema.owner || schema.extName}
                    </div>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 text-muted-foreground" />
                </button>
              )
            })
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-background px-4 py-4 text-[12px] text-muted-foreground">
              {copy.extensions.empty}
            </div>
          )}
        </div>
      </aside>

      <section className="min-h-0 overflow-y-auto rounded-2xl border border-border/80 bg-background-secondary/55 p-5 shadow-[0_18px_44px_rgba(32,38,45,0.06)]">
        {selectedSchema ? (
          <div className="space-y-5">
            <div className="flex items-start gap-4">
              {selectedSchema.iconDataUrl ? (
                <img src={selectedSchema.iconDataUrl} alt="" className="h-14 w-14 rounded-2xl" />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-background">
                  <Puzzle className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-2">
                <div className="text-[20px] font-semibold text-foreground">
                  {selectedSchema.title}
                </div>
                <div className="text-[13px] leading-6 text-muted-foreground">
                  {selectedSchema.description || selectedSchema.extName}
                </div>
                <div className="flex flex-wrap gap-2 text-[12px] text-muted-foreground">
                  <span className="rounded-full border border-border bg-background px-2.5 py-1">
                    {copy.extensions.owner}: {selectedSchema.owner || copy.common.none}
                  </span>
                  <span className="rounded-full border border-border bg-background px-2.5 py-1">
                    {copy.extensions.sourceRoot}: {selectedSchema.sourceRoot}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-[12px] font-medium text-foreground transition hover:bg-background-secondary"
                    onClick={() => {
                      void window.api.extensions.revealPath(selectedSchema.extensionPath)
                    }}
                  >
                    <Folder className="h-3.5 w-3.5" />
                    {copy.common.reveal}
                  </button>
                </div>
              </div>
            </div>

            <PreferenceSection
              emptyLabel={copy.extensions.noPreferences}
              extensionName={selectedSchema.extName}
              preferences={selectedSchema.preferences}
              recordKey={getExternalExtensionPrefsKey(selectedSchema.extName)}
              title={copy.extensions.extensionPreferences}
            />

            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                <span>{copy.extensions.commandPreferences}</span>
              </div>
              {selectedSchema.commands.length > 0 ? (
                selectedSchema.commands.map((command) => (
                  <CommandCard
                    key={`${selectedSchema.extName}:${command.name}`}
                    command={command}
                    emptyLabel={copy.extensions.noPreferences}
                    extensionName={selectedSchema.extName}
                    labelMode={copy.extensions.mode}
                    sectionTitle={copy.extensions.commandPreferences}
                  />
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-background px-4 py-4 text-[12px] text-muted-foreground">
                  {copy.extensions.noPreferences}
                </div>
              )}
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
