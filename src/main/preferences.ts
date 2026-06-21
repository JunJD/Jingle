import Store from "electron-store"
import { mkdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import type { AgentConfig } from "./types"
import { getOpenworkDir } from "./storage"
import { getDefaultExtensionRegistryService } from "./extensions/registry/default-registry"
import { DEFAULT_MODELS } from "@shared/models"
import { DEFAULT_APP_LOCALE, normalizeAppLocale } from "@shared/i18n"
import type { DefaultModels, SupportedDefaultModelType } from "@shared/app-types"
import {
  DEFAULT_APP_THEME_SETTINGS,
  normalizeAppThemeSettings,
  type AppThemeSettings
} from "@shared/app-theme"
import type {
  NativeExtensionPreferenceSchema,
  NativeExtensionPreferencesState
} from "@shared/native-extensions"
import { normalizeNativeExtensionApplicationPreferenceValue } from "@shared/native-extensions"
import {
  DEFAULT_LAUNCHER_SETTINGS,
  normalizeLauncherSettings,
  type LauncherSettings
} from "@shared/launcher-settings"
import {
  DEFAULT_SHORTCUT_SETTINGS,
  normalizeShortcutSettings,
  type ShortcutSettings
} from "@shared/shortcuts/settings"
import {
  DEFAULT_OPENWORK_MEMORY_SETTINGS,
  normalizeOpenworkMemorySettings,
  type OpenworkMemorySettings
} from "@shared/openwork-memory"

export interface PersistedWindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
}

export interface PersistedLauncherWindowState {
  x: number
  y: number
}

interface SettingsStoreShape {
  agentConfig: AgentConfig
  appThemeSettings: AppThemeSettings
  defaultModels: DefaultModels
  launcherSettings: LauncherSettings
  launcherWindowState: PersistedLauncherWindowState | null
  mainWindowState: PersistedWindowState | null
  nativeExtensionPreferences: NativeExtensionPreferencesState
  openworkMemorySettings: OpenworkMemorySettings
  shortcutSettings: ShortcutSettings
  workspaceDialogPath: string | null
  workspacePath: string | null
}

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  desktopAutomationAllowlist: [],
  skillSources: [],
  locale: DEFAULT_APP_LOCALE
}

const DEFAULT_NATIVE_EXTENSION_PREFERENCES: NativeExtensionPreferencesState = {
  connectionSecrets: {},
  extensionPreferences: {},
  commandPreferences: {}
}

const DEFAULT_WORKSPACE_PATH = join(homedir(), "Documents", "Jingle")

function ensureDefaultWorkspacePath(): string {
  mkdirSync(DEFAULT_WORKSPACE_PATH, { recursive: true })
  return DEFAULT_WORKSPACE_PATH
}

const settingsStore = new Store<SettingsStoreShape>({
  name: "settings",
  cwd: getOpenworkDir(),
  defaults: {
    agentConfig: DEFAULT_AGENT_CONFIG,
    appThemeSettings: DEFAULT_APP_THEME_SETTINGS,
    defaultModels: DEFAULT_MODELS,
    launcherSettings: DEFAULT_LAUNCHER_SETTINGS,
    launcherWindowState: null,
    mainWindowState: null,
    nativeExtensionPreferences: DEFAULT_NATIVE_EXTENSION_PREFERENCES,
    openworkMemorySettings: DEFAULT_OPENWORK_MEMORY_SETTINGS,
    shortcutSettings: DEFAULT_SHORTCUT_SETTINGS,
    workspaceDialogPath: null,
    workspacePath: DEFAULT_WORKSPACE_PATH
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

function normalizeDesktopAutomationAllowlist(value: unknown): string[] {
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

function normalizeSecretRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key, entry]) => key.trim().length > 0 && typeof entry === "string" && entry.length > 0
      )
      .map(([key, entry]) => [key, entry] as const)
  ) as Record<string, string>
}

function normalizeSecretRecordMap(value: unknown): Record<string, Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, record]) => [
      key,
      normalizeSecretRecord(record)
    ])
  )
}

