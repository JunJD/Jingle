import type { ExtensionRuntimeHostCapability } from "./extension-runtime-protocol"
import {
  DEFAULT_APP_LOCALE,
  resolveLocalizedText,
  type AppLocale,
  type LocalizedTextValue
} from "./i18n"
import type {
  LauncherCommandMode,
  LauncherCommandOwnerCapability,
  LauncherCommandOwnerManifest
} from "./launcher-command-owner"
import type { ExtensionToolDefinition } from "./extension-sources"
import type { IpcErrorPayload } from "./ipc-error"
import type { PermissionModeName } from "./permission-mode"

export type NativeExtensionCommandMode = "background" | "menu-bar" | "no-view" | "view"
export type NativeExtensionIcon = string
export type NativeExtensionSupportedPlatform = "darwin" | "linux" | "win32"

export interface NativeExtensionApplicationPreferenceValue {
  bundleId?: string
  name?: string
  path?: string
}

export function normalizeNativeExtensionApplicationPreferenceValue(
  value: unknown
): NativeExtensionApplicationPreferenceValue | null {
  if (typeof value === "string") {
    const name = value.trim()
    return name ? { name } : null
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const raw = value as Record<string, unknown>
  const application: NativeExtensionApplicationPreferenceValue = {}
  if (typeof raw.name === "string" && raw.name.trim()) {
    application.name = raw.name.trim()
  }
  if (typeof raw.bundleId === "string" && raw.bundleId.trim()) {
    application.bundleId = raw.bundleId.trim()
  }
  if (typeof raw.path === "string" && raw.path.trim()) {
    application.path = raw.path.trim()
  }

  return Object.keys(application).length > 0 ? application : null
}

export function getNativeExtensionApplicationPreferenceLabel(value: unknown): string {
  if (typeof value === "string") {
    return value
  }

  const application = normalizeNativeExtensionApplicationPreferenceValue(value)
  return application?.name ?? application?.bundleId ?? application?.path ?? ""
}

export interface NativeExtensionPreferenceSchema {
  data?: Array<{ title?: LocalizedTextValue; value?: string }>
  default?: unknown
  description?: LocalizedTextValue
  label?: LocalizedTextValue
  name: string
  placeholder?: LocalizedTextValue
  required?: boolean
  title?: LocalizedTextValue
  type?: string
}

export interface NativeExtensionRuntimeCommandManifest {
  viewport?: {
    bodyHeight: number
  }
}

export interface NativeExtensionRuntimeShellManifest {
  allowedUrlSchemes?: string[]
}

export interface NativeExtensionCommandArgumentSchema {
  name: string
  placeholder?: LocalizedTextValue
  required?: boolean
  title?: LocalizedTextValue
  type?: string
}

export interface NativeExtensionCommandManifest<TCommandName extends string = string> {
  arguments?: NativeExtensionCommandArgumentSchema[]
  description?: LocalizedTextValue
  /** Extension-package-relative asset path, for example "assets/icon.svg". */
  icon?: NativeExtensionIcon
  iconName?: string
  keywords?: string[]
  mode: NativeExtensionCommandMode
  name: TCommandName
  preferences?: NativeExtensionPreferenceSchema[]
  runtime?: NativeExtensionRuntimeCommandManifest
  title?: LocalizedTextValue
}

export interface NativeExtensionAiCapabilityMentionManifest {
  label?: LocalizedTextValue
  value?: string
}

export interface NativeExtensionToolDisplayManifest {
  description: LocalizedTextValue
  title: LocalizedTextValue
}

export type NativeExtensionOAuthRedirectManifest =
  | {
      method: "web"
      redirectUrl: string
    }
  | {
      callbackPath: string
      method: "app-scheme"
      scheme: string
    }
  | {
      callbackPath: string
      method: "app-uri"
      uriScheme: string
    }

export type NativeExtensionConnectionAuthManifest =
  | {
      secretNames?: []
      type: "none"
    }
  | {
      secretNames: string[]
      type: "apiKey" | "personalAccessToken"
    }
  | {
      authorizationUrl: string
      clientId: string
      redirect: NativeExtensionOAuthRedirectManifest
      scopes: string[]
      secretNames: string[]
      tokenUrl: string
      type: "oauth"
    }

export interface NativeExtensionConnectionManifest {
  auth: NativeExtensionConnectionAuthManifest
  connectGuide?: string
  id: string
  provider: string
  publicPreferenceNames?: string[]
  title: LocalizedTextValue
}

export type NativeExtensionConnectionStatus = "connected" | "failed" | "missing" | "unsupported"

export interface NativeExtensionResolvedConnection {
  connectionId: string
  error?: string
  extensionName: string
  missingSecretNames: string[]
  provider: string
  publicConfig: Record<string, unknown>
  status: NativeExtensionConnectionStatus
}

export interface NativeExtensionOAuthStartRequest {
  connectionId?: string
  extensionName: string
}

export interface NativeExtensionConnectionSecretUpdateRequest {
  connectionId?: string
  extensionName: string
  secrets: Record<string, string>
}

export interface NativeExtensionOAuthStartResponse {
  authorizationUrl: string
  connectionId: string
  extensionName: string
  provider: string
}

export interface NativeExtensionOAuthCallbackResult {
  connectionId: string
  extensionName: string
  provider: string
  status: NativeExtensionConnectionStatus
}

export interface NativeExtensionExecutionContext {
  commandPreferences?: Record<string, unknown>
  connection: NativeExtensionResolvedConnection
  extensionName: string
  extensionPreferences: Record<string, unknown>
}

export interface NativeExtensionAiCapability {
  connectionId?: string
  description?: LocalizedTextValue
  guide: string
  id: string
  instructions?: string[]
  mention?: NativeExtensionAiCapabilityMentionManifest
  permissionMode?: PermissionModeName
  supportedPlatforms?: NativeExtensionSupportedPlatform[]
  title: LocalizedTextValue
  toolDisplays?: Record<string, NativeExtensionToolDisplayManifest>
  toolNames: string[]
}

export interface NativeExtensionPackageManifest<
  TExtensionName extends string = string,
  TCommandName extends string = string
> {
  aiCapability?: NativeExtensionAiCapability
  capabilities: LauncherCommandOwnerCapability[]
  commands: Array<NativeExtensionCommandManifest<TCommandName>>
  connection: NativeExtensionConnectionManifest
  defaultCommandName?: TCommandName
  description?: LocalizedTextValue
  /** Extension-package-relative asset path, for example "assets/icon.svg". */
  icon?: NativeExtensionIcon
  iconName?: string
  name: TExtensionName
  preferences?: NativeExtensionPreferenceSchema[]
  rpcMethods?: string[]
  runtimeCapabilities?: ExtensionRuntimeHostCapability[]
  runtimeShell?: NativeExtensionRuntimeShellManifest
  supportedPlatforms?: NativeExtensionSupportedPlatform[]
  title: LocalizedTextValue
}

export interface NativeExtensionService {
  extensionName: string
  invoke: (
    request: NativeExtensionInvokeRequest,
    context: NativeExtensionInvokeContext
  ) => Promise<unknown>
  methods: string[]
}

export interface NativeExtensionInvokeContext {
  connection?: NativeExtensionResolvedConnection
  extensionPreferences: Record<string, unknown>
}

export interface NativeExtensionMainDefinition {
  service?: NativeExtensionService
  tools?: ExtensionToolDefinition[]
}

export interface NativeExtensionCommandSettingsSchema {
  description: LocalizedTextValue
  icon?: NativeExtensionIcon
  iconName?: string
  keywords?: string[]
  mode: NativeExtensionCommandMode
  name: string
  preferences: NativeExtensionPreferenceSchema[]
  title: LocalizedTextValue
}

export interface InstalledNativeExtensionSettingsSchema {
  commands: NativeExtensionCommandSettingsSchema[]
  connection: NativeExtensionConnectionManifest
  description: LocalizedTextValue
  extName: string
  icon?: NativeExtensionIcon
  iconName?: string
  preferences: NativeExtensionPreferenceSchema[]
  title: LocalizedTextValue
}

export interface NativeExtensionPreferencesState {
  connectionSecrets: Record<string, Record<string, string>>
  extensionPreferences: Record<string, Record<string, unknown>>
  commandPreferences: Record<string, Record<string, unknown>>
}

export interface NativeExtensionPreferencesChangedEvent {
  commandName?: string
  extensionName: string
  scope: "command" | "extension"
}

export interface NativeExtensionInvokeRequest<TPayload = unknown> {
  extensionName: string
  method: string
  payload: TPayload
}

export type NativeExtensionInvokeIpcResponse<TResult = unknown> =
  | { ok: false; error: IpcErrorPayload }
  | { ok: true; result: TResult }

function isMissingRequiredNativeExtensionPreferenceValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length === 0
  }

  return value === null || value === undefined
}

