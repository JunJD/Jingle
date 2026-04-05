import { useEffect, useMemo, useState } from "react"
import { Command, Keyboard } from "lucide-react"
import { getPrimaryDefaultShortcutBinding } from "../../../shared/shortcuts/defaults"
import { LAUNCHER_COMMAND_IDS } from "../../../shared/shortcuts/ids"
import {
  areShortcutChordsEqual,
  normalizeShortcutChord,
  resolveShortcutPlatform,
  type ShortcutChord,
  type ShortcutModifier
} from "../../../shared/shortcuts/model"
import type {
  GlobalShortcutAvailability,
  ShortcutOverride
} from "../../../shared/shortcuts/settings"
import type { AppLocale } from "../../../shared/i18n"
import { formatShortcutBinding } from "../shortcuts/format-shortcut"
import { getLauncherShortcutCommand } from "../shortcuts/command-registry"
import { useShortcutBindings, useShortcutSystem } from "../shortcuts/shortcut-context"
import { getSettingsCopy } from "./copy"

const secondaryButtonClassName =
  "inline-flex items-center gap-2 rounded-md border border-border bg-background-elevated px-3 py-2 text-[12px] font-medium text-foreground transition hover:bg-background-secondary disabled:cursor-default disabled:opacity-50"

const statusClassName = {
  available: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  unavailable: "border-destructive/30 bg-destructive/10 text-destructive",
  unknown: "border-border/70 bg-background-elevated text-muted-foreground"
} as const

function toShortcutChordFromKeyboardEvent(
  event: React.KeyboardEvent<HTMLButtonElement>
): ShortcutChord | null {
  if (
    event.key === "Meta" ||
    event.key === "Shift" ||
    event.key === "Control" ||
    event.key === "Alt"
  ) {
    return null
  }

  const modifiers: ShortcutModifier[] = []
  if (event.metaKey) {
    modifiers.push("meta")
  }
  if (event.ctrlKey) {
    modifiers.push("ctrl")
  }
  if (event.altKey) {
    modifiers.push("alt")
  }
  if (event.shiftKey) {
    modifiers.push("shift")
  }

  const key = event.key === " " ? "Space" : event.key
  const chord: ShortcutChord = {
    modifiers,
    key: key.length === 1 ? key.toUpperCase() : key
  }

  if (event.code && event.code !== event.key && event.code !== "Unidentified") {
    chord.code = event.code
  }

  return normalizeShortcutChord(chord)
}

function upsertShortcutOverride(
  overrides: readonly ShortcutOverride[],
  nextOverride: ShortcutOverride,
  platform: ShortcutOverride["platform"]
): ShortcutOverride[] {
  const nextOverrides = overrides.filter(
    (override) =>
      !(
        override.commandId === nextOverride.commandId &&
        ((override.platform ?? null) === (platform ?? null) || override.platform === undefined)
      )
  )

  nextOverrides.push(nextOverride)
  return nextOverrides
}

function removeShortcutOverride(
  overrides: readonly ShortcutOverride[],
  commandId: string,
  platform: ShortcutOverride["platform"]
): ShortcutOverride[] {
  return overrides.filter(
    (override) =>
      !(
        override.commandId === commandId &&
        ((override.platform ?? null) === (platform ?? null) || override.platform === undefined)
      )
  )
}

