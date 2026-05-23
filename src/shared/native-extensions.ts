import type { ExtensionRuntimeHostCapability } from "./extension-runtime-protocol"
import type { ToolCallDisplay } from "./tool-presentation"
import type {
  LauncherCommandMode,
  LauncherCommandOwnerCapability,
  LauncherCommandOwnerManifest
} from "./launcher-command-owner"
import type { ExtensionToolDefinition } from "./extension-sources"
import type { IpcErrorPayload } from "./ipc-error"

export type NativeExtensionCommandMode = "background" | "menu-bar" | "no-view" | "view"
export type NativeExtensionSupportedPlatform = "darwin" | "linux" | "win32"

export interface NativeExtensionPreferenceSchema {
  data?: Array<{ title?: string; value?: string }>
  default?: unknown
  description?: string
  label?: string
  name: string
  placeholder?: string
  required?: boolean
  title?: string
  type?: string
}

export interface NativeExtensionRuntimeCommandManifest {
  viewport?: {
    bodyHeight: number
  }
}

export interface NativeExtensionCommandManifest<TCommandName extends string = string> {
  description?: string
  iconName?: string
  keywords?: string[]
  mode: NativeExtensionCommandMode
  name: TCommandName
  preferences?: NativeExtensionPreferenceSchema[]
  runtime?: NativeExtensionRuntimeCommandManifest
  title?: string
}

export interface NativeExtensionAiCapabilityMentionManifest {
  label?: string
  value?: string
}

export interface NativeExtensionAiCapability {
  description?: string
  guide: string
  id: string
  instructions?: string[]
  mention?: NativeExtensionAiCapabilityMentionManifest
  publicPreferenceNames?: string[]
  requiredPreferenceNames?: string[]
  supportedPlatforms?: NativeExtensionSupportedPlatform[]
  title: string
  toolDisplays?: Record<string, ToolCallDisplay>
  toolNames: string[]
}

export interface NativeExtensionPackageManifest<
  TExtensionName extends string = string,
  TCommandName extends string = string
> {
  aiCapability?: NativeExtensionAiCapability
  capabilities: LauncherCommandOwnerCapability[]
  commands: Array<NativeExtensionCommandManifest<TCommandName>>
  defaultCommandName?: TCommandName
  description?: string
  iconName?: string
  name: TExtensionName
  preferences?: NativeExtensionPreferenceSchema[]
  rpcMethods?: string[]
  runtimeCapabilities?: ExtensionRuntimeHostCapability[]
  supportedPlatforms?: NativeExtensionSupportedPlatform[]
  title: string
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
  extensionPreferences: Record<string, unknown>
}

export interface NativeExtensionMainDefinition {
  service?: NativeExtensionService
  tools?: ExtensionToolDefinition[]
}

export interface NativeExtensionCommandSettingsSchema {
  description: string
  keywords?: string[]
  mode: NativeExtensionCommandMode
  name: string
  preferences: NativeExtensionPreferenceSchema[]
  title: string
}

export interface InstalledNativeExtensionSettingsSchema {
  commands: NativeExtensionCommandSettingsSchema[]
  description: string
  extName: string
  preferences: NativeExtensionPreferenceSchema[]
  title: string
}

export interface NativeExtensionPreferencesState {
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
  preference: NativeExtensionPreferenceSchema
): string {
  return preference.title ?? preference.label ?? preference.name
}

function assertNonEmptyString(value: unknown, message: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
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

export function listMissingRequiredNativeExtensionPreferences(
  schema: NativeExtensionPreferenceSchema[],
  values: Record<string, unknown>
): string[] {
  return schema
    .filter((preference) => preference.required)
    .filter((preference) =>
      isMissingRequiredNativeExtensionPreferenceValue(values[preference.name])
    )
    .map((preference) => getNativeExtensionPreferenceDisplayName(preference))
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

  if (!manifest.title.trim()) {
    throw new Error(`Native extension "${manifest.name}" must declare a non-empty title`)
  }

  if (hasOwnRecordKey(manifest, "ai")) {
    throw new Error(
      `Native extension "${manifest.name}" must declare agent integration through aiCapability, not ai`
    )
  }

  if (manifest.aiCapability) {
    const capability = manifest.aiCapability
    assertNonEmptyString(
      capability.id,
      `Native extension "${manifest.name}" aiCapability.id must be non-empty`
    )
    assertNonEmptyString(
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
    validateOptionalStringArray({
      extensionName: manifest.name,
      fieldName: "aiCapability.requiredPreferenceNames",
      values: capability.requiredPreferenceNames
    })
    validateOptionalStringArray({
      extensionName: manifest.name,
      fieldName: "aiCapability.publicPreferenceNames",
      values: capability.publicPreferenceNames
    })

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

      if (capability.mention.label !== undefined && !capability.mention.label.trim()) {
        throw new Error(
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

      assertNonEmptyString(
        display.title,
        `Native extension "${manifest.name}" aiCapability.toolDisplays.${toolName}.title must be non-empty`
      )
      assertNonEmptyString(
        display.description,
        `Native extension "${manifest.name}" aiCapability.toolDisplays.${toolName}.description must be non-empty`
      )
    }
  }

  const commandNames = new Set<string>()
  for (const command of manifest.commands) {
    if (commandNames.has(command.name)) {
      throw new Error(
        `Native extension "${manifest.name}" declares duplicate command "${command.name}"`
      )
    }

    commandNames.add(command.name)

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
      iconName: command.iconName ?? manifest.iconName,
      keywords: command.keywords,
      mode: command.mode,
      name: command.name,
      title: command.title
    })),
    defaultCommandName: defaultLauncherCommandName,
    displayName: manifest.title,
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
      keywords: command.keywords,
      mode: command.mode,
      name: command.name,
      preferences: command.preferences ?? [],
      title: command.title ?? command.name
    })),
    description: manifest.description ?? "",
    extName: manifest.name,
    preferences: manifest.preferences ?? [],
    title: manifest.title
  }
}