function hasOwnRecordKey(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function getNativeExtensionPreferenceDisplayName(
  preference: NativeExtensionPreferenceSchema,
  locale: AppLocale
): string {
  return resolveLocalizedText(preference.title ?? preference.label, locale, preference.name)
}

function validateNativeExtensionIcon(
  manifestName: string,
  label: string,
  icon: NativeExtensionIcon | undefined
): void {
  if (icon === undefined) {
    return
  }

  if (!icon.trim()) {
    throw new Error(`Native extension "${manifestName}" declares an empty ${label} icon path`)
  }

  if (icon.startsWith("/") || icon.includes("..") || !icon.startsWith("assets/")) {
    throw new Error(
      `Native extension "${manifestName}" ${label} icon must be an extension-package-relative assets/ path`
    )
  }
}

function assertNonEmptyString(value: unknown, message: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message)
  }
}

function assertNonEmptyLocalizedText(
  value: unknown,
  message: string
): asserts value is LocalizedTextValue {
  if (typeof value === "string") {
    assertNonEmptyString(value, message)
    return
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message)
  }

  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.en_US !== "string" ||
    typeof candidate.zh_Hans !== "string" ||
    `${candidate.en_US}${candidate.zh_Hans}`.trim().length === 0
  ) {
    throw new Error(message)
  }
}