function normalizeNativeExtensionPreferencesState(value: unknown): NativeExtensionPreferencesState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_NATIVE_EXTENSION_PREFERENCES
  }

  const raw = value as Partial<NativeExtensionPreferencesState>

  return {
    connectionSecrets: normalizeSecretRecordMap(raw.connectionSecrets),
    extensionPreferences: normalizePreferenceRecordMap(raw.extensionPreferences),
    commandPreferences: normalizePreferenceRecordMap(raw.commandPreferences)
  }
}

function getExtensionPreferenceStoreKey(extensionName: string): string {
  return extensionName
}

function getCommandPreferenceStoreKey(extensionName: string, commandName: string): string {
  return `${extensionName}:${commandName}`
}

function getConnectionSecretStoreKey(provider: string, connectionId: string): string {
  return `connection:${provider}:${connectionId}`
}

function getNativeExtensionManifest(extensionName: string) {
  const manifest = getDefaultExtensionRegistryService()
    .listManifests(process.platform)
    .find((entry) => entry.name === extensionName)
  if (!manifest) {
    throw new Error(`Unknown native extension "${extensionName}"`)
  }

  return manifest
}

function getExtensionPreferenceSchema(extensionName: string): NativeExtensionPreferenceSchema[] {
  return getNativeExtensionManifest(extensionName).preferences ?? []
}

function getCommandPreferenceSchema(
  extensionName: string,
  commandName: string
): NativeExtensionPreferenceSchema[] {
  const manifest = getNativeExtensionManifest(extensionName)

  const command = manifest.commands.find((entry) => entry.name === commandName)
  if (!command) {
    throw new Error(`Native extension "${extensionName}" does not declare command "${commandName}"`)
  }

  return command.preferences ?? []
}

function getDefaultPreferenceValue(preference: NativeExtensionPreferenceSchema): unknown {
  if (preference.default !== undefined) {
    return normalizePreferenceValue(preference, preference.default)
  }

  if (preference.type === "checkbox") {
    return false
  }

  if (preference.type === "dropdown") {
    return preference.data?.[0]?.value ?? ""
  }

  return ""
}

function normalizePreferenceValue(
  preference: NativeExtensionPreferenceSchema,
  value: unknown
): unknown {
  if (preference.type === "appPicker") {
    return normalizeNativeExtensionApplicationPreferenceValue(value)
  }

  return value
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
      normalizePreferenceValue(
        preference,
        params.nextRecord[preference.name] ?? getDefaultPreferenceValue(preference)
      )
    ])
  )
}

function resolveExtensionPreferenceRecord(params: {
  extensionName: string
  nextRecord: Record<string, unknown>
}): Record<string, unknown> {
  const schema = getExtensionPreferenceSchema(params.extensionName)

  return Object.fromEntries(
    schema.map((preference) => [
      preference.name,
      normalizePreferenceValue(
        preference,
        params.nextRecord[preference.name] ?? getDefaultPreferenceValue(preference)
      )
    ])
  )
}

function normalizeWindowCoordinate(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined
  }

  return Math.round(value)
}

export function getNativeExtensionConnectionSecretRecord(params: {
  connectionId: string
  provider: string
  secretNames: string[]
}): Record<string, string> {
  const key = getConnectionSecretStoreKey(params.provider, params.connectionId)
  const record = normalizeSecretRecord(getNativeExtensionPreferencesState().connectionSecrets[key])

  return Object.fromEntries(
    params.secretNames.flatMap((secretName) => {
      const value = record[secretName]
      return value ? [[secretName, value]] : []
    })
  )
}

export function setNativeExtensionConnectionSecretRecord(params: {
  connectionId: string
  nextRecord: Record<string, string>
  provider: string
  secretNames: string[]
}): Record<string, string> {
  const nextRecord = Object.fromEntries(
    params.secretNames.flatMap((secretName) => {
      const value = params.nextRecord[secretName]
      return value && value.length > 0 ? [[secretName, value]] : []
    })
  )

  const state = getNativeExtensionPreferencesState()
  const key = getConnectionSecretStoreKey(params.provider, params.connectionId)
  const connectionSecrets = { ...state.connectionSecrets }
  if (Object.keys(nextRecord).length === 0) {
    delete connectionSecrets[key]
  } else {
    connectionSecrets[key] = nextRecord
  }

  settingsStore.set("nativeExtensionPreferences", {
    ...state,
    connectionSecrets
  })

  return getNativeExtensionConnectionSecretRecord(params)
}

