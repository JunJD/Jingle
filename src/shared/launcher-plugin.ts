import type { ClipboardPayloadKind } from "./clipboard"

export type LauncherPluginCapability = "clipboard" | "navigation" | "rpc" | "surface" | "threads"
export type LauncherPluginCommandMode = "view" | "no-view"

export interface LauncherPluginClipboardManifest {
  accepts: ClipboardPayloadKind[]
}

export interface LauncherPluginCommandManifest<TCommandName extends string = string> {
  description?: string
  keywords?: string[]
  mode: LauncherPluginCommandMode
  name: TCommandName
  title?: string
}

export interface LauncherPluginManifest<
  TPluginId extends string = string,
  TCommandName extends string = string
> {
  capabilities: LauncherPluginCapability[]
  clipboard?: LauncherPluginClipboardManifest
  commands: Array<LauncherPluginCommandManifest<TCommandName>>
  defaultCommandName: TCommandName
  displayName: string
  id: TPluginId
  rpcMethods?: string[]
}

export function hasLauncherPluginCapability(
  manifest: LauncherPluginManifest,
  capability: LauncherPluginCapability
): boolean {
  return manifest.capabilities.includes(capability)
}

export function validateLauncherPluginManifest(manifest: LauncherPluginManifest): void {
  const capabilitySet = new Set(manifest.capabilities)
  const commandNameSet = new Set<string>()
  const rpcMethods = manifest.rpcMethods ?? []
  const rpcMethodSet = new Set(rpcMethods)

  if (capabilitySet.size !== manifest.capabilities.length) {
    throw new Error(`Launcher plugin "${manifest.id}" declares duplicate capabilities`)
  }

  for (const command of manifest.commands) {
    if (commandNameSet.has(command.name)) {
      throw new Error(
        `Launcher plugin "${manifest.id}" declares duplicate command "${command.name}"`
      )
    }

    commandNameSet.add(command.name)
  }

  if (!commandNameSet.has(manifest.defaultCommandName)) {
    throw new Error(
      `Launcher plugin "${manifest.id}" default command "${manifest.defaultCommandName}" is not declared in its manifest`
    )
  }

  if (rpcMethodSet.size !== rpcMethods.length) {
    throw new Error(`Launcher plugin "${manifest.id}" declares duplicate RPC methods`)
  }

  if (rpcMethods.length > 0 && !hasLauncherPluginCapability(manifest, "rpc")) {
    throw new Error(
      `Launcher plugin "${manifest.id}" declares RPC methods without the "rpc" capability`
    )
  }

  if (hasLauncherPluginCapability(manifest, "rpc") && rpcMethods.length === 0) {
    throw new Error(
      `Launcher plugin "${manifest.id}" declares the "rpc" capability without any RPC methods`
    )
  }

  if (manifest.clipboard && !hasLauncherPluginCapability(manifest, "clipboard")) {
    throw new Error(
      `Launcher plugin "${manifest.id}" declares clipboard filters without the "clipboard" capability`
    )
  }
}
