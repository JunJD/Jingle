import Store from "electron-store"
import { mkdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { isDeepStrictEqual } from "node:util"
import type { AgentConfig } from "./types"
import { getJingleHomeDir } from "./storage"
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
  NativeExtensionConnectionManifest,
  NativeExtensionPreferenceSchema,
  NativeExtensionPreferencesState,
  NativeExtensionPackageManifest
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
  DEFAULT_JINGLE_MEMORY_SETTINGS,
  normalizeJingleMemorySettings,
  type JingleMemorySettings
} from "@shared/jingle-memory"
import { DEFAULT_AGENT_FOLLOW_UP_MODE, normalizeAgentFollowUpMode } from "@shared/agent-follow-up"

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

export interface PinnedAiSessionWindowRestoreState {
  threadIds: string[]
}

interface SettingsStoreShape {
  agentConfig: AgentConfig
  appThemeSettings: AppThemeSettings
  defaultModels: DefaultModels
  launcherSettings: LauncherSettings
  launcherWindowState: PersistedLauncherWindowState | null
  mainWindowState: PersistedWindowState | null
  nativeExtensionPreferences: PersistedNativeExtensionPreferencesState
  jingleMemorySettings?: JingleMemorySettings
  pinnedAiSessionWindowRestoreState: PinnedAiSessionWindowRestoreState
  shortcutSettings: ShortcutSettings
  workspaceDialogPath: string | null
  workspacePath: string | null
}

interface NativeExtensionConnectionRevisions {
  connectionConfigRevision: number
  credentialRevision: number
}

interface NativeExtensionRevisionState {
  commandConfigs: Record<string, number>
  connectionConfigs: Record<string, NativeExtensionConnectionRevisions>
  extensionConfigs: Record<string, number>
  version: 1
}

interface PersistedNativeExtensionPreferencesState extends NativeExtensionPreferencesState {
  revisions: NativeExtensionRevisionState
}

export interface NativeExtensionConfigurationRevisions {
  commandConfigRevision: number
  connectionConfigRevision: number
  credentialRevision: number
  extensionConfigRevision: number
}

export interface NativeExtensionConfigurationToken {
  commandName?: string
  connectionId: string
  extensionName: string
  provider: string
  revisions: NativeExtensionConfigurationRevisions
}

export type NativeExtensionConfigurationMutationKind =
  | "command-config"
  | "connection-config"
  | "credential"
  | "extension-config"

export type NativeExtensionConfigurationMutation = NativeExtensionConfigurationToken & {
  changed: readonly NativeExtensionConfigurationMutationKind[]
}

export interface NativeExtensionConfigurationSnapshot {
  commandName?: string
  commandPreferences?: Record<string, unknown>
  connection: NativeExtensionConnectionManifest
  connectionSecrets: Record<string, string>
  extensionName: string
  extensionPreferences: Record<string, unknown>
  publicConfig: Record<string, unknown>
  token: NativeExtensionConfigurationToken
}

export interface NativeExtensionConfigurationCommit<TValue> {
  mutation: NativeExtensionConfigurationMutation
  snapshot: NativeExtensionConfigurationSnapshot
  value: TValue
}

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  desktopAutomationAllowlist: [],
  followUpMode: DEFAULT_AGENT_FOLLOW_UP_MODE,
  skillSources: [],
  locale: DEFAULT_APP_LOCALE
}

const DEFAULT_NATIVE_EXTENSION_PREFERENCES: PersistedNativeExtensionPreferencesState = {
  connectionSecrets: {},
  extensionPreferences: {},
  commandPreferences: {},
  revisions: {
    commandConfigs: {},
    connectionConfigs: {},
    extensionConfigs: {},
    version: 1
  }
}

const DEFAULT_PINNED_AI_SESSION_WINDOW_RESTORE_STATE: PinnedAiSessionWindowRestoreState = {
  threadIds: []
}

