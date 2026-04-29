import { safeStorage } from "electron"
import Store from "electron-store"
import { homedir } from "os"
import type { AgentConfig, ProviderId } from "./types"
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

export interface PersistedWindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
}

interface SettingsStoreShape {
  agentConfig: AgentConfig
  appThemeSettings: AppThemeSettings
  defaultModels: DefaultModels
  launcherSettings: LauncherSettings
  mainWindowState: PersistedWindowState | null
  nativeExtensionPreferences: NativeExtensionPreferencesState
  shortcutSettings: ShortcutSettings
  workspaceDialogPath: string | null
  workspacePath: string | null
}

interface SecretsStoreShape {
  nativeExtensionSecrets: NativeExtensionSecretsState
  providerSecrets: ProviderSecretsState
}

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  desktopAutomationAllowlist: [],
  skillSources: [],
  memorySources: [],
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

interface ProviderSecretsState {
  providers: Record<string, Record<string, string>>
}

const DEFAULT_NATIVE_EXTENSION_SECRETS: NativeExtensionSecretsState = {
  extensionSecrets: {},
  commandSecrets: {}
}

const DEFAULT_PROVIDER_SECRETS: ProviderSecretsState = {
  providers: {}
}
const DEFAULT_WORKSPACE_PATH = homedir()

const settingsStore = new Store<SettingsStoreShape>({
  name: "settings",
  cwd: getOpenworkDir(),
  defaults: {
    agentConfig: DEFAULT_AGENT_CONFIG,
    appThemeSettings: DEFAULT_APP_THEME_SETTINGS,
    defaultModels: DEFAULT_MODELS,
    launcherSettings: DEFAULT_LAUNCHER_SETTINGS,
    mainWindowState: null,
    nativeExtensionPreferences: DEFAULT_NATIVE_EXTENSION_PREFERENCES,
    shortcutSettings: DEFAULT_SHORTCUT_SETTINGS,
    workspaceDialogPath: null,
    workspacePath: DEFAULT_WORKSPACE_PATH
  }
})

