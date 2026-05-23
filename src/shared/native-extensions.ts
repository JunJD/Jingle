import type { ExtensionRuntimeHostCapability } from "./extension-runtime-protocol"
import type {
  LauncherCommandMode,
  LauncherCommandOwnerCapability,
  LauncherCommandOwnerManifest
} from "./launcher-command-owner"
import type { ExtensionToolDefinition } from "./extension-sources"
import type { IpcErrorPayload } from "./ipc-error"

export type NativeExtensionCommandMode = "background" | "menu-bar" | "no-view" | "view"
export type NativeExtensionIcon = string
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
  /** Extension-package-relative asset path, for example "assets/icon.svg". */
  icon?: NativeExtensionIcon
  iconName?: string
  keywords?: string[]
  mode: NativeExtensionCommandMode
  name: TCommandName
  preferences?: NativeExtensionPreferenceSchema[]
  runtime?: NativeExtensionRuntimeCommandManifest
  title?: string
}

export interface NativeExtensionPackageManifest<
  TExtensionName extends string = string,
  TCommandName extends string = string
> {
  capabilities: LauncherCommandOwnerCapability[]
  commands: Array<NativeExtensionCommandManifest<TCommandName>>
  defaultCommandName?: TCommandName
  description?: string
  /** Extension-package-relative asset path, for example "assets/icon.svg". */
  icon?: NativeExtensionIcon
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
  icon?: NativeExtensionIcon
  iconName?: string
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
  icon?: NativeExtensionIcon
  iconName?: string
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

function getNativeExtensionPreferenceDisplayName(
  preference: NativeExtensionPreferenceSchema
): string {
  return preference.title ?? preference.label ?? preference.name
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

  if (manifest.commands.length === 0) {
    throw new Error(`Native extension "${manifest.name}" must declare at least one command`)
  }

  validateNativeExtensionIcon(manifest.name, "package", manifest.icon)

  const commandNames = new Set<string>()
  for (const command of manifest.commands) {
    if (commandNames.has(command.name)) {
      throw new Error(
        `Native extension "${manifest.name}" declares duplicate command "${command.name}"`
      )
    }

    commandNames.add(command.name)
    validateNativeExtensionIcon(manifest.name, `command "${command.name}"`, command.icon)

    if (command.runtime && command.mode === "view" && !command.runtime.viewport) {
      throw new Error(
        `Native extension "${manifest.name}" runtime view command "${command.name}" must declare viewport metadata`
      )
    }
  }

  const defaultCommandName = manifest.defaultCommandName ?? manifest.commands[0]?.name
  if (!defaultCommandName || !commandNames.has(defaultCommandName)) {
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
  const supportedPlatforms = manifest.supportedPlatforms
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
    description: manifest.description ?? "",
    extName: manifest.name,
    icon: manifest.icon,
    iconName: manifest.iconName,
    preferences: manifest.preferences ?? [],
    title: manifest.title
  }
}