const JINGLE_MEMORY_SETTINGS_KEY = "jingleMemorySettings"
const DEFAULT_WORKSPACE_PATH = join(homedir(), "Documents", "Jingle")

function ensureDefaultWorkspacePath(): string {
  mkdirSync(DEFAULT_WORKSPACE_PATH, { recursive: true })
  return DEFAULT_WORKSPACE_PATH
}

const settingsStore = new Store<SettingsStoreShape>({
  name: "settings",
  cwd: getJingleHomeDir(),
  defaults: {
    agentConfig: DEFAULT_AGENT_CONFIG,
    appThemeSettings: DEFAULT_APP_THEME_SETTINGS,
    defaultModels: DEFAULT_MODELS,
    launcherSettings: DEFAULT_LAUNCHER_SETTINGS,
    launcherWindowState: null,
    mainWindowState: null,
    nativeExtensionPreferences: DEFAULT_NATIVE_EXTENSION_PREFERENCES,
    pinnedAiSessionWindowRestoreState: DEFAULT_PINNED_AI_SESSION_WINDOW_RESTORE_STATE,
    shortcutSettings: DEFAULT_SHORTCUT_SETTINGS,
    workspaceDialogPath: null,
    workspacePath: DEFAULT_WORKSPACE_PATH
  }
})

function normalizePathList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const paths = value.flatMap((entry) => {
    if (typeof entry !== "string") {
      return []
    }

    const path = entry.trim()
    return path ? [path] : []
  })
  return Array.from(new Set(paths))
}

function normalizePinnedAiSessionWindowRestoreState(
  value: unknown
): PinnedAiSessionWindowRestoreState {
  if (!value || typeof value !== "object") {
    return DEFAULT_PINNED_AI_SESSION_WINDOW_RESTORE_STATE
  }

  const partial = value as Partial<PinnedAiSessionWindowRestoreState>
  if (!Array.isArray(partial.threadIds)) {
    return DEFAULT_PINNED_AI_SESSION_WINDOW_RESTORE_STATE
  }

  const threadIds = partial.threadIds.flatMap((entry) => {
    if (typeof entry !== "string") {
      return []
    }

    const threadId = entry.trim()
    return threadId ? [threadId] : []
  })

  return {
    threadIds: Array.from(new Set(threadIds))
  }
}

function normalizeDesktopAutomationAllowlist(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const bundleIds = value.flatMap((entry) => {
    if (typeof entry !== "string") {
      return []
    }

    const bundleId = entry.trim()
    return bundleId ? [bundleId] : []
  })
  return Array.from(new Set(bundleIds))
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
    Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      key.trim().length > 0 && typeof entry === "string" && entry.length > 0
        ? [[key, entry] as const]
        : []
    )
  )
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

function normalizeRevision(value: unknown, owner: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Invalid persisted native extension revision for ${owner}`)
  }

  return value as number
}

function normalizeRevisionRecord(value: unknown, owner: string): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid persisted native extension revision map for ${owner}`)
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, revision]) => [
      key,
      normalizeRevision(revision, `${owner}:${key}`)
    ])
  )
}

function normalizeConnectionRevisionRecord(
  value: unknown
): Record<string, NativeExtensionConnectionRevisions> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid persisted native extension connection revision map")
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, revisions]) => {
      if (!revisions || typeof revisions !== "object" || Array.isArray(revisions)) {
        throw new Error(`Invalid persisted native extension connection revisions for ${key}`)
      }

      const record = revisions as Record<string, unknown>
      return [
        key,
        {
          connectionConfigRevision: normalizeRevision(
            record.connectionConfigRevision,
            `connection-config:${key}`
          ),
          credentialRevision: normalizeRevision(record.credentialRevision, `credential:${key}`)
        }
      ]
    })
  )
}

