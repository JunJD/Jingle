import { useEffect, useMemo, useState } from "react"
import { Command, Keyboard } from "lucide-react"
import { getPrimaryDefaultShortcutBinding } from "@shared/shortcuts/defaults"
import { listConfigurableShortcutCommandIds } from "@shared/shortcuts/configurable"
import {
  areShortcutChordsEqual,
  normalizeShortcutChord,
  resolveShortcutPlatform,
  type ShortcutChord,
  type ShortcutModifier
} from "@shared/shortcuts/model"
import type { GlobalShortcutAvailability, ShortcutOverride } from "@shared/shortcuts/settings"
import type { AppLocale } from "@shared/i18n"
import { formatShortcutBinding } from "../shortcuts/format-shortcut"
import { getLauncherShortcutCommand } from "../shortcuts/command-registry"
import { useShortcutBinding, useShortcutSettings } from "../shortcuts/shortcut-context"
import { getSettingsCopy } from "./copy"

const secondaryButtonClassName =
  "inline-flex items-center gap-[var(--ow-space-1-5)] rounded-[var(--ow-radius-md)] border border-border bg-background-elevated px-[var(--ow-space-3)] py-[var(--ow-space-1-5)] [font-size:var(--ow-font-body)] font-medium text-foreground transition hover:bg-background-secondary disabled:cursor-default disabled:opacity-50"

const statusClassName = {
  available: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  unavailable: "border-destructive/30 bg-destructive/10 text-destructive",
  unknown: "border-border/70 bg-background-elevated text-muted-foreground"
} as const

type SettingsCopy = ReturnType<typeof getSettingsCopy>

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

