import { useCallback, useEffect, useMemo, useReducer, useRef } from "react"
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
import {
  secondaryButtonClassName,
  settingsCardClassName,
  settingsPageClassName,
  settingsPageDescriptionClassName,
  settingsPageHeaderClassName,
  settingsPageTitleClassName
} from "./settings-ui"

const statusClassName = {
  available: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  unavailable: "border-destructive/30 bg-destructive/10 text-destructive",
  unknown: "border-border/70 bg-background-elevated text-muted-foreground"
} as const

type SettingsCopy = ReturnType<typeof getSettingsCopy>

interface ShortcutCommandCardState {
  availability: GlobalShortcutAvailability | null
  draftChord: ShortcutChord | null
  isRecording: boolean
  isSaving: boolean
  status: string
}

type ShortcutCommandCardAction =
  | { type: "availability-loaded"; availability: GlobalShortcutAvailability | null }
  | { type: "cancel-recording" }
  | { type: "clear-status" }
  | { type: "draft-chord-changed"; chord: ShortcutChord }
  | { type: "edit-started" }
  | { type: "save-finished" }
  | { type: "save-started" }
  | { type: "saved"; status: string }

const initialShortcutCommandCardState: ShortcutCommandCardState = {
  availability: null,
  draftChord: null,
  isRecording: false,
  isSaving: false,
  status: ""
}

function shortcutCommandCardReducer(
  state: ShortcutCommandCardState,
  action: ShortcutCommandCardAction
): ShortcutCommandCardState {
  switch (action.type) {
    case "availability-loaded":
      return { ...state, availability: action.availability }
    case "cancel-recording":
      return { ...state, draftChord: null, isRecording: false }
    case "clear-status":
      return state.status ? { ...state, status: "" } : state
    case "draft-chord-changed":
      return { ...state, draftChord: action.chord }
    case "edit-started":
      return { ...state, draftChord: null, isRecording: true, status: "" }
    case "save-finished":
      return { ...state, isSaving: false }
    case "save-started":
      return { ...state, isSaving: true }
    case "saved":
      return {
        ...state,
        draftChord: null,
        isRecording: false,
        isSaving: false,
        status: action.status
      }
  }
}

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
        matchesShortcutOverridePlatform(override, platform)
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
        matchesShortcutOverridePlatform(override, platform)
      )
  )
}

function getShortcutOverridePlatformKey(platform: ShortcutOverride["platform"]): string | null {
  if (platform === undefined) {
    return null
  }

  return platform
}

function matchesShortcutOverridePlatform(
  override: ShortcutOverride,
  platform: ShortcutOverride["platform"]
): boolean {
  const requestedPlatform = getShortcutOverridePlatformKey(platform)
  const overridePlatform = getShortcutOverridePlatformKey(override.platform)

  return overridePlatform === requestedPlatform || override.platform === undefined
}

function getShortcutRegistrationStatusViewModel(params: {
  availability: GlobalShortcutAvailability | null
  copy: SettingsCopy
}): {
  accelerator: string | null
  label: string
  reason: string | null
  state: GlobalShortcutAvailability["state"]
} {
  const availability = params.availability
  if (!availability) {
    return {
      accelerator: null,
      label: params.copy.shortcuts.unknown,
      reason: null,
      state: "unknown"
    }
  }

  if (availability.state === "available") {
    return {
      accelerator: availability.accelerator,
      label: params.copy.shortcuts.available,
      reason: normalizeShortcutRegistrationReason(availability.reason),
      state: availability.state
    }
  }

  if (availability.state === "unavailable") {
    return {
      accelerator: availability.accelerator,
      label: params.copy.shortcuts.unavailable,
      reason: normalizeShortcutRegistrationReason(availability.reason),
      state: availability.state
    }
  }

  return {
    accelerator: availability.accelerator,
    label: params.copy.shortcuts.unknown,
    reason: normalizeShortcutRegistrationReason(availability.reason),
    state: availability.state
  }
}