function normalizeNativeExtensionRevisionState(value: unknown): NativeExtensionRevisionState {
  if (value === undefined) {
    return DEFAULT_NATIVE_EXTENSION_PREFERENCES.revisions
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid persisted native extension revision state")
  }

  const raw = value as Partial<NativeExtensionRevisionState>
  if (raw.version !== 1) {
    throw new Error(`Unsupported native extension revision state version: ${String(raw.version)}`)
  }

  return {
    commandConfigs: normalizeRevisionRecord(raw.commandConfigs, "command-config"),
    connectionConfigs: normalizeConnectionRevisionRecord(raw.connectionConfigs),
    extensionConfigs: normalizeRevisionRecord(raw.extensionConfigs, "extension-config"),
    version: 1
  }
}

function normalizeNativeExtensionPreferencesState(
  value: unknown
): PersistedNativeExtensionPreferencesState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_NATIVE_EXTENSION_PREFERENCES
  }

  const raw = value as Partial<PersistedNativeExtensionPreferencesState>

  return {
    connectionSecrets: normalizeSecretRecordMap(raw.connectionSecrets),
    extensionPreferences: normalizePreferenceRecordMap(raw.extensionPreferences),
    commandPreferences: normalizePreferenceRecordMap(raw.commandPreferences),
    revisions: normalizeNativeExtensionRevisionState(raw.revisions)
  }
}

function getExtensionPreferenceStoreKey(extensionName: string): string {
  return extensionName
}

function getCommandPreferenceStoreKey(extensionName: string, commandName: string): string {
  if (extensionName.includes("\0") || commandName.includes("\0")) {
    throw new Error("Native extension command identity contains a reserved null character")
  }
  if (extensionName.includes(":") || commandName.includes(":")) {
    return `\0${JSON.stringify(["command", extensionName, commandName])}`
  }

  return `${extensionName}:${commandName}`
}

export function getNativeExtensionConnectionOwnerKey(params: {
  connectionId: string
  extensionName: string
  provider: string
}): string {
  return JSON.stringify(["connection", params.extensionName, params.provider, params.connectionId])
}

function getCommandRevisionStoreKey(extensionName: string, commandName: string): string {
  return JSON.stringify(["command", extensionName, commandName])
}

function getNativeExtensionManifest(
  extensionName: string,
  platform: string = process.platform
): NativeExtensionPackageManifest {
  const manifest = getDefaultExtensionRegistryService()
    .listManifests(platform)
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

  return getCommandPreferenceSchemaFromManifest(manifest, commandName)
}