function normalizeWindowDimension(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null
  }

  return Math.round(value)
}

export function getDefaultModels(): DefaultModels {
  return settingsStore.get("defaultModels", DEFAULT_MODELS)
}

export function getDefaultModelId(modelType: SupportedDefaultModelType): string {
  return getDefaultModels()[modelType]
}

export function setDefaultModelId(modelType: SupportedDefaultModelType, modelId: string): void {
  settingsStore.set("defaultModels", {
    ...getDefaultModels(),
    [modelType]: modelId
  })
}

export function getGlobalWorkspacePath(): string | null {
  const workspacePath =
    settingsStore.get("workspacePath", DEFAULT_WORKSPACE_PATH) ?? DEFAULT_WORKSPACE_PATH
  return workspacePath === DEFAULT_WORKSPACE_PATH ? ensureDefaultWorkspacePath() : workspacePath
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
    desktopAutomationAllowlist: normalizeDesktopAutomationAllowlist(
      stored?.desktopAutomationAllowlist
    ),
    skillSources: normalizePathList(stored?.skillSources),
    locale: normalizeAppLocale(stored?.locale)
  }
}

export function setAgentConfig(updates: Partial<AgentConfig>): AgentConfig {
  const nextConfig: AgentConfig = {
    ...getAgentConfig(),
    ...(updates.desktopAutomationAllowlist !== undefined
      ? {
          desktopAutomationAllowlist: normalizeDesktopAutomationAllowlist(
            updates.desktopAutomationAllowlist
          )
        }
      : {}),
    ...(updates.skillSources ? { skillSources: normalizePathList(updates.skillSources) } : {}),
    ...(updates.locale ? { locale: normalizeAppLocale(updates.locale) } : {})
  }

  settingsStore.set("agentConfig", nextConfig)
  return nextConfig
}

export function getAppThemeSettings(): AppThemeSettings {
  const stored = settingsStore.get("appThemeSettings", DEFAULT_APP_THEME_SETTINGS) as
    | AppThemeSettings
    | undefined

  return normalizeAppThemeSettings(stored)
}

export function setAppThemeSettings(updates: Partial<AppThemeSettings>): AppThemeSettings {
  const nextSettings = normalizeAppThemeSettings({
    ...getAppThemeSettings(),
    ...updates
  })

  settingsStore.set("appThemeSettings", nextSettings)
  return nextSettings
}

export function getOpenworkMemorySettings(): OpenworkMemorySettings {
  const stored = settingsStore.get("openworkMemorySettings", DEFAULT_OPENWORK_MEMORY_SETTINGS) as
    | Partial<OpenworkMemorySettings>
    | undefined

  return normalizeOpenworkMemorySettings(stored)
}

export function setOpenworkMemorySettings(
  updates: Partial<OpenworkMemorySettings>
): OpenworkMemorySettings {
  const nextSettings = normalizeOpenworkMemorySettings({
    ...getOpenworkMemorySettings(),
    ...updates
  })

  settingsStore.set("openworkMemorySettings", nextSettings)
  return nextSettings
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
  return readNativeExtensionCommandPreferenceRecord(extensionName, commandName)
}

export function getResolvedNativeExtensionCommandPreferenceRecord(
  extensionName: string,
  commandName: string
): Record<string, unknown> {
  return readNativeExtensionCommandPreferenceRecord(extensionName, commandName)
}

function readNativeExtensionCommandPreferenceRecord(
  extensionName: string,
  commandName: string
): Record<string, unknown> {
  const state = getNativeExtensionPreferencesState()
  const commandKey = getCommandPreferenceStoreKey(extensionName, commandName)
  const extensionRecord = readNativeExtensionPreferenceRecord(extensionName)
  const resolvedCommandRecord = resolveCommandPreferenceRecord({
    commandName,
    extensionName,
    nextRecord: normalizePreferenceRecord(state.commandPreferences[commandKey])
  })

  return {
    ...extensionRecord,
    ...resolvedCommandRecord
  }
}

