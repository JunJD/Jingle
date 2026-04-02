import Store from "electron-store"
import type { AgentConfig } from "./types"
import { getOpenworkDir } from "./storage"
import { nativeExtensions } from "../extensions"
import { DEFAULT_MODEL_ID } from "../shared/models"
import { DEFAULT_APP_LOCALE, normalizeAppLocale } from "../shared/i18n"
import type {
  NativeExtensionPreferenceSchema,
  NativeExtensionPreferencesState
} from "../shared/native-extensions"
import {
  DEFAULT_LAUNCHER_SETTINGS,
  normalizeLauncherSettings,
  type LauncherSettings
} from "../shared/launcher-settings"

export interface PersistedWindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
}

interface SettingsStoreShape {
  agentConfig: AgentConfig
  defaultModel: string
  launcherSettings: LauncherSettings
  mainWindowState: PersistedWindowState | null
  nativeExtensionPreferences: NativeExtensionPreferencesState
  workspaceDialogPath: string | null
  workspacePath: string | null
}

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  skillSources: [],
  memorySources: [],
  locale: DEFAULT_APP_LOCALE
}

const DEFAULT_NATIVE_EXTENSION_PREFERENCES: NativeExtensionPreferencesState = {
  commandPreferences: {}
}

const settingsStore = new Store<SettingsStoreShape>({
  name: "settings",
  cwd: getOpenworkDir(),
  defaults: {
    agentConfig: DEFAULT_AGENT_CONFIG,
    defaultModel: DEFAULT_MODEL_ID,
    launcherSettings: DEFAULT_LAUNCHER_SETTINGS,
    mainWindowState: null,
    nativeExtensionPreferences: DEFAULT_NATIVE_EXTENSION_PREFERENCES,
    workspaceDialogPath: null,
    workspacePath: null
  }
})

function normalizePathList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )
  )
}

function normalizePreferenceRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([key]) => key.trim().length > 0)
  )
}

function normalizePreferenceRecordMap(value: unknown): Record<string, Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, record]) => [
      key,
      normalizePreferenceRecord(record)
    ])
  )
}

function normalizeNativeExtensionPreferencesState(value: unknown): NativeExtensionPreferencesState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_NATIVE_EXTENSION_PREFERENCES
  }

  const raw = value as Partial<NativeExtensionPreferencesState>

  return {
    commandPreferences: normalizePreferenceRecordMap(raw.commandPreferences)
  }
}

function getCommandPreferenceStoreKey(extensionName: string, commandName: string): string {
  return `${extensionName}:${commandName}`
}

function getCommandPreferenceSchema(
  extensionName: string,
  commandName: string
): NativeExtensionPreferenceSchema[] {
  const manifest = nativeExtensions.find((entry) => entry.manifest.name === extensionName)?.manifest
  if (!manifest) {
    throw new Error(`Unknown native extension "${extensionName}"`)
  }

  const command = manifest.commands.find((entry) => entry.name === commandName)
  if (!command) {
    throw new Error(`Native extension "${extensionName}" does not declare command "${commandName}"`)
  }

  return command.preferences ?? []
}

function getDefaultPreferenceValue(preference: NativeExtensionPreferenceSchema): unknown {
  if (preference.default !== undefined) {
    return preference.default
  }

  if (preference.type === "checkbox") {
    return false
  }

  if (preference.type === "dropdown") {
    return preference.data?.[0]?.value ?? ""
  }

  return ""
}

function resolveCommandPreferenceRecord(params: {
  commandName: string
  extensionName: string
  nextRecord: Record<string, unknown>
}): Record<string, unknown> {
  const schema = getCommandPreferenceSchema(params.extensionName, params.commandName)

  return Object.fromEntries(
    schema.map((preference) => [
      preference.name,
      params.nextRecord[preference.name] ?? getDefaultPreferenceValue(preference)
    ])
  )
}

function normalizeWindowCoordinate(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined
  }

  return Math.round(value)
}

function normalizeWindowDimension(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null
  }

  return Math.round(value)
}

export function getDefaultModelId(): string {
  return settingsStore.get("defaultModel", DEFAULT_MODEL_ID)
}

export function setDefaultModelId(modelId: string): void {
  settingsStore.set("defaultModel", modelId)
}

export function getGlobalWorkspacePath(): string | null {
  return settingsStore.get("workspacePath", null)
}

export function setGlobalWorkspacePath(workspacePath: string | null): void {
  settingsStore.set("workspacePath", workspacePath)
}

