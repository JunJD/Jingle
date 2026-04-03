import type {
  LauncherPluginCapability,
  LauncherPluginCommandMode,
  LauncherPluginManifest
} from "./launcher-plugin"

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

export interface NativeExtensionCommandManifest<TCommandName extends string = string> {
  description?: string
  keywords?: string[]
  mode: LauncherPluginCommandMode
  name: TCommandName
  preferences?: NativeExtensionPreferenceSchema[]
  title?: string
}

export interface NativeExtensionPackageManifest<
  TExtensionName extends string = string,
  TCommandName extends string = string
> {
  capabilities: LauncherPluginCapability[]
  commands: Array<NativeExtensionCommandManifest<TCommandName>>
  defaultCommandName?: TCommandName
  description?: string
  name: TExtensionName
  preferences?: NativeExtensionPreferenceSchema[]
  rpcMethods?: string[]
  title: string
}

export interface NativeExtensionCommandModuleReference<TCommandName extends string = string> {
  modulePath: `./src/${string}`
  name: TCommandName
}

export interface NativeExtensionDefinition<
  TExtensionName extends string = string,
  TCommandName extends string = string
> {
  commands: Array<NativeExtensionCommandModuleReference<TCommandName>>
  manifest: NativeExtensionPackageManifest<TExtensionName, TCommandName>
  serviceModulePath?: `./main/${string}`
}

export interface NativeExtensionCommandSettingsSchema {
  description: string
  keywords?: string[]
  mode: LauncherPluginCommandMode
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

export interface NativeExtensionInvokeRequest<TPayload = unknown> {
  extensionName: string
  method: string
  payload: TPayload
}

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

export function defineNativeExtension(
  definition: NativeExtensionDefinition
): NativeExtensionDefinition {
  validateNativeExtensionDefinition(definition)
  return definition
}

export function defineNativeExtensionManifest(manifest: unknown): NativeExtensionPackageManifest {
  const resolvedManifest = manifest as NativeExtensionPackageManifest
  validateNativeExtensionPackageManifest(resolvedManifest)
  return resolvedManifest
}

export function validateNativeExtensionDefinition(definition: NativeExtensionDefinition): void {
  validateNativeExtensionPackageManifest(definition.manifest)

  const manifestCommandNames = new Set(definition.manifest.commands.map((command) => command.name))
  const commandModuleNames = new Set<string>()

  for (const command of definition.commands) {
    if (commandModuleNames.has(command.name)) {
      throw new Error(
        `Native extension "${definition.manifest.name}" declares duplicate command module "${command.name}"`
      )
    }

    if (!manifestCommandNames.has(command.name)) {
      throw new Error(
        `Native extension "${definition.manifest.name}" command module "${command.name}" is missing from its manifest`
      )
    }

    commandModuleNames.add(command.name)
  }

  if (commandModuleNames.size !== manifestCommandNames.size) {
    throw new Error(
      `Native extension "${definition.manifest.name}" manifest and command modules are out of sync`
    )
  }

  const rpcMethods = definition.manifest.rpcMethods ?? []
  if (rpcMethods.length > 0 && !definition.serviceModulePath) {
    throw new Error(
      `Native extension "${definition.manifest.name}" declares RPC methods without a service module`
    )
  }

  if (rpcMethods.length === 0 && definition.serviceModulePath) {
    throw new Error(
      `Native extension "${definition.manifest.name}" declares a service module without any RPC methods`
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

  const commandNames = new Set<string>()
  for (const command of manifest.commands) {
    if (commandNames.has(command.name)) {
      throw new Error(
        `Native extension "${manifest.name}" declares duplicate command "${command.name}"`
      )
    }

    commandNames.add(command.name)
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
}

export function toLauncherPluginManifest(
  manifest: NativeExtensionPackageManifest
): LauncherPluginManifest {
  validateNativeExtensionPackageManifest(manifest)

  return {
    capabilities: manifest.capabilities,
    commands: manifest.commands.map((command) => ({
      description: command.description,
      keywords: command.keywords,
      mode: command.mode,
      name: command.name,
      title: command.title
    })),
    defaultCommandName: manifest.defaultCommandName ?? manifest.commands[0]!.name,
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