function validateOptionalStringArray(input: {
  extensionName: string
  fieldName: string
  values: unknown
}): string[] {
  if (input.values === undefined) {
    return []
  }

  if (!Array.isArray(input.values)) {
    throw new Error(`Native extension "${input.extensionName}" ${input.fieldName} must be an array`)
  }

  for (const value of input.values) {
    assertNonEmptyString(
      value,
      `Native extension "${input.extensionName}" ${input.fieldName} must contain non-empty strings`
    )
  }

  return input.values
}

function validateConnectionAuthManifest(
  manifestName: string,
  connection: NativeExtensionConnectionManifest
): Set<string> {
  const auth = connection.auth

  if (auth.type === "none") {
    if (auth.secretNames && auth.secretNames.length > 0) {
      throw new Error(
        `Native extension "${manifestName}" connection "${connection.id}" auth.secretNames must be empty for auth.type "none"`
      )
    }
    return new Set()
  }

  validateOptionalStringArray({
    extensionName: manifestName,
    fieldName: `connection "${connection.id}" auth.secretNames`,
    values: auth.secretNames
  })

  if (auth.secretNames.length === 0) {
    throw new Error(
      `Native extension "${manifestName}" connection "${connection.id}" auth.secretNames must contain at least one secret`
    )
  }

  if (auth.type !== "oauth") {
    return new Set(auth.secretNames)
  }

  assertNonEmptyString(
    auth.authorizationUrl,
    `Native extension "${manifestName}" connection "${connection.id}" auth.authorizationUrl must be non-empty`
  )
  assertNonEmptyString(
    auth.clientId,
    `Native extension "${manifestName}" connection "${connection.id}" auth.clientId must be non-empty`
  )
  assertNonEmptyString(
    auth.tokenUrl,
    `Native extension "${manifestName}" connection "${connection.id}" auth.tokenUrl must be non-empty`
  )
  validateOptionalStringArray({
    extensionName: manifestName,
    fieldName: `connection "${connection.id}" auth.scopes`,
    values: auth.scopes
  })

  const redirect = auth.redirect
  if (redirect.method === "web") {
    assertNonEmptyString(
      redirect.redirectUrl,
      `Native extension "${manifestName}" connection "${connection.id}" auth.redirect.redirectUrl must be non-empty`
    )
    return new Set(auth.secretNames)
  }

  if (redirect.method === "app-scheme") {
    assertNonEmptyString(
      redirect.scheme,
      `Native extension "${manifestName}" connection "${connection.id}" auth.redirect.scheme must be non-empty`
    )
    assertNonEmptyString(
      redirect.callbackPath,
      `Native extension "${manifestName}" connection "${connection.id}" auth.redirect.callbackPath must be non-empty`
    )
    return new Set(auth.secretNames)
  }

  assertNonEmptyString(
    redirect.uriScheme,
    `Native extension "${manifestName}" connection "${connection.id}" auth.redirect.uriScheme must be non-empty`
  )
  assertNonEmptyString(
    redirect.callbackPath,
    `Native extension "${manifestName}" connection "${connection.id}" auth.redirect.callbackPath must be non-empty`
  )

  return new Set(auth.secretNames)
}