export function ShortcutsTab(props: { locale: AppLocale }): React.JSX.Element {
  const { locale } = props
  const copy = getSettingsCopy(locale)
  const bindings = useShortcutBindings()
  const { settings } = useShortcutSystem()
  const platform = resolveShortcutPlatform(window.electron.process.platform)
  const command = getLauncherShortcutCommand(LAUNCHER_COMMAND_IDS.toggle)
  const defaultBinding = getPrimaryDefaultShortcutBinding(command.id, platform)
  const currentBinding = useMemo(
    () =>
      bindings.find((binding) => binding.commandId === command.id && binding.scope === "global") ??
      null,
    [bindings, command.id]
  )
  const currentOverride = useMemo(
    () =>
      settings.overrides.find(
        (override) =>
          override.commandId === command.id &&
          ((override.platform ?? null) === platform || override.platform === undefined)
      ) ?? null,
    [command.id, platform, settings.overrides]
  )
  const [availability, setAvailability] = useState<GlobalShortcutAvailability | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [draftChord, setDraftChord] = useState<ShortcutChord | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState("")

  useEffect(() => {
    void window.api.shortcuts.getGlobalAvailability().then((records) => {
      setAvailability(records.find((record) => record.commandId === command.id) ?? null)
    })
  }, [command.id, settings])

  const displayedBinding = currentBinding ?? defaultBinding
  const displayedBindingText = displayedBinding
    ? formatShortcutBinding(displayedBinding, platform)
    : copy.shortcuts.notSet
  const defaultBindingText = defaultBinding
    ? formatShortcutBinding(defaultBinding, platform)
    : copy.shortcuts.notSet
  const draftBindingText = draftChord
    ? formatShortcutBinding({ chord: draftChord, commandId: command.id, scope: "global" }, platform)
    : null

  const saveOverride = async (): Promise<void> => {
    if (!draftChord) {
      return
    }

    setIsSaving(true)
    try {
      const nextOverrides =
        defaultBinding && areShortcutChordsEqual(defaultBinding.chord, draftChord)
          ? removeShortcutOverride(settings.overrides, command.id, platform)
          : upsertShortcutOverride(
              settings.overrides,
              {
                chord: draftChord,
                commandId: command.id,
                platform
              },
              platform
            )

      await window.api.shortcuts.setSettings({ overrides: nextOverrides })
      setStatus(copy.shortcuts.saved)
      setIsRecording(false)
      setDraftChord(null)
    } finally {
      setIsSaving(false)
    }
  }

  const resetOverride = async (): Promise<void> => {
    setIsSaving(true)
    try {
      await window.api.shortcuts.setSettings({
        overrides: removeShortcutOverride(settings.overrides, command.id, platform)
      })
      setStatus(copy.shortcuts.reset)
      setIsRecording(false)
      setDraftChord(null)
    } finally {
      setIsSaving(false)
    }
  }

  useEffect(() => {
    if (!status) {
      return
    }

    const timeoutId = window.setTimeout(() => setStatus(""), 1800)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [status])

  if (!defaultBinding) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
        {copy.shortcuts.unavailable}
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-4">
      <div className="px-1">
        <div className="text-[18px] font-semibold text-foreground">{copy.shortcuts.title}</div>
        <div className="mt-1 text-[13px] text-muted-foreground">{copy.shortcuts.description}</div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/80 bg-background-secondary/55 shadow-[0_18px_44px_rgba(32,38,45,0.06)]">
        <div className="grid gap-3 border-b border-border/70 px-4 py-4 md:grid-cols-[240px_minmax(0,1fr)]">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 text-muted-foreground">
              <Command className="h-4 w-4" />
            </div>
            <div className="space-y-1">
              <div className="text-[13px] font-semibold text-foreground">{command.title}</div>
              <div className="text-[12px] leading-5 text-muted-foreground">
                {command.description}
              </div>
            </div>
          </div>

          <div
            className="space-y-4"
            data-command-id={command.id}
            data-shortcut-configurable={command.configurable ? "true" : "false"}
          >
            <div className="flex flex-wrap items-center gap-3">
              <div
                data-shortcut-current-binding={command.id}
                className="rounded-md border border-border/70 bg-background-elevated px-3 py-2 text-[13px] font-medium text-foreground"
              >
                {displayedBindingText}
              </div>
              <span
                data-shortcut-binding-source={command.id}
                data-shortcut-binding-source-value={currentOverride?.chord ? "custom" : "default"}
                className="text-[12px] text-muted-foreground"
              >
                {currentOverride?.chord
                  ? copy.shortcuts.customBinding
                  : copy.shortcuts.defaultBinding}
              </span>
              {status ? <span className="text-[12px] text-muted-foreground">{status}</span> : null}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                data-shortcut-edit={command.id}
                className={secondaryButtonClassName}
                onClick={() => {
                  setStatus("")
                  setDraftChord(null)
                  setIsRecording(true)
                }}
                disabled={isSaving}
              >
                <Keyboard className="h-3.5 w-3.5" />
                {copy.shortcuts.edit}
              </button>

              <button
                type="button"
                data-shortcut-use-default={command.id}
                className={secondaryButtonClassName}
                onClick={() => void resetOverride()}
                disabled={isSaving || !currentOverride}
              >
                {copy.shortcuts.useDefault}
              </button>
            </div>

            {isRecording ? (
              <div className="rounded-xl border border-border/70 bg-background px-4 py-4">
                <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {copy.shortcuts.recordingTitle}
                </div>
                <div className="mt-2 text-[13px] text-muted-foreground">
                  {copy.shortcuts.recordingDescription}
                </div>
                <button
                  type="button"
                  data-shortcut-recorder={command.id}
                  className="mt-4 min-w-[220px] rounded-md border border-[var(--ring)] bg-background-elevated px-3 py-2 text-left text-[13px] font-medium text-foreground outline-none"
                  onKeyDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    const nextChord = toShortcutChordFromKeyboardEvent(event)
                    if (nextChord) {
                      setDraftChord(nextChord)
                    }
                  }}
                  onClick={(event) => {
                    event.preventDefault()
                  }}
                  autoFocus
                >
                  {draftBindingText ?? copy.shortcuts.recordingPlaceholder}
                </button>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    data-shortcut-save={command.id}
                    className={secondaryButtonClassName}
                    onClick={() => void saveOverride()}
                    disabled={isSaving || !draftChord}
                  >
                    {copy.common.save}
                  </button>
                  <button
                    type="button"
                    className={secondaryButtonClassName}
                    onClick={() => {
                      setIsRecording(false)
                      setDraftChord(null)
                    }}
                    disabled={isSaving}
                  >
                    {copy.shortcuts.cancel}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-background px-4 py-3">
                <div className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
                  {copy.shortcuts.defaultBindingLabel}
                </div>
                <div className="mt-2 text-[13px] font-medium text-foreground">
                  {defaultBindingText}
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-background px-4 py-3">
                <div className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
                  {copy.shortcuts.registrationStatus}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span
                    data-shortcut-registration-state={command.id}
                    data-shortcut-registration-state-value={availability?.state ?? "unknown"}
                    className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${
                      statusClassName[availability?.state ?? "unknown"]
                    }`}
                  >
                    {availability?.state === "available"
                      ? copy.shortcuts.available
                      : availability?.state === "unavailable"
                        ? copy.shortcuts.unavailable
                        : copy.shortcuts.unknown}
                  </span>
                  {availability?.accelerator ? (
                    <span
                      data-shortcut-registration-accelerator={command.id}
                      className="text-[12px] text-muted-foreground"
                    >
                      {availability.accelerator}
                    </span>
                  ) : null}
                </div>
                {availability?.reason ? (
                  <div className="mt-2 text-[12px] leading-5 text-muted-foreground">
                    {availability.reason}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