function normalizeShortcutRegistrationReason(reason: string | undefined): string | null {
  if (!reason) {
    return null
  }

  return reason
}

function findShortcutOverride(
  overrides: readonly ShortcutOverride[],
  commandId: string,
  platform: ShortcutOverride["platform"]
): ShortcutOverride | null {
  const override = overrides.find(
    (candidate) =>
      candidate.commandId === commandId && matchesShortcutOverridePlatform(candidate, platform)
  )
  if (!override) {
    return null
  }

  return override
}

function findShortcutAvailability(
  records: readonly GlobalShortcutAvailability[],
  commandId: string
): GlobalShortcutAvailability | null {
  const availability = records.find((record) => record.commandId === commandId)
  if (!availability) {
    return null
  }

  return availability
}

function resolveDisplayedShortcutBinding(
  currentBinding: ReturnType<typeof useShortcutBinding>,
  defaultBinding: ReturnType<typeof getPrimaryDefaultShortcutBinding>
) {
  if (currentBinding) {
    return currentBinding
  }

  return defaultBinding
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
    () => findShortcutOverride(settings.overrides, command.id, platform),
    [command.id, platform, settings.overrides]
  )
  const [state, dispatch] = useReducer(
    shortcutCommandCardReducer,
    initialShortcutCommandCardState
  )
  const recorderButtonRef = useRef<HTMLButtonElement | null>(null)
  const { availability, draftChord, isRecording, isSaving, status } = state

  const refreshAvailability = useCallback(async (): Promise<void> => {
    if (defaultBinding?.scope !== "global") {
      dispatch({ type: "availability-loaded", availability: null })
      return
    }

    const records = await window.api.shortcuts.getGlobalAvailability()
    dispatch({
      type: "availability-loaded",
      availability: findShortcutAvailability(records, command.id)
    })
  }, [command.id, defaultBinding?.scope])

  useEffect(() => {
    void refreshAvailability()
  }, [refreshAvailability, settings])

  const displayedBinding = resolveDisplayedShortcutBinding(currentBinding, defaultBinding)
  const displayedBindingText = displayedBinding
    ? formatShortcutBinding(displayedBinding, platform)
    : copy.shortcuts.notSet
  const defaultBindingText = defaultBinding
    ? formatShortcutBinding(defaultBinding, platform)
    : copy.shortcuts.notSet
  const registrationStatus = getShortcutRegistrationStatusViewModel({ availability, copy })

  const saveOverride = async (): Promise<void> => {
    if (!draftChord) {
      return
    }

    dispatch({ type: "save-started" })
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
      dispatch({ type: "saved", status: copy.shortcuts.saved })
    } finally {
      dispatch({ type: "save-finished" })
    }
  }

  const resetOverride = async (): Promise<void> => {
    dispatch({ type: "save-started" })
    try {
      await window.api.shortcuts.setSettings({
        overrides: removeShortcutOverride(settings.overrides, command.id, platform)
      })
      dispatch({ type: "saved", status: copy.shortcuts.reset })
    } finally {
      dispatch({ type: "save-finished" })
    }
  }

  useEffect(() => {
    if (!status) {
      return
    }

    const timeoutId = window.setTimeout(() => dispatch({ type: "clear-status" }), 1800)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [status])

  if (!defaultBinding) {
    return null
  }

  const draftBindingText = draftChord
    ? formatShortcutBinding(
        { chord: draftChord, commandId: command.id, scope: defaultBinding.scope },
        platform
      )
    : null

  return (
    <div className={settingsCardClassName}>
      <div className="grid gap-[var(--ow-settings-row-gap)] border-b border-border/70 px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)] md:grid-cols-[var(--ow-settings-label-column-w)_minmax(0,1fr)]">
        <div className="flex items-start gap-[var(--ow-settings-header-gap)]">
          <div className="mt-0.5 text-muted-foreground">
            <Command className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />
          </div>
          <div className="space-y-[var(--ow-space-1)]">
            <div className="[font-size:var(--ow-font-label)] font-semibold text-foreground">
              {command.title}
            </div>
            <div className="[font-size:var(--ow-settings-description-size)] leading-[var(--ow-line-body)] text-muted-foreground">
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
                dispatch({ type: "edit-started" })
                window.requestAnimationFrame(() => {
                  recorderButtonRef.current?.focus()
                })
                void refreshAvailability()
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
            <div className="rounded-[var(--ow-settings-card-radius)] border border-border/70 bg-background px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)]">
              <div className="[font-size:var(--ow-font-body)] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {copy.shortcuts.recordingTitle}
              </div>
              <div className="mt-[var(--ow-space-2)] [font-size:var(--ow-font-label)] text-muted-foreground">
                {copy.shortcuts.recordingDescription}
              </div>
              <button
                ref={recorderButtonRef}
                type="button"
                data-shortcut-recorder={command.id}
                className="mt-[var(--ow-space-3)] min-h-[var(--ow-settings-control-h)] min-w-[var(--ow-settings-select-w)] rounded-[var(--ow-radius-md)] border border-[var(--ring)] bg-background-elevated px-[var(--ow-space-3)] py-[var(--ow-space-1)] text-left [font-size:var(--ow-settings-control-font)] font-medium text-foreground outline-none"
                onKeyDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  const nextChord = toShortcutChordFromKeyboardEvent(event)
                  if (nextChord) {
                    dispatch({ type: "draft-chord-changed", chord: nextChord })
                  }
                }}
                onClick={(event) => {
                  event.preventDefault()
                }}
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
                    dispatch({ type: "cancel-recording" })
                  }}
                  disabled={isSaving}
                >
                  {copy.shortcuts.cancel}
                </button>
              </div>
            </div>
          ) : null}

          <div className="grid gap-[var(--ow-gap-md)] md:grid-cols-2">
            <div className="rounded-[var(--ow-settings-card-radius)] border border-border/70 bg-background px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)]">
              <div className="[font-size:var(--ow-font-body)] uppercase tracking-[0.08em] text-muted-foreground">
                {copy.shortcuts.defaultBindingLabel}
              </div>
              <div className="mt-[var(--ow-space-2)] [font-size:var(--ow-font-label)] font-medium text-foreground">
                {defaultBindingText}
              </div>
            </div>

            {defaultBinding.scope === "global" ? (
              <div className="rounded-[var(--ow-settings-card-radius)] border border-border/70 bg-background px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)]">
                <div className="[font-size:var(--ow-font-body)] uppercase tracking-[0.08em] text-muted-foreground">
                  {copy.shortcuts.registrationStatus}
                </div>
                <div className="mt-[var(--ow-space-2)] flex flex-wrap items-center gap-[var(--ow-gap-md)]">
                  <span
                    data-shortcut-registration-state={command.id}
                    data-shortcut-registration-state-value={registrationStatus.state}
                    className={`inline-flex rounded-full border px-[var(--ow-space-2)] py-[var(--ow-space-1)] [font-size:var(--ow-font-meta)] font-medium ${
                      statusClassName[registrationStatus.state]
                    }`}
                  >
                    {registrationStatus.label}
                  </span>
                  {registrationStatus.accelerator ? (
                    <span
                      data-shortcut-registration-accelerator={command.id}
                      className="[font-size:var(--ow-font-body)] text-muted-foreground"
                    >
                      {registrationStatus.accelerator}
                    </span>
                  ) : null}
                </div>
                {registrationStatus.reason ? (
                  <div className="mt-[var(--ow-space-2)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-muted-foreground">
                    {registrationStatus.reason}
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
    <div className={settingsPageClassName}>
      <div className={settingsPageHeaderClassName}>
        <div className={settingsPageTitleClassName}>{copy.shortcuts.title}</div>
        <div className={settingsPageDescriptionClassName}>{copy.shortcuts.description}</div>
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