function validateConnectionManifest(
  manifestName: string,
  connection: NativeExtensionConnectionManifest
): Set<string> {
  assertNonEmptyString(
    connection.id,
    `Native extension "${manifestName}" connection.id must be non-empty`
  )
  assertNonEmptyString(
    connection.provider,
    `Native extension "${manifestName}" connection.provider must be non-empty`
  )
  assertNonEmptyLocalizedText(
    connection.title,
    `Native extension "${manifestName}" connection.title must be non-empty`
  )
  const publicPreferenceNames = validateOptionalStringArray({
    extensionName: manifestName,
    fieldName: `connection "${connection.id}" publicPreferenceNames`,
    values: connection.publicPreferenceNames
  })
  if (connection.connectGuide !== undefined) {
    assertNonEmptyString(
      connection.connectGuide,
      `Native extension "${manifestName}" connection "${connection.id}" connectGuide must be non-empty when declared`
    )
  }
  const connectionSecretNames = validateConnectionAuthManifest(manifestName, connection)
  for (const preferenceName of publicPreferenceNames) {
    if (connectionSecretNames.has(preferenceName)) {
      throw new Error(
        `Native extension "${manifestName}" connection "${connection.id}" publicPreferenceNames cannot include secret "${preferenceName}"`
      )
    }
  }

  return connectionSecretNames
}

