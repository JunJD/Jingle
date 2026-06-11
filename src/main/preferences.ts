import { safeStorage } from "electron"
import Store from "electron-store"
import { mkdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import type { AgentConfig } from "./types"
import { getOpenworkDir } from "./storage"
import { listNativeExtensionManifests } from "@extensions/index"
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

interface SecretsStoreShape {
  nativeExtensionSecrets: NativeExtensionSecretsState
}

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  desktopAutomationAllowlist: [],
  skillSources: [],
  locale: DEFAULT_APP_LOCALE
}

const DEFAULT_NATIVE_EXTENSION_PREFERENCES: NativeExtensionPreferencesState = {
  extensionPreferences: {},
  commandPreferences: {}
}

interface NativeExtensionSecretsState {
  extensionSecrets: Record<string, Record<string, string>>
  commandSecrets: Record<string, Record<string, string>>
}

const DEFAULT_NATIVE_EXTENSION_SECRETS: NativeExtensionSecretsState = {
  extensionSecrets: {},
  commandSecrets: {}
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

const secretsStore = new Store<SecretsStoreShape>({
  name: "secrets",
  cwd: getOpenworkDir(),
  defaults: {
    nativeExtensionSecrets: DEFAULT_NATIVE_EXTENSION_SECRETS
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
    extensionPreferences: normalizePreferenceRecordMap(raw.extensionPreferences),
    commandPreferences: normalizePreferenceRecordMap(raw.commandPreferences)
  }
}

function normalizeNativeExtensionSecretsState(value: unknown): NativeExtensionSecretsState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_NATIVE_EXTENSION_SECRETS
  }

  const raw = value as Partial<NativeExtensionSecretsState>

  return {
    extensionSecrets: normalizeSecretRecordMap(raw.extensionSecrets),
    commandSecrets: normalizeSecretRecordMap(raw.commandSecrets)
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

function isPasswordPreference(preference: NativeExtensionPreferenceSchema): boolean {
  return preference.type === "password"
}

function listPasswordPreferenceNames(schema: NativeExtensionPreferenceSchema[]): Set<string> {
  return new Set(
    schema
      .filter((preference) => isPasswordPreference(preference))
      .map((preference) => preference.name)
  )
}

function getNativeExtensionManifest(extensionName: string) {
  const manifest = listNativeExtensionManifests(process.platform).find(
    (entry) => entry.name === extensionName
  )
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

function assertSecretStorageAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure secret storage is not available on this system.")
  }
}

function encryptSecretValue(value: string): string {
  assertSecretStorageAvailable()
  return safeStorage.encryptString(value).toString("base64")
}

function decryptSecretValue(value: string): string {
  assertSecretStorageAvailable()
  return safeStorage.decryptString(Buffer.from(value, "base64"))
}

function omitPasswordPreferenceValues(
  schema: NativeExtensionPreferenceSchema[],
  record: Record<string, unknown>
): Record<string, unknown> {
  const secretPreferenceNames = listPasswordPreferenceNames(schema)
  if (secretPreferenceNames.size === 0) {
    return record
  }

  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !secretPreferenceNames.has(key))
  )
}