export function getWorkspaceDialogPath(): string | null {
  return settingsStore.get("workspaceDialogPath", null)
}

export function setWorkspaceDialogPath(workspacePath: string | null): void {
  settingsStore.set("workspaceDialogPath", workspacePath)
}

export function getAgentConfig(): AgentConfig {
  const stored = settingsStore.get("agentConfig", DEFAULT_AGENT_CONFIG) as
    | Partial<AgentConfig>
    | undefined

  return {
    skillSources: normalizePathList(stored?.skillSources),
    memorySources: normalizePathList(stored?.memorySources),
    locale: normalizeAppLocale(stored?.locale)
  }
}

export function setAgentConfig(updates: Partial<AgentConfig>): AgentConfig {
  const nextConfig: AgentConfig = {
    ...getAgentConfig(),
    ...(updates.skillSources ? { skillSources: normalizePathList(updates.skillSources) } : {}),
    ...(updates.memorySources ? { memorySources: normalizePathList(updates.memorySources) } : {}),
    ...(updates.locale ? { locale: normalizeAppLocale(updates.locale) } : {})
  }

  settingsStore.set("agentConfig", nextConfig)
  return nextConfig
}

function getNativeExtensionPreferencesState(): NativeExtensionPreferencesState {
  const stored = settingsStore.get(
    "nativeExtensionPreferences",
    DEFAULT_NATIVE_EXTENSION_PREFERENCES
  ) as NativeExtensionPreferencesState | undefined

  return normalizeNativeExtensionPreferencesState(stored)
}

export function getNativeExtensionCommandPreferenceRecord(
  extensionName: string,
  commandName: string
): Record<string, unknown> {
  const state = getNativeExtensionPreferencesState()
  const key = getCommandPreferenceStoreKey(extensionName, commandName)
  const storedRecord = normalizePreferenceRecord(state.commandPreferences[key])
  return resolveCommandPreferenceRecord({
    commandName,
    extensionName,
    nextRecord: storedRecord
  })
}

export function setNativeExtensionCommandPreferenceRecord(
  extensionName: string,
  commandName: string,
  nextRecord: Record<string, unknown>
): Record<string, unknown> {
  const state = getNativeExtensionPreferencesState()
  const key = getCommandPreferenceStoreKey(extensionName, commandName)
  const normalizedRecord = resolveCommandPreferenceRecord({
    commandName,
    extensionName,
    nextRecord: normalizePreferenceRecord(nextRecord)
  })
  const nextState: NativeExtensionPreferencesState = {
    commandPreferences: {
      ...state.commandPreferences,
      [key]: normalizedRecord
    }
  }

  settingsStore.set("nativeExtensionPreferences", nextState)
  return normalizedRecord
}

export function getLauncherSettings(): LauncherSettings {
  const stored = settingsStore.get("launcherSettings", DEFAULT_LAUNCHER_SETTINGS) as
    | Partial<LauncherSettings>
    | undefined

  return normalizeLauncherSettings(stored)
}

export function setLauncherSettings(updates: Partial<LauncherSettings>): LauncherSettings {
  const nextSettings = normalizeLauncherSettings({
    ...getLauncherSettings(),
    ...updates
  })

  settingsStore.set("launcherSettings", nextSettings)
  return nextSettings
}

export function getMainWindowState(): PersistedWindowState | null {
  const stored = settingsStore.get("mainWindowState", null)

  if (!stored || typeof stored !== "object") {
    return null
  }

  const partial = stored as Partial<PersistedWindowState>
  const width = normalizeWindowDimension(partial.width)
  const height = normalizeWindowDimension(partial.height)
  const x = normalizeWindowCoordinate(partial.x)
  const y = normalizeWindowCoordinate(partial.y)

  if (width === null || height === null) {
    return null
  }

  return {
    width,
    height,
    ...(x === undefined ? {} : { x }),
    ...(y === undefined ? {} : { y }),
    isMaximized: partial.isMaximized === true
  }
}

export function setMainWindowState(windowState: PersistedWindowState): PersistedWindowState {
  const nextState: PersistedWindowState = {
    width: Math.round(windowState.width),
    height: Math.round(windowState.height),
    ...(windowState.x === undefined ? {} : { x: Math.round(windowState.x) }),
    ...(windowState.y === undefined ? {} : { y: Math.round(windowState.y) }),
    isMaximized: windowState.isMaximized
  }

  settingsStore.set("mainWindowState", nextState)
  return nextState
}