function validateRuntimeShellManifest(
  manifestName: string,
  runtimeShell: NativeExtensionRuntimeShellManifest | undefined,
  runtimeCapabilities: readonly ExtensionRuntimeHostCapability[]
): void {
  if (!runtimeShell) {
    return
  }

  const allowedUrlSchemes = validateOptionalStringArray({
    extensionName: manifestName,
    fieldName: "runtimeShell.allowedUrlSchemes",
    values: runtimeShell.allowedUrlSchemes
  })
  const normalizedSchemes = allowedUrlSchemes.map((scheme) => scheme.trim().toLowerCase())
  const blockedSchemes = new Set(["data", "file", "http", "https", "javascript"])

  for (const scheme of normalizedSchemes) {
    if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) {
      throw new Error(
        `Native extension "${manifestName}" runtimeShell.allowedUrlSchemes must contain URL schemes without ":"`
      )
    }

    if (blockedSchemes.has(scheme)) {
      throw new Error(
        `Native extension "${manifestName}" runtimeShell.allowedUrlSchemes cannot declare "${scheme}"`
      )
    }
  }

  if (new Set(normalizedSchemes).size !== normalizedSchemes.length) {
    throw new Error(
      `Native extension "${manifestName}" declares duplicate runtimeShell allowed URL schemes`
    )
  }

  if (normalizedSchemes.length > 0 && !runtimeCapabilities.includes("shell")) {
    throw new Error(
      `Native extension "${manifestName}" declares runtimeShell URL schemes without the "shell" runtime capability`
    )
  }
}

function validatePreferenceSchemas(input: {
  manifestName: string
  preferences: readonly NativeExtensionPreferenceSchema[] | undefined
  reservedSecretNames: ReadonlySet<string>
  scope: string
}): void {
  for (const preference of input.preferences ?? []) {
    if (preference.type === "password") {
      throw new Error(
        `Native extension "${input.manifestName}" ${input.scope} preference "${preference.name}" must use connection.auth instead of password preferences`
      )
    }
    if (input.reservedSecretNames.has(preference.name)) {
      throw new Error(
        `Native extension "${input.manifestName}" ${input.scope} preference "${preference.name}" must not reuse connection secret names`
      )
    }
  }
}

export function listMissingRequiredNativeExtensionPreferences(
  schema: NativeExtensionPreferenceSchema[],
  values: Record<string, unknown>,
  locale: AppLocale = DEFAULT_APP_LOCALE
): string[] {
  return schema
    .filter((preference) => preference.required)
    .filter((preference) =>
      isMissingRequiredNativeExtensionPreferenceValue(values[preference.name])
    )
    .map((preference) => getNativeExtensionPreferenceDisplayName(preference, locale))
}

export function defineNativeExtensionMain(
  main: NativeExtensionMainDefinition
): NativeExtensionMainDefinition {
  return main
}

export function defineNativeExtensionManifest(manifest: unknown): NativeExtensionPackageManifest {
  const resolvedManifest = manifest as NativeExtensionPackageManifest
  validateNativeExtensionPackageManifest(resolvedManifest)
  return resolvedManifest
}

export function validateNativeExtensionMainDefinition(
  manifest: NativeExtensionPackageManifest,
  main: NativeExtensionMainDefinition
): void {
  const service = main.service
  if (service && service.extensionName !== manifest.name) {
    throw new Error(
      `Native extension service "${service.extensionName}" does not match manifest "${manifest.name}"`
    )
  }
}