export function getNativeExtensionPreferenceRecord(extensionName: string): Record<string, unknown> {
  return readNativeExtensionPreferenceRecord(extensionName)
}

export function getResolvedNativeExtensionPreferenceRecord(
  extensionName: string
): Record<string, unknown> {
  return readNativeExtensionPreferenceRecord(extensionName)
}

function readNativeExtensionPreferenceRecord(extensionName: string): Record<string, unknown> {
  const state = getNativeExtensionPreferencesState()
  const key = getExtensionPreferenceStoreKey(extensionName)
  const resolvedRecord = resolveExtensionPreferenceRecord({
    extensionName,
    nextRecord: normalizePreferenceRecord(state.extensionPreferences[key])
  })

  return resolvedRecord
}

export function setNativeExtensionPreferenceRecord(
  extensionName: string,
  nextRecord: Record<string, unknown>
): Record<string, unknown> {
  const state = getNativeExtensionPreferencesState()
  const key = getExtensionPreferenceStoreKey(extensionName)
  const rawRecord = normalizePreferenceRecord(nextRecord)
  const normalizedRecord = resolveExtensionPreferenceRecord({
    extensionName,
    nextRecord: rawRecord
  })
  const nextState: NativeExtensionPreferencesState = {
    connectionSecrets: state.connectionSecrets,
    extensionPreferences: {
      ...state.extensionPreferences,
      [key]: normalizedRecord
    },
    commandPreferences: state.commandPreferences
  }

  settingsStore.set("nativeExtensionPreferences", nextState)
  return getNativeExtensionPreferenceRecord(extensionName)
}

export function setNativeExtensionCommandPreferenceRecord(
  extensionName: string,
  commandName: string,
  nextRecord: Record<string, unknown>
): Record<string, unknown> {
  const state = getNativeExtensionPreferencesState()
  const key = getCommandPreferenceStoreKey(extensionName, commandName)
  const rawRecord = normalizePreferenceRecord(nextRecord)
  const normalizedRecord = resolveCommandPreferenceRecord({
    commandName,
    extensionName,
    nextRecord: rawRecord
  })
  const nextState: NativeExtensionPreferencesState = {
    connectionSecrets: state.connectionSecrets,
    extensionPreferences: state.extensionPreferences,
    commandPreferences: {
      ...state.commandPreferences,
      [key]: normalizedRecord
    }
  }

  settingsStore.set("nativeExtensionPreferences", nextState)
  return getNativeExtensionCommandPreferenceRecord(extensionName, commandName)
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

export function getLauncherWindowState(): PersistedLauncherWindowState | null {
  const stored = settingsStore.get("launcherWindowState", null)

  if (!stored || typeof stored !== "object") {
    return null
  }

  const partial = stored as Partial<PersistedLauncherWindowState>
  const x = normalizeWindowCoordinate(partial.x)
  const y = normalizeWindowCoordinate(partial.y)

  if (x === undefined || y === undefined) {
    return null
  }

  return { x, y }
}

export function setLauncherWindowState(
  windowState: PersistedLauncherWindowState
): PersistedLauncherWindowState {
  const nextState: PersistedLauncherWindowState = {
    x: Math.round(windowState.x),
    y: Math.round(windowState.y)
  }

  settingsStore.set("launcherWindowState", nextState)
  return nextState
}

export function getShortcutSettings(): ShortcutSettings {
  const stored = settingsStore.get("shortcutSettings", DEFAULT_SHORTCUT_SETTINGS) as
    | ShortcutSettings
    | undefined

  return normalizeShortcutSettings(stored)
}

export function setShortcutSettings(updates: Partial<ShortcutSettings>): ShortcutSettings {
  const nextSettings = normalizeShortcutSettings({
    ...getShortcutSettings(),
    ...(updates.overrides ? { overrides: updates.overrides } : {})
  })

  settingsStore.set("shortcutSettings", nextSettings)
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