function resolveNextSecretPreferenceRecord(params: {
  currentRecord: Record<string, string>
  nextRecord: Record<string, unknown>
  schema: NativeExtensionPreferenceSchema[]
}): Record<string, string> {
  const nextSecretRecord = { ...params.currentRecord }

  for (const preferenceName of listPasswordPreferenceNames(params.schema)) {
    if (!Object.hasOwn(params.nextRecord, preferenceName)) {
      continue
    }

    const secretValue = String(params.nextRecord[preferenceName] ?? "")
    if (secretValue.length > 0) {
      nextSecretRecord[preferenceName] = secretValue
      continue
    }

    delete nextSecretRecord[preferenceName]
  }

  return nextSecretRecord
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

function getNativeExtensionSecretsState(): NativeExtensionSecretsState {
  const stored = secretsStore.get("nativeExtensionSecrets", DEFAULT_NATIVE_EXTENSION_SECRETS) as
    | NativeExtensionSecretsState
    | undefined

  return normalizeNativeExtensionSecretsState(stored)
}

function setNativeExtensionSecretsState(nextState: NativeExtensionSecretsState): void {
  secretsStore.set("nativeExtensionSecrets", nextState)
}

function getNativeExtensionSecretRecord(params: {
  key: string
  schema: NativeExtensionPreferenceSchema[]
  scope: "command" | "extension"
}): Record<string, string> {
  const state = getNativeExtensionSecretsState()
  const encryptedRecord =
    params.scope === "extension"
      ? normalizeSecretRecord(state.extensionSecrets[params.key])
      : normalizeSecretRecord(state.commandSecrets[params.key])

  return Object.fromEntries(
    params.schema
      .filter((preference) => isPasswordPreference(preference))
      .flatMap((preference) => {
        const encryptedValue = encryptedRecord[preference.name]
        if (!encryptedValue) {
          return []
        }

        return [[preference.name, decryptSecretValue(encryptedValue)]]
      })
  )
}

export function getNativeExtensionConnectionSecretRecord(params: {
  connectionId: string
  provider: string
  secretNames: string[]
}): Record<string, string> {
  const schema = params.secretNames.map((secretName) => ({
    name: secretName,
    type: "password"
  }))

  return getNativeExtensionSecretRecord({
    key: getConnectionSecretStoreKey(params.provider, params.connectionId),
    schema,
    scope: "extension"
  })
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

  setNativeExtensionSecretRecord({
    key: getConnectionSecretStoreKey(params.provider, params.connectionId),
    nextRecord,
    scope: "extension"
  })

  return getNativeExtensionConnectionSecretRecord(params)
}

function hasStoredPasswordPreferenceValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

export function getResolvedNativeExtensionLegacyExtensionScopedPasswordRecord(params: {
  extensionName: string
  passwordPreferenceNames: string[]
}): Record<string, string> {
  const key = getExtensionPreferenceStoreKey(params.extensionName)
  const passwordPreferenceNames = params.passwordPreferenceNames.filter((entry) => entry.trim())
  const secretsState = getNativeExtensionSecretsState()
  const settingsState = getNativeExtensionPreferencesState()
  const legacyRecord: Record<string, string> = {}
  const encryptedRecord = normalizeSecretRecord(secretsState.extensionSecrets[key])

  for (const preferenceName of passwordPreferenceNames) {
    const encryptedValue = encryptedRecord[preferenceName]
    if (encryptedValue) {
      legacyRecord[preferenceName] = decryptSecretValue(encryptedValue)
    }
  }

  const settingsRecord = normalizePreferenceRecord(settingsState.extensionPreferences[key])
  for (const preferenceName of passwordPreferenceNames) {
    if (legacyRecord[preferenceName]) {
      continue
    }

    const value = settingsRecord[preferenceName]
    if (hasStoredPasswordPreferenceValue(value)) {
      legacyRecord[preferenceName] = value
    }
  }

  return legacyRecord
}

export function getResolvedNativeExtensionLegacyCommandScopedPasswordRecord(params: {
  extensionName: string
  passwordPreferenceNames: string[]
}): Record<string, string> {
  const commandKeyPrefix = `${params.extensionName}:`
  const passwordPreferenceNames = params.passwordPreferenceNames.filter((entry) => entry.trim())
  const secretsState = getNativeExtensionSecretsState()
  const settingsState = getNativeExtensionPreferencesState()
  const legacyRecord: Record<string, string> = {}

  for (const [commandKey, encryptedRecord] of Object.entries(secretsState.commandSecrets)) {
    if (!commandKey.startsWith(commandKeyPrefix)) {
      continue
    }

    for (const preferenceName of passwordPreferenceNames) {
      if (legacyRecord[preferenceName]) {
        continue
      }

      const encryptedValue = encryptedRecord[preferenceName]
      if (encryptedValue) {
        legacyRecord[preferenceName] = decryptSecretValue(encryptedValue)
      }
    }
  }

  for (const [commandKey, record] of Object.entries(settingsState.commandPreferences)) {
    if (!commandKey.startsWith(commandKeyPrefix)) {
      continue
    }

    for (const preferenceName of passwordPreferenceNames) {
      if (legacyRecord[preferenceName]) {
        continue
      }

      const value = record[preferenceName]
      if (hasStoredPasswordPreferenceValue(value)) {
        legacyRecord[preferenceName] = value
      }
    }
  }

  return legacyRecord
}

function setNativeExtensionSecretRecord(params: {
  key: string
  nextRecord: Record<string, string>
  scope: "command" | "extension"
}): void {
  const state = getNativeExtensionSecretsState()
  const encryptedRecord = Object.fromEntries(
    Object.entries(params.nextRecord).map(([key, value]) => [key, encryptSecretValue(value)])
  )

  if (params.scope === "extension") {
    const extensionSecrets = { ...state.extensionSecrets }
    if (Object.keys(encryptedRecord).length === 0) {
      delete extensionSecrets[params.key]
    } else {
      extensionSecrets[params.key] = encryptedRecord
    }

    setNativeExtensionSecretsState({
      ...state,
      extensionSecrets
    })
    return
  }

  const commandSecrets = { ...state.commandSecrets }
  if (Object.keys(encryptedRecord).length === 0) {
    delete commandSecrets[params.key]
  } else {
    commandSecrets[params.key] = encryptedRecord
  }

  setNativeExtensionSecretsState({
    ...state,
    commandSecrets
  })
}

function stripPasswordPreferenceValues(
  schema: NativeExtensionPreferenceSchema[],
  record: Record<string, unknown>
): Record<string, unknown> {
  if (!schema.some((preference) => isPasswordPreference(preference))) {
    return record
  }

  return Object.fromEntries(
    schema.map((preference) => [
      preference.name,
      isPasswordPreference(preference)
        ? getDefaultPreferenceValue(preference)
        : normalizePreferenceValue(
            preference,
            record[preference.name] ?? getDefaultPreferenceValue(preference)
          )
    ])
  )
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
  return readNativeExtensionCommandPreferenceRecord({
    commandName,
    extensionName,
    includeSecrets: false
  })
}

export function getResolvedNativeExtensionCommandPreferenceRecord(
  extensionName: string,
  commandName: string
): Record<string, unknown> {
  return readNativeExtensionCommandPreferenceRecord({
    commandName,
    extensionName,
    includeSecrets: true
  })
}

function readNativeExtensionCommandPreferenceRecord(params: {
  commandName: string
  extensionName: string
  includeSecrets: boolean
}): Record<string, unknown> {
  const state = getNativeExtensionPreferencesState()
  const commandKey = getCommandPreferenceStoreKey(params.extensionName, params.commandName)
  const commandSchema = getCommandPreferenceSchema(params.extensionName, params.commandName)
  const extensionRecord = readNativeExtensionPreferenceRecord({
    extensionName: params.extensionName,
    includeSecrets: params.includeSecrets
  })
  const resolvedCommandRecord = resolveCommandPreferenceRecord({
    commandName: params.commandName,
    extensionName: params.extensionName,
    nextRecord: normalizePreferenceRecord(state.commandPreferences[commandKey])
  })
  const commandRecord = params.includeSecrets
    ? {
        ...resolvedCommandRecord,
        ...getNativeExtensionSecretRecord({
          key: commandKey,
          schema: commandSchema,
          scope: "command"
        })
      }
    : stripPasswordPreferenceValues(commandSchema, resolvedCommandRecord)

  return {
    ...extensionRecord,
    ...commandRecord
  }
}

export function getNativeExtensionPreferenceRecord(extensionName: string): Record<string, unknown> {
  return readNativeExtensionPreferenceRecord({
    extensionName,
    includeSecrets: false
  })
}

export function getResolvedNativeExtensionPreferenceRecord(
  extensionName: string
): Record<string, unknown> {
  return readNativeExtensionPreferenceRecord({
    extensionName,
    includeSecrets: true
  })
}

function readNativeExtensionPreferenceRecord(params: {
  extensionName: string
  includeSecrets: boolean
}): Record<string, unknown> {
  const state = getNativeExtensionPreferencesState()
  const key = getExtensionPreferenceStoreKey(params.extensionName)
  const schema = getExtensionPreferenceSchema(params.extensionName)
  const resolvedRecord = resolveExtensionPreferenceRecord({
    extensionName: params.extensionName,
    nextRecord: normalizePreferenceRecord(state.extensionPreferences[key])
  })

  if (!params.includeSecrets) {
    return stripPasswordPreferenceValues(schema, resolvedRecord)
  }

  const extensionSecretRecord = getNativeExtensionSecretRecord({
    key,
    schema,
    scope: "extension"
  })

  return {
    ...resolvedRecord,
    ...extensionSecretRecord
  }
}

export function setNativeExtensionPreferenceRecord(
  extensionName: string,
  nextRecord: Record<string, unknown>
): Record<string, unknown> {
  const state = getNativeExtensionPreferencesState()
  const key = getExtensionPreferenceStoreKey(extensionName)
  const schema = getExtensionPreferenceSchema(extensionName)
  const rawRecord = normalizePreferenceRecord(nextRecord)
  const normalizedRecord = resolveExtensionPreferenceRecord({
    extensionName,
    nextRecord: rawRecord
  })
  const secretRecord = resolveNextSecretPreferenceRecord({
    currentRecord: getNativeExtensionSecretRecord({
      key,
      schema,
      scope: "extension"
    }),
    nextRecord: rawRecord,
    schema
  })
  const settingsRecord = omitPasswordPreferenceValues(schema, normalizedRecord)
  const nextState: NativeExtensionPreferencesState = {
    extensionPreferences: {
      ...state.extensionPreferences,
      [key]: settingsRecord
    },
    commandPreferences: state.commandPreferences
  }

  settingsStore.set("nativeExtensionPreferences", nextState)
  if (listPasswordPreferenceNames(schema).size > 0) {
    setNativeExtensionSecretRecord({
      key,
      nextRecord: secretRecord,
      scope: "extension"
    })
  } else {
    setNativeExtensionSecretRecord({
      key,
      nextRecord: {},
      scope: "extension"
    })
  }
  return getNativeExtensionPreferenceRecord(extensionName)
}

export function setNativeExtensionCommandPreferenceRecord(
  extensionName: string,
  commandName: string,
  nextRecord: Record<string, unknown>
): Record<string, unknown> {
  const state = getNativeExtensionPreferencesState()
  const key = getCommandPreferenceStoreKey(extensionName, commandName)
  const schema = getCommandPreferenceSchema(extensionName, commandName)
  const rawRecord = normalizePreferenceRecord(nextRecord)
  const normalizedRecord = resolveCommandPreferenceRecord({
    commandName,
    extensionName,
    nextRecord: rawRecord
  })
  const secretRecord = resolveNextSecretPreferenceRecord({
    currentRecord: getNativeExtensionSecretRecord({
      key,
      schema,
      scope: "command"
    }),
    nextRecord: rawRecord,
    schema
  })
  const settingsRecord = omitPasswordPreferenceValues(schema, normalizedRecord)
  const nextState: NativeExtensionPreferencesState = {
    extensionPreferences: state.extensionPreferences,
    commandPreferences: {
      ...state.commandPreferences,
      [key]: settingsRecord
    }
  }

  settingsStore.set("nativeExtensionPreferences", nextState)
  if (listPasswordPreferenceNames(schema).size > 0) {
    setNativeExtensionSecretRecord({
      key,
      nextRecord: secretRecord,
      scope: "command"
    })
  } else {
    setNativeExtensionSecretRecord({
      key,
      nextRecord: {},
      scope: "command"
    })
  }
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