export function validateNativeExtensionPackageManifest(
  manifest: NativeExtensionPackageManifest
): void {
  if (!manifest.name.trim()) {
    throw new Error("Native extension manifest must declare a non-empty name")
  }

  assertNonEmptyLocalizedText(
    manifest.title,
    `Native extension "${manifest.name}" must declare a non-empty title`
  )

  if (hasOwnRecordKey(manifest, "ai")) {
    throw new Error(
      `Native extension "${manifest.name}" must declare agent integration through aiCapability, not ai`
    )
  }

  if (!manifest.connection) {
    throw new Error(`Native extension "${manifest.name}" must declare a connection manifest`)
  }

  const connectionSecretNames = validateConnectionManifest(manifest.name, manifest.connection)

  if (manifest.aiCapability) {
    const capability = manifest.aiCapability
    assertNonEmptyString(
      capability.id,
      `Native extension "${manifest.name}" aiCapability.id must be non-empty`
    )
    assertNonEmptyLocalizedText(
      capability.title,
      `Native extension "${manifest.name}" aiCapability.title must be non-empty`
    )
    assertNonEmptyString(
      capability.guide,
      `Native extension "${manifest.name}" aiCapability.guide must be non-empty`
    )

    validateOptionalStringArray({
      extensionName: manifest.name,
      fieldName: "aiCapability.instructions",
      values: capability.instructions
    })
    validateOptionalStringArray({
      extensionName: manifest.name,
      fieldName: "aiCapability.toolNames",
      values: capability.toolNames
    })
    if (capability.connectionId !== undefined) {
      assertNonEmptyString(
        capability.connectionId,
        `Native extension "${manifest.name}" aiCapability.connectionId must be non-empty when declared`
      )
      if (capability.connectionId !== manifest.connection.id) {
        throw new Error(
          `Native extension "${manifest.name}" aiCapability.connectionId references unknown connection "${capability.connectionId}"`
        )
      }
    }

    const supportedCapabilityPlatforms = capability.supportedPlatforms ?? []
    if (
      !Array.isArray(supportedCapabilityPlatforms) ||
      supportedCapabilityPlatforms.some(
        (platform) => platform !== "darwin" && platform !== "linux" && platform !== "win32"
      )
    ) {
      throw new Error(
        `Native extension "${manifest.name}" aiCapability.supportedPlatforms must contain supported platform names`
      )
    }
    if (new Set(supportedCapabilityPlatforms).size !== supportedCapabilityPlatforms.length) {
      throw new Error(
        `Native extension "${manifest.name}" declares duplicate aiCapability supported platforms`
      )
    }

    if (capability.mention) {
      if (capability.mention.value !== undefined && !capability.mention.value.trim()) {
        throw new Error(
          `Native extension "${manifest.name}" aiCapability.mention value must be non-empty when declared`
        )
      }

      if (capability.mention.label !== undefined) {
        assertNonEmptyLocalizedText(
          capability.mention.label,
          `Native extension "${manifest.name}" aiCapability.mention label must be non-empty when declared`
        )
      }
    }

    const declaredToolNames = new Set(capability.toolNames)
    for (const [toolName, display] of Object.entries(capability.toolDisplays ?? {})) {
      if (!declaredToolNames.has(toolName)) {
        throw new Error(
          `Native extension "${manifest.name}" aiCapability.toolDisplays declares unknown tool "${toolName}"`
        )
      }

      assertNonEmptyLocalizedText(
        display.title,
        `Native extension "${manifest.name}" aiCapability.toolDisplays.${toolName}.title must be non-empty`
      )
      assertNonEmptyLocalizedText(
        display.description,
        `Native extension "${manifest.name}" aiCapability.toolDisplays.${toolName}.description must be non-empty`
      )
    }
  }

  validatePreferenceSchemas({
    manifestName: manifest.name,
    preferences: manifest.preferences,
    reservedSecretNames: connectionSecretNames,
    scope: "extension"
  })
  validateNativeExtensionIcon(manifest.name, "package", manifest.icon)

  const commandNames = new Set<string>()
  for (const command of manifest.commands) {
    if (commandNames.has(command.name)) {
      throw new Error(
        `Native extension "${manifest.name}" declares duplicate command "${command.name}"`
      )
    }

    commandNames.add(command.name)
    validatePreferenceSchemas({
      manifestName: manifest.name,
      preferences: command.preferences,
      reservedSecretNames: connectionSecretNames,
      scope: `command "${command.name}"`
    })
    validateNativeExtensionIcon(manifest.name, `command "${command.name}"`, command.icon)

    if (command.runtime && command.mode === "view" && !command.runtime.viewport) {
      throw new Error(
        `Native extension "${manifest.name}" runtime view command "${command.name}" must declare viewport metadata`
      )
    }
  }

  const defaultCommandName = manifest.defaultCommandName ?? manifest.commands[0]?.name
  if (
    manifest.commands.length > 0 &&
    (!defaultCommandName || !commandNames.has(defaultCommandName))
  ) {
    throw new Error(
      `Native extension "${manifest.name}" default command "${defaultCommandName}" is not declared`
    )
  }

  const capabilitySet = new Set(manifest.capabilities)
  if (capabilitySet.size !== manifest.capabilities.length) {
    throw new Error(`Native extension "${manifest.name}" declares duplicate capabilities`)
  }

  const rpcMethods = manifest.rpcMethods ?? []
  const rpcMethodSet = new Set(rpcMethods)
  if (rpcMethodSet.size !== rpcMethods.length) {
    throw new Error(`Native extension "${manifest.name}" declares duplicate RPC methods`)
  }

  const runtimeCapabilities = manifest.runtimeCapabilities ?? []
  const runtimeCapabilitySet = new Set(runtimeCapabilities)
  if (runtimeCapabilitySet.size !== runtimeCapabilities.length) {
    throw new Error(`Native extension "${manifest.name}" declares duplicate runtime capabilities`)
  }
  validateRuntimeShellManifest(manifest.name, manifest.runtimeShell, runtimeCapabilities)

  const supportedPlatforms = manifest.supportedPlatforms ?? []
  if (new Set(supportedPlatforms).size !== supportedPlatforms.length) {
    throw new Error(`Native extension "${manifest.name}" declares duplicate supported platforms`)
  }
}