function getCommandPreferenceSchemaFromManifest(
  manifest: NativeExtensionPackageManifest,
  commandName: string
): NativeExtensionPreferenceSchema[] {
  const command = manifest.commands.find((entry) => entry.name === commandName)
  if (!command) {
    throw new Error(`Native extension "${manifest.name}" does not declare command "${commandName}"`)
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

function normalizeJsonFact(value: unknown, path: string, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Native extension preference ${path} must be a finite number`)
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new Error(`Native extension preference ${path} must not contain cycles`)
    }
    seen.add(value)
    const result: unknown[] = []
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new Error(`Native extension preference ${path} must not contain sparse arrays`)
      }
      result.push(normalizeJsonFact(value[index], `${path}[${index}]`, seen))
    }
    seen.delete(value)
    return result
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`Native extension preference ${path} must be a plain JSON object`)
    }
    if (seen.has(value)) {
      throw new Error(`Native extension preference ${path} must not contain cycles`)
    }
    seen.add(value)
    const result = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        normalizeJsonFact(entry, `${path}.${key}`, seen)
      ])
    )
    seen.delete(value)
    return result
  }

  throw new Error(`Native extension preference ${path} is not JSON-compatible`)
}

function normalizePreferenceFactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return normalizeJsonFact(value, "record", new Set()) as Record<string, unknown>
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object") {
    return value
  }
  if (seen.has(value)) {
    return value
  }

  seen.add(value)
  for (const nested of Object.values(value)) {
    deepFreeze(nested, seen)
  }
  return Object.freeze(value)
}

function resolveCommandPreferenceRecord(params: {
  commandName: string
  extensionName: string
  nextRecord: Record<string, unknown>
  schema?: NativeExtensionPreferenceSchema[]
}): Record<string, unknown> {
  const schema =
    params.schema ?? getCommandPreferenceSchema(params.extensionName, params.commandName)

  return normalizePreferenceFactRecord(
    Object.fromEntries(
      schema.map((preference) => [
        preference.name,
        normalizePreferenceValue(
          preference,
          params.nextRecord[preference.name] ?? getDefaultPreferenceValue(preference)
        )
      ])
    )
  )
}

function resolveExtensionPreferenceRecord(params: {
  extensionName: string
  nextRecord: Record<string, unknown>
  schema?: NativeExtensionPreferenceSchema[]
}): Record<string, unknown> {
  const schema = params.schema ?? getExtensionPreferenceSchema(params.extensionName)

  return normalizePreferenceFactRecord(
    Object.fromEntries(
      schema.map((preference) => [
        preference.name,
        normalizePreferenceValue(
          preference,
          params.nextRecord[preference.name] ?? getDefaultPreferenceValue(preference)
        )
      ])
    )
  )
}

function resolveConnectionPublicConfig(
  connection: NativeExtensionConnectionManifest,
  extensionPreferences: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    (connection.publicPreferenceNames ?? []).flatMap((preferenceName) =>
      Object.prototype.hasOwnProperty.call(extensionPreferences, preferenceName)
        ? [[preferenceName, structuredClone(extensionPreferences[preferenceName])]]
        : []
    )
  )
}

function incrementNativeExtensionRevision(revision: number, owner: string): number {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error(`Invalid native extension revision for ${owner}`)
  }
  if (revision === Number.MAX_SAFE_INTEGER) {
    throw new Error(`Native extension revision overflow for ${owner}`)
  }

  return revision + 1
}

function normalizeWindowCoordinate(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined
  }

  return Math.round(value)
}

export function getNativeExtensionConnectionSecretRecord(params: {
  connectionId: string
  extensionName: string
  provider: string
}): Record<string, string> {
  const manifest = getNativeExtensionManifest(params.extensionName)
  if (
    manifest.connection.id !== params.connectionId ||
    manifest.connection.provider !== params.provider
  ) {
    throw new Error(
      `Native extension "${params.extensionName}" does not own connection "${params.provider}:${params.connectionId}"`
    )
  }
  const state = getNativeExtensionPreferencesState()
  return readNativeExtensionConnectionSecretRecordFromState(state, {
    ...params,
    secretNames:
      manifest.connection.auth.type === "none" ? [] : manifest.connection.auth.secretNames
  })
}

export function setNativeExtensionConnectionSecretRecord(params: {
  connectionId: string
  expectedConnection?: NativeExtensionConnectionManifest
  extensionName: string
  mode: "merge" | "replace"
  nextRecord: Record<string, string>
  provider: string
}): NativeExtensionConfigurationCommit<Record<string, string>> {
  const manifest = getNativeExtensionManifest(params.extensionName)
  if (
    manifest.connection.id !== params.connectionId ||
    manifest.connection.provider !== params.provider
  ) {
    throw new Error(
      `Native extension "${params.extensionName}" does not own connection "${params.provider}:${params.connectionId}"`
    )
  }
  if (
    params.expectedConnection &&
    !isDeepStrictEqual(params.expectedConnection, manifest.connection)
  ) {
    throw new Error(
      `Native extension "${params.extensionName}" connection changed before credential commit`
    )
  }
  if (manifest.connection.auth.type === "none") {
    throw new Error(
      `Native extension "${params.extensionName}" connection "${params.connectionId}" does not use secrets`
    )
  }

  const state = getNativeExtensionPreferencesState()
  const secretNames = manifest.connection.auth.secretNames
  const currentRecord = readNativeExtensionConnectionSecretRecordFromState(state, {
    ...params,
    secretNames
  })
  const candidateRecord =
    params.mode === "merge" ? { ...currentRecord, ...params.nextRecord } : params.nextRecord
  const nextRecord = Object.fromEntries(
    secretNames.flatMap((secretName) => {
      const value = candidateRecord[secretName]
      return value && value.length > 0 ? [[secretName, value]] : []
    })
  )
  const key = getNativeExtensionConnectionOwnerKey(params)
  const connectionSecrets = { ...state.connectionSecrets }
  if (Object.keys(nextRecord).length === 0) {
    delete connectionSecrets[key]
  } else {
    connectionSecrets[key] = nextRecord
  }
  const currentConnectionRevisions = getNativeExtensionConnectionRevisions(state, key)
  const nextState: PersistedNativeExtensionPreferencesState = {
    ...state,
    connectionSecrets,
    revisions: {
      ...state.revisions,
      connectionConfigs: {
        ...state.revisions.connectionConfigs,
        [key]: {
          ...currentConnectionRevisions,
          credentialRevision: incrementNativeExtensionRevision(
            currentConnectionRevisions.credentialRevision,
            `credential:${key}`
          )
        }
      }
    }
  }
  const snapshot = createNativeExtensionConfigurationSnapshotFromState({
    manifest,
    state: nextState
  })
  const mutation = createNativeExtensionConfigurationMutation(snapshot.token, ["credential"])

  settingsStore.set("nativeExtensionPreferences", nextState)

  return {
    mutation,
    snapshot,
    value: structuredClone(
      readNativeExtensionConnectionSecretRecordFromState(nextState, {
        ...params,
        secretNames
      })
    )
  }
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
    followUpMode: normalizeAgentFollowUpMode(stored?.followUpMode),
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
    ...(updates.followUpMode
      ? { followUpMode: normalizeAgentFollowUpMode(updates.followUpMode) }
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

export function getJingleMemorySettings(): JingleMemorySettings {
  const stored = settingsStore.get(JINGLE_MEMORY_SETTINGS_KEY) as
    | Partial<JingleMemorySettings>
    | undefined
  if (stored) {
    return normalizeJingleMemorySettings(stored)
  }

  return DEFAULT_JINGLE_MEMORY_SETTINGS
}

export function setJingleMemorySettings(
  updates: Partial<JingleMemorySettings>
): JingleMemorySettings {
  const nextSettings = normalizeJingleMemorySettings({
    ...getJingleMemorySettings(),
    ...updates
  })

  settingsStore.set(JINGLE_MEMORY_SETTINGS_KEY, nextSettings)
  return nextSettings
}

function getNativeExtensionPreferencesState(): PersistedNativeExtensionPreferencesState {
  const stored = settingsStore.get(
    "nativeExtensionPreferences",
    DEFAULT_NATIVE_EXTENSION_PREFERENCES
  ) as PersistedNativeExtensionPreferencesState | undefined

  return normalizeNativeExtensionPreferencesState(stored)
}

function readNativeExtensionPreferenceRecordFromState(
  state: PersistedNativeExtensionPreferencesState,
  manifest: NativeExtensionPackageManifest
): Record<string, unknown> {
  const key = getExtensionPreferenceStoreKey(manifest.name)
  return resolveExtensionPreferenceRecord({
    extensionName: manifest.name,
    nextRecord: normalizePreferenceRecord(state.extensionPreferences[key]),
    schema: manifest.preferences ?? []
  })
}

function readNativeExtensionCommandPreferenceRecordFromState(
  state: PersistedNativeExtensionPreferencesState,
  manifest: NativeExtensionPackageManifest,
  commandName: string
): Record<string, unknown> {
  const commandKey = getCommandPreferenceStoreKey(manifest.name, commandName)
  const extensionRecord = readNativeExtensionPreferenceRecordFromState(state, manifest)
  const resolvedCommandRecord = resolveCommandPreferenceRecord({
    commandName,
    extensionName: manifest.name,
    nextRecord: normalizePreferenceRecord(state.commandPreferences[commandKey]),
    schema: getCommandPreferenceSchemaFromManifest(manifest, commandName)
  })

  return {
    ...extensionRecord,
    ...resolvedCommandRecord
  }
}

function readNativeExtensionConnectionSecretRecordFromState(
  state: PersistedNativeExtensionPreferencesState,
  params: {
    connectionId: string
    extensionName: string
    provider: string
    secretNames: string[]
  }
): Record<string, string> {
  const key = getNativeExtensionConnectionOwnerKey(params)
  const record = normalizeSecretRecord(state.connectionSecrets[key])

  return Object.fromEntries(
    params.secretNames.flatMap((secretName) => {
      const value = record[secretName]
      return value ? [[secretName, value]] : []
    })
  )
}

function getNativeExtensionConnectionRevisions(
  state: PersistedNativeExtensionPreferencesState,
  connectionKey: string
): NativeExtensionConnectionRevisions {
  return (
    state.revisions.connectionConfigs[connectionKey] ?? {
      connectionConfigRevision: 0,
      credentialRevision: 0
    }
  )
}

function createNativeExtensionConfigurationToken(params: {
  commandName?: string
  manifest: NativeExtensionPackageManifest
  state: PersistedNativeExtensionPreferencesState
}): NativeExtensionConfigurationToken {
  const connection = params.manifest.connection
  const connectionKey = getNativeExtensionConnectionOwnerKey({
    connectionId: connection.id,
    extensionName: params.manifest.name,
    provider: connection.provider
  })
  const connectionRevisions = getNativeExtensionConnectionRevisions(params.state, connectionKey)
  const commandConfigRevision = params.commandName
    ? (params.state.revisions.commandConfigs[
        getCommandRevisionStoreKey(params.manifest.name, params.commandName)
      ] ?? 0)
    : 0
  const revisions = Object.freeze<NativeExtensionConfigurationRevisions>({
    commandConfigRevision,
    connectionConfigRevision: connectionRevisions.connectionConfigRevision,
    credentialRevision: connectionRevisions.credentialRevision,
    extensionConfigRevision: params.state.revisions.extensionConfigs[params.manifest.name] ?? 0
  })

  return Object.freeze({
    ...(params.commandName ? { commandName: params.commandName } : {}),
    connectionId: connection.id,
    extensionName: params.manifest.name,
    provider: connection.provider,
    revisions
  })
}

function createNativeExtensionConfigurationSnapshotFromState(params: {
  commandName?: string
  manifest: NativeExtensionPackageManifest
  state: PersistedNativeExtensionPreferencesState
}): NativeExtensionConfigurationSnapshot {
  const extensionPreferences = readNativeExtensionPreferenceRecordFromState(
    params.state,
    params.manifest
  )
  const commandPreferences = params.commandName
    ? readNativeExtensionCommandPreferenceRecordFromState(
        params.state,
        params.manifest,
        params.commandName
      )
    : undefined
  const connection = structuredClone(params.manifest.connection)
  const connectionSecrets = readNativeExtensionConnectionSecretRecordFromState(params.state, {
    connectionId: connection.id,
    extensionName: params.manifest.name,
    provider: connection.provider,
    secretNames: connection.auth.type === "none" ? [] : connection.auth.secretNames
  })

  return deepFreeze({
    ...(params.commandName ? { commandName: params.commandName } : {}),
    ...(commandPreferences ? { commandPreferences: structuredClone(commandPreferences) } : {}),
    connection,
    connectionSecrets: structuredClone(connectionSecrets),
    extensionName: params.manifest.name,
    extensionPreferences: structuredClone(extensionPreferences),
    publicConfig: resolveConnectionPublicConfig(connection, extensionPreferences),
    token: createNativeExtensionConfigurationToken(params)
  })
}

function createNativeExtensionConfigurationMutation(
  token: NativeExtensionConfigurationToken,
  changed: NativeExtensionConfigurationMutationKind[]
): NativeExtensionConfigurationMutation {
  return Object.freeze({
    ...token,
    changed: Object.freeze([...changed])
  })
}

export function getNativeExtensionConfigurationSnapshot(input: {
  commandName?: string
  extensionName: string
  platform?: string
}): NativeExtensionConfigurationSnapshot {
  const manifest = getNativeExtensionManifest(input.extensionName, input.platform)
  const state = getNativeExtensionPreferencesState()

  return createNativeExtensionConfigurationSnapshotFromState({
    ...(input.commandName ? { commandName: input.commandName } : {}),
    manifest,
    state
  })
}

export function getNativeExtensionCommandPreferenceRecord(
  extensionName: string,
  commandName: string
): Record<string, unknown> {
  const manifest = getNativeExtensionManifest(extensionName)
  const state = getNativeExtensionPreferencesState()
  return readNativeExtensionCommandPreferenceRecordFromState(state, manifest, commandName)
}

export function getResolvedNativeExtensionCommandPreferenceRecord(
  extensionName: string,
  commandName: string
): Record<string, unknown> {
  const manifest = getNativeExtensionManifest(extensionName)
  const state = getNativeExtensionPreferencesState()
  return readNativeExtensionCommandPreferenceRecordFromState(state, manifest, commandName)
}

export function getNativeExtensionPreferenceRecord(extensionName: string): Record<string, unknown> {
  const manifest = getNativeExtensionManifest(extensionName)
  const state = getNativeExtensionPreferencesState()
  return readNativeExtensionPreferenceRecordFromState(state, manifest)
}

export function getResolvedNativeExtensionPreferenceRecord(
  extensionName: string
): Record<string, unknown> {
  const manifest = getNativeExtensionManifest(extensionName)
  const state = getNativeExtensionPreferencesState()
  return readNativeExtensionPreferenceRecordFromState(state, manifest)
}

export function setNativeExtensionPreferenceRecord(
  extensionName: string,
  nextRecord: Record<string, unknown>
): NativeExtensionConfigurationCommit<Record<string, unknown>> {
  const manifest = getNativeExtensionManifest(extensionName)
  const state = getNativeExtensionPreferencesState()
  const key = getExtensionPreferenceStoreKey(extensionName)
  const rawRecord = normalizePreferenceRecord(nextRecord)
  const normalizedRecord = resolveExtensionPreferenceRecord({
    extensionName,
    nextRecord: rawRecord,
    schema: manifest.preferences ?? []
  })
  const currentRecord = readNativeExtensionPreferenceRecordFromState(state, manifest)
  const currentPublicConfig = resolveConnectionPublicConfig(manifest.connection, currentRecord)
  const nextPublicConfig = resolveConnectionPublicConfig(manifest.connection, normalizedRecord)
  const connectionConfigChanged = !isDeepStrictEqual(currentPublicConfig, nextPublicConfig)
  const connectionKey = getNativeExtensionConnectionOwnerKey({
    connectionId: manifest.connection.id,
    extensionName,
    provider: manifest.connection.provider
  })
  const currentConnectionRevisions = getNativeExtensionConnectionRevisions(state, connectionKey)
  const nextConnectionRevisions: NativeExtensionConnectionRevisions = {
    connectionConfigRevision: connectionConfigChanged
      ? incrementNativeExtensionRevision(
          currentConnectionRevisions.connectionConfigRevision,
          `connection-config:${connectionKey}`
        )
      : currentConnectionRevisions.connectionConfigRevision,
    credentialRevision: currentConnectionRevisions.credentialRevision
  }
  const nextExtensionConfigRevision = incrementNativeExtensionRevision(
    state.revisions.extensionConfigs[extensionName] ?? 0,
    `extension-config:${extensionName}`
  )
  const nextState: PersistedNativeExtensionPreferencesState = {
    connectionSecrets: state.connectionSecrets,
    extensionPreferences: {
      ...state.extensionPreferences,
      [key]: normalizedRecord
    },
    commandPreferences: state.commandPreferences,
    revisions: {
      ...state.revisions,
      connectionConfigs: {
        ...state.revisions.connectionConfigs,
        [connectionKey]: nextConnectionRevisions
      },
      extensionConfigs: {
        ...state.revisions.extensionConfigs,
        [extensionName]: nextExtensionConfigRevision
      }
    }
  }
  const snapshot = createNativeExtensionConfigurationSnapshotFromState({
    manifest,
    state: nextState
  })
  const mutation = createNativeExtensionConfigurationMutation(snapshot.token, [
    "extension-config",
    ...(connectionConfigChanged ? (["connection-config"] as const) : [])
  ])

  settingsStore.set("nativeExtensionPreferences", nextState)
  return {
    mutation,
    snapshot,
    value: structuredClone(snapshot.extensionPreferences)
  }
}

export function setNativeExtensionCommandPreferenceRecord(
  extensionName: string,
  commandName: string,
  nextRecord: Record<string, unknown>
): NativeExtensionConfigurationCommit<Record<string, unknown>> {
  const manifest = getNativeExtensionManifest(extensionName)
  const state = getNativeExtensionPreferencesState()
  const key = getCommandPreferenceStoreKey(extensionName, commandName)
  const revisionKey = getCommandRevisionStoreKey(extensionName, commandName)
  const rawRecord = normalizePreferenceRecord(nextRecord)
  const normalizedRecord = resolveCommandPreferenceRecord({
    commandName,
    extensionName,
    nextRecord: rawRecord,
    schema: getCommandPreferenceSchemaFromManifest(manifest, commandName)
  })
  const nextCommandConfigRevision = incrementNativeExtensionRevision(
    state.revisions.commandConfigs[revisionKey] ?? 0,
    `command-config:${revisionKey}`
  )
  const nextState: PersistedNativeExtensionPreferencesState = {
    connectionSecrets: state.connectionSecrets,
    extensionPreferences: state.extensionPreferences,
    commandPreferences: {
      ...state.commandPreferences,
      [key]: normalizedRecord
    },
    revisions: {
      ...state.revisions,
      commandConfigs: {
        ...state.revisions.commandConfigs,
        [revisionKey]: nextCommandConfigRevision
      }
    }
  }
  const snapshot = createNativeExtensionConfigurationSnapshotFromState({
    commandName,
    manifest,
    state: nextState
  })
  const mutation = createNativeExtensionConfigurationMutation(snapshot.token, ["command-config"])

  settingsStore.set("nativeExtensionPreferences", nextState)
  return {
    mutation,
    snapshot,
    value: structuredClone(snapshot.commandPreferences ?? snapshot.extensionPreferences)
  }
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

export function getPinnedAiSessionWindowRestoreState(): PinnedAiSessionWindowRestoreState {
  return normalizePinnedAiSessionWindowRestoreState(
    settingsStore.get(
      "pinnedAiSessionWindowRestoreState",
      DEFAULT_PINNED_AI_SESSION_WINDOW_RESTORE_STATE
    )
  )
}

export function setPinnedAiSessionWindowRestoreState(
  state: PinnedAiSessionWindowRestoreState
): PinnedAiSessionWindowRestoreState {
  const nextState = normalizePinnedAiSessionWindowRestoreState(state)
  settingsStore.set("pinnedAiSessionWindowRestoreState", nextState)
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