const secretsStore = new Store<SecretsStoreShape>({
  name: "secrets",
  cwd: getOpenworkDir(),
  defaults: {
    nativeExtensionSecrets: DEFAULT_NATIVE_EXTENSION_SECRETS,
    providerSecrets: DEFAULT_PROVIDER_SECRETS
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

function normalizeProviderSecretsState(value: unknown): ProviderSecretsState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_PROVIDER_SECRETS
  }

  const raw = value as Partial<ProviderSecretsState>

  return {
    providers: normalizeSecretRecordMap(raw.providers)
  }
}

function getExtensionPreferenceStoreKey(extensionName: string): string {
  return extensionName
}

function getCommandPreferenceStoreKey(extensionName: string, commandName: string): string {
  return `${extensionName}:${commandName}`
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

function splitSecretPreferenceRecord(
  schema: NativeExtensionPreferenceSchema[],
  nextRecord: Record<string, unknown>
): {
  secretRecord: Record<string, string>
  settingsRecord: Record<string, unknown>
} {
  const secretPreferenceNames = listPasswordPreferenceNames(schema)
  const secretRecord: Record<string, string> = {}
  const settingsRecord: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(nextRecord)) {
    if (!secretPreferenceNames.has(key)) {
      settingsRecord[key] = value
      continue
    }

    const secretValue = String(value ?? "")
    if (secretValue.length > 0) {
      secretRecord[key] = secretValue
    }
  }

  return {
    secretRecord,
    settingsRecord
  }
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

function resolveExtensionPreferenceRecord(params: {
  extensionName: string
  nextRecord: Record<string, unknown>
}): Record<string, unknown> {
  const schema = getExtensionPreferenceSchema(params.extensionName)

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

function getNativeExtensionSecretsState(): NativeExtensionSecretsState {
  const stored = secretsStore.get("nativeExtensionSecrets", DEFAULT_NATIVE_EXTENSION_SECRETS) as
    | NativeExtensionSecretsState
    | undefined

  return normalizeNativeExtensionSecretsState(stored)
}

function setNativeExtensionSecretsState(nextState: NativeExtensionSecretsState): void {
  secretsStore.set("nativeExtensionSecrets", nextState)
}

function getProviderSecretsState(): ProviderSecretsState {
  const stored = secretsStore.get("providerSecrets", DEFAULT_PROVIDER_SECRETS) as
    | ProviderSecretsState
    | undefined

  return normalizeProviderSecretsState(stored)
}

function setProviderSecretsState(nextState: ProviderSecretsState): void {
  secretsStore.set("providerSecrets", nextState)
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
    setNativeExtensionSecretsState({
      ...state,
      extensionSecrets: {
        ...state.extensionSecrets,
        [params.key]: encryptedRecord
      }
    })
    return
  }

  setNativeExtensionSecretsState({
    ...state,
    commandSecrets: {
      ...state.commandSecrets,
      [params.key]: encryptedRecord
    }
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
        : (record[preference.name] ?? getDefaultPreferenceValue(preference))
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
  return settingsStore.get("workspacePath", DEFAULT_WORKSPACE_PATH) ?? DEFAULT_WORKSPACE_PATH
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
    memorySources: normalizePathList(stored?.memorySources),
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
    ...(updates.memorySources ? { memorySources: normalizePathList(updates.memorySources) } : {}),
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

export function getProviderSecret(providerId: ProviderId, secretName: string): string | null {
  const encryptedValue = getProviderSecretsState().providers[providerId]?.[secretName]
  if (!encryptedValue) {
    return null
  }

  return decryptSecretValue(encryptedValue)
}

export function setProviderSecret(
  providerId: ProviderId,
  secretName: string,
  secretValue: string
): void {
  const state = getProviderSecretsState()
  const providerSecrets = state.providers[providerId] ?? {}

  setProviderSecretsState({
    ...state,
    providers: {
      ...state.providers,
      [providerId]: {
        ...providerSecrets,
        [secretName]: encryptSecretValue(secretValue)
      }
    }
  })
}

export function deleteProviderSecret(providerId: ProviderId, secretName: string): void {
  const state = getProviderSecretsState()
  const providerSecrets = { ...(state.providers[providerId] ?? {}) }

  if (!providerSecrets[secretName]) {
    return
  }

  delete providerSecrets[secretName]

  if (Object.keys(providerSecrets).length === 0) {
    const nextProviders = { ...state.providers }
    delete nextProviders[providerId]
    setProviderSecretsState({
      ...state,
      providers: nextProviders
    })
    return
  }

  setProviderSecretsState({
    ...state,
    providers: {
      ...state.providers,
      [providerId]: providerSecrets
    }
  })
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
  const extensionKey = getExtensionPreferenceStoreKey(extensionName)
  const commandKey = getCommandPreferenceStoreKey(extensionName, commandName)
  const extensionSchema = getExtensionPreferenceSchema(extensionName)
  const commandSchema = getCommandPreferenceSchema(extensionName, commandName)
  const extensionRecord = stripPasswordPreferenceValues(
    extensionSchema,
    resolveExtensionPreferenceRecord({
      extensionName,
      nextRecord: normalizePreferenceRecord(state.extensionPreferences[extensionKey])
    })
  )
  const commandRecord = stripPasswordPreferenceValues(
    commandSchema,
    resolveCommandPreferenceRecord({
      commandName,
      extensionName,
      nextRecord: normalizePreferenceRecord(state.commandPreferences[commandKey])
    })
  )
  const extensionSecretRecord = getNativeExtensionSecretRecord({
    key: extensionKey,
    schema: extensionSchema,
    scope: "extension"
  })
  const commandSecretRecord = getNativeExtensionSecretRecord({
    key: commandKey,
    schema: commandSchema,
    scope: "command"
  })

  return {
    ...extensionRecord,
    ...extensionSecretRecord,
    ...commandRecord,
    ...commandSecretRecord
  }
}

export function getNativeExtensionPreferenceRecord(extensionName: string): Record<string, unknown> {
  const state = getNativeExtensionPreferencesState()
  const key = getExtensionPreferenceStoreKey(extensionName)
  const schema = getExtensionPreferenceSchema(extensionName)
  const resolvedRecord = stripPasswordPreferenceValues(
    schema,
    resolveExtensionPreferenceRecord({
      extensionName,
      nextRecord: normalizePreferenceRecord(state.extensionPreferences[key])
    })
  )
  const secretRecord = getNativeExtensionSecretRecord({
    key,
    schema,
    scope: "extension"
  })

  return {
    ...resolvedRecord,
    ...secretRecord
  }
}

export function setNativeExtensionPreferenceRecord(
  extensionName: string,
  nextRecord: Record<string, unknown>
): Record<string, unknown> {
  const state = getNativeExtensionPreferencesState()
  const key = getExtensionPreferenceStoreKey(extensionName)
  const schema = getExtensionPreferenceSchema(extensionName)
  const normalizedRecord = resolveExtensionPreferenceRecord({
    extensionName,
    nextRecord: normalizePreferenceRecord(nextRecord)
  })
  const { secretRecord, settingsRecord } = splitSecretPreferenceRecord(schema, normalizedRecord)
  const nextState: NativeExtensionPreferencesState = {
    extensionPreferences: {
      ...state.extensionPreferences,
      [key]: settingsRecord
    },
    commandPreferences: state.commandPreferences
  }

  settingsStore.set("nativeExtensionPreferences", nextState)
  setNativeExtensionSecretRecord({
    key,
    nextRecord: secretRecord,
    scope: "extension"
  })
  return normalizedRecord
}

export function setNativeExtensionCommandPreferenceRecord(
  extensionName: string,
  commandName: string,
  nextRecord: Record<string, unknown>
): Record<string, unknown> {
  const state = getNativeExtensionPreferencesState()
  const key = getCommandPreferenceStoreKey(extensionName, commandName)
  const schema = getCommandPreferenceSchema(extensionName, commandName)
  const normalizedRecord = resolveCommandPreferenceRecord({
    commandName,
    extensionName,
    nextRecord: normalizePreferenceRecord(nextRecord)
  })
  const { secretRecord, settingsRecord } = splitSecretPreferenceRecord(schema, normalizedRecord)
  const nextState: NativeExtensionPreferencesState = {
    extensionPreferences: state.extensionPreferences,
    commandPreferences: {
      ...state.commandPreferences,
      [key]: settingsRecord
    }
  }

  settingsStore.set("nativeExtensionPreferences", nextState)
  setNativeExtensionSecretRecord({
    key,
    nextRecord: secretRecord,
    scope: "command"
  })
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