export function supportsNativeExtensionPlatform(
  manifest: NativeExtensionPackageManifest,
  platform: string
): boolean {
  return supportsNativeExtensionPlatformList(manifest.supportedPlatforms, platform)
}

export function supportsNativeExtensionPlatformList(
  supportedPlatforms: readonly NativeExtensionSupportedPlatform[] | undefined,
  platform: string
): boolean {
  if (!supportedPlatforms || supportedPlatforms.length === 0) {
    return true
  }

  return supportedPlatforms.includes(platform as NativeExtensionSupportedPlatform)
}

export function toLauncherCommandOwnerManifest(
  manifest: NativeExtensionPackageManifest
): LauncherCommandOwnerManifest {
  const launcherCommands = manifest.commands.filter(
    (command): command is NativeExtensionCommandManifest<string> & { mode: LauncherCommandMode } =>
      command.mode === "view" || command.mode === "no-view"
  )
  const defaultLauncherCommandName =
    launcherCommands.find((command) => command.name === manifest.defaultCommandName)?.name ??
    launcherCommands[0]?.name

  if (!defaultLauncherCommandName) {
    throw new Error(
      `Native extension "${manifest.name}" does not declare any launcher commands for root search`
    )
  }

  return {
    capabilities: manifest.capabilities,
    commands: launcherCommands.map((command) => ({
      description: command.description,
      icon: command.icon ?? manifest.icon,
      iconName: command.iconName ?? manifest.iconName,
      keywords: command.keywords,
      mode: command.mode,
      name: command.name,
      title: command.title
    })),
    defaultCommandName: defaultLauncherCommandName,
    displayName: manifest.title,
    icon: manifest.icon,
    id: manifest.name,
    rpcMethods: manifest.rpcMethods
  }
}

export function toInstalledNativeExtensionSettingsSchema(
  manifest: NativeExtensionPackageManifest
): InstalledNativeExtensionSettingsSchema {
  return {
    commands: manifest.commands.map((command) => ({
      description: command.description ?? "",
      icon: command.icon ?? manifest.icon,
      iconName: command.iconName ?? manifest.iconName,
      keywords: command.keywords,
      mode: command.mode,
      name: command.name,
      preferences: command.preferences ?? [],
      title: command.title ?? command.name
    })),
    connection: manifest.connection,
    description: manifest.description ?? "",
    extName: manifest.name,
    icon: manifest.icon,
    iconName: manifest.iconName,
    preferences: manifest.preferences ?? [],
    title: manifest.title
  }
}
