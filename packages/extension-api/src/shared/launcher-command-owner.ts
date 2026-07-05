import type { ClipboardPayloadKind } from "./clipboard"
import type { LocalizedTextValue } from "./i18n"

export type LauncherCommandOwnerCapability =
  | "clipboard"
  | "navigation"
  | "rpc"
  | "surface"
  | "threads"

export type LauncherCommandMode = "view" | "no-view"

export interface LauncherCommandOwnerClipboardManifest {
  accepts: ClipboardPayloadKind[]
}

export interface LauncherCommandArgumentManifest {
  data?: Array<{ title?: LocalizedTextValue; value?: string }>
  name: string
  placeholder?: LocalizedTextValue
  required?: boolean
  title?: LocalizedTextValue
  type?: string
}

export interface LauncherCommandManifest<TCommandName extends string = string> {
  arguments?: LauncherCommandArgumentManifest[]
  description?: LocalizedTextValue
  icon?: string
  iconName?: string
  keywords?: string[]
  mode: LauncherCommandMode
  name: TCommandName
  requiresLauncherArguments?: boolean
  title?: LocalizedTextValue
}

export interface LauncherCommandOwnerManifest<
  TOwnerId extends string = string,
  TCommandName extends string = string
> {
  capabilities: LauncherCommandOwnerCapability[]
  clipboard?: LauncherCommandOwnerClipboardManifest
  commands: Array<LauncherCommandManifest<TCommandName>>
  defaultCommandName: TCommandName
  displayName: LocalizedTextValue
  icon?: string
  id: TOwnerId
  rpcMethods?: string[]
}

export function hasLauncherCommandOwnerCapability(
  manifest: LauncherCommandOwnerManifest,
  capability: LauncherCommandOwnerCapability
): boolean {
  return manifest.capabilities.includes(capability)
}

export function validateLauncherCommandOwnerManifest(manifest: LauncherCommandOwnerManifest): void {
  const capabilitySet = new Set(manifest.capabilities)
  const commandNameSet = new Set<string>()
  const rpcMethods = manifest.rpcMethods ?? []
  const rpcMethodSet = new Set(rpcMethods)

  if (capabilitySet.size !== manifest.capabilities.length) {
    throw new Error(`Launcher command owner "${manifest.id}" declares duplicate capabilities`)
  }

  for (const command of manifest.commands) {
    if (commandNameSet.has(command.name)) {
      throw new Error(
        `Launcher command owner "${manifest.id}" declares duplicate command "${command.name}"`
      )
    }

    commandNameSet.add(command.name)

    if (command.requiresLauncherArguments && !command.arguments?.length) {
      throw new Error(
        `Launcher command owner "${manifest.id}" command "${command.name}" requires launcher arguments without declaring any argument schema`
      )
    }
  }

  if (!commandNameSet.has(manifest.defaultCommandName)) {
    throw new Error(
      `Launcher command owner "${manifest.id}" default command "${manifest.defaultCommandName}" is not declared in its manifest`
    )
  }

  if (rpcMethodSet.size !== rpcMethods.length) {
    throw new Error(`Launcher command owner "${manifest.id}" declares duplicate RPC methods`)
  }

  if (rpcMethods.length > 0 && !hasLauncherCommandOwnerCapability(manifest, "rpc")) {
    throw new Error(
      `Launcher command owner "${manifest.id}" declares RPC methods without the "rpc" capability`
    )
  }

  if (hasLauncherCommandOwnerCapability(manifest, "rpc") && rpcMethods.length === 0) {
    throw new Error(
      `Launcher command owner "${manifest.id}" declares the "rpc" capability without any RPC methods`
    )
  }

  if (manifest.clipboard && !hasLauncherCommandOwnerCapability(manifest, "clipboard")) {
    throw new Error(
      `Launcher command owner "${manifest.id}" declares clipboard filters without the "clipboard" capability`
    )
  }
}