function ShortcutCommandCard(props: {
  commandId: string
  copy: SettingsCopy
  platform: ReturnType<typeof resolveShortcutPlatform>
  settings: ReturnType<typeof useShortcutSettings>
}): React.JSX.Element | null {
  const { commandId, copy, platform, settings } = props
  const command = getLauncherShortcutCommand(commandId)
  const defaultBinding = getPrimaryDefaultShortcutBinding(command.id, platform)
  const currentBinding = useShortcutBinding(command.id, defaultBinding?.scope)
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
    if (defaultBinding?.scope !== "global") {
      setAvailability(null)
      return
    }

    void window.api.shortcuts.getGlobalAvailability().then((records) => {
      setAvailability(records.find((record) => record.commandId === command.id) ?? null)
    })
  }, [command.id, defaultBinding?.scope, settings])

  const displayedBinding = currentBinding ?? defaultBinding
  const displayedBindingText = displayedBinding
    ? formatShortcutBinding(displayedBinding, platform)
    : copy.shortcuts.notSet
  const defaultBindingText = defaultBinding
    ? formatShortcutBinding(defaultBinding, platform)
    : copy.shortcuts.notSet
  const draftBindingText = draftChord
    ? formatShortcutBinding(
        { chord: draftChord, commandId: command.id, scope: defaultBinding?.scope ?? "launcher" },
        platform
      )
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
    return null
  }

  return (
    <div className="overflow-hidden rounded-[var(--ow-radius-panel)] border border-border/80 bg-background-secondary/55 shadow-[0_12px_32px_rgba(32,38,45,0.05)]">
      <div className="grid gap-[var(--ow-gap-md)] border-b border-border/70 px-[var(--ow-space-4)] py-[var(--ow-space-3)] md:grid-cols-[var(--ow-settings-label-column-w)_minmax(0,1fr)]">
        <div className="flex items-start gap-[var(--ow-gap-md)]">
          <div className="mt-0.5 text-muted-foreground">
            <Command className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />
          </div>
          <div className="space-y-[var(--ow-space-1)]">
            <div className="[font-size:var(--ow-font-label)] font-semibold text-foreground">
              {command.title}
            </div>
            <div className="[font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-muted-foreground">
              {command.description}
            </div>
          </div>
        </div>

        <div
          className="space-y-[var(--ow-space-4)]"
          data-command-id={command.id}
          data-shortcut-configurable={command.configurable ? "true" : "false"}
        >
          <div className="flex flex-wrap items-center gap-[var(--ow-gap-md)]">
            <div
              data-shortcut-current-binding={command.id}
              className="rounded-[var(--ow-radius-md)] border border-border/70 bg-background-elevated px-[var(--ow-space-3)] py-[var(--ow-space-1-5)] [font-size:var(--ow-font-label)] font-medium text-foreground"
            >
              {displayedBindingText}
            </div>
            <span
              data-shortcut-binding-source={command.id}
              data-shortcut-binding-source-value={currentOverride?.chord ? "custom" : "default"}
              className="[font-size:var(--ow-font-body)] text-muted-foreground"
            >
              {currentOverride?.chord
                ? copy.shortcuts.customBinding
                : copy.shortcuts.defaultBinding}
            </span>
            {status ? (
              <span className="[font-size:var(--ow-font-body)] text-muted-foreground">
                {status}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-[var(--ow-gap-md)]">
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
              <Keyboard className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
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
            <div className="rounded-xl border border-border/70 bg-background px-[var(--ow-space-4)] py-[var(--ow-space-4)]">
              <div className="[font-size:var(--ow-font-body)] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {copy.shortcuts.recordingTitle}
              </div>
              <div className="mt-[var(--ow-space-2)] [font-size:var(--ow-font-label)] text-muted-foreground">
                {copy.shortcuts.recordingDescription}
              </div>
              <button
                type="button"
                data-shortcut-recorder={command.id}
                className="mt-[var(--ow-space-4)] min-w-[var(--ow-settings-select-w)] rounded-md border border-[var(--ring)] bg-background-elevated px-[var(--ow-space-3)] py-[var(--ow-space-2)] text-left [font-size:var(--ow-font-label)] font-medium text-foreground outline-none"
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

              <div className="mt-[var(--ow-space-4)] flex flex-wrap items-center gap-[var(--ow-gap-md)]">
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

          <div className="grid gap-[var(--ow-gap-md)] md:grid-cols-2">
            <div className="rounded-xl border border-border/70 bg-background px-[var(--ow-space-4)] py-[var(--ow-space-3)]">
              <div className="[font-size:var(--ow-font-body)] uppercase tracking-[0.08em] text-muted-foreground">
                {copy.shortcuts.defaultBindingLabel}
              </div>
              <div className="mt-[var(--ow-space-2)] [font-size:var(--ow-font-label)] font-medium text-foreground">
                {defaultBindingText}
              </div>
            </div>

            {defaultBinding.scope === "global" ? (
              <div className="rounded-xl border border-border/70 bg-background px-[var(--ow-space-4)] py-[var(--ow-space-3)]">
                <div className="[font-size:var(--ow-font-body)] uppercase tracking-[0.08em] text-muted-foreground">
                  {copy.shortcuts.registrationStatus}
                </div>
                <div className="mt-[var(--ow-space-2)] flex flex-wrap items-center gap-[var(--ow-gap-md)]">
                  <span
                    data-shortcut-registration-state={command.id}
                    data-shortcut-registration-state-value={availability?.state ?? "unknown"}
                    className={`inline-flex rounded-full border px-[var(--ow-space-2)] py-[var(--ow-space-1)] [font-size:var(--ow-font-meta)] font-medium ${
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
                      className="[font-size:var(--ow-font-body)] text-muted-foreground"
                    >
                      {availability.accelerator}
                    </span>
                  ) : null}
                </div>
                {availability?.reason ? (
                  <div className="mt-[var(--ow-space-2)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-muted-foreground">
                    {availability.reason}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export function ShortcutsTab(props: { locale: AppLocale }): React.JSX.Element {
  const { locale } = props
  const copy = getSettingsCopy(locale)
  const settings = useShortcutSettings()
  const platform = resolveShortcutPlatform(window.electron.process.platform)
  const commandIds = listConfigurableShortcutCommandIds()

  if (commandIds.length === 0) {
    return (
      <div className="flex h-full items-center justify-center [font-size:var(--ow-font-label)] text-muted-foreground">
        {copy.shortcuts.unavailable}
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[var(--ow-settings-content-max-width)] flex-col gap-[var(--ow-gap-lg)]">
      <div className="px-1">
        <div className="[font-size:var(--ow-font-display)] font-semibold text-foreground">
          {copy.shortcuts.title}
        </div>
        <div className="mt-[var(--ow-space-1)] [font-size:var(--ow-font-label)] text-muted-foreground">
          {copy.shortcuts.description}
        </div>
      </div>

      {commandIds.map((commandId) => (
        <ShortcutCommandCard
          commandId={commandId}
          copy={copy}
          key={commandId}
          platform={platform}
          settings={settings}
        />
      ))}
    </div>
  )
}
