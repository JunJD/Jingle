import type { ClipboardPayloadKind } from "./clipboard"

export type LauncherPluginRuntime = "external-webview" | "internal-react"

export type LauncherPluginCapability = "clipboard" | "navigation" | "rpc" | "surface" | "threads"

export interface LauncherPluginClipboardManifest {
  accepts: ClipboardPayloadKind[]
}

export interface LauncherPluginEntryManifest<TEntryId extends string = string> {
  id: TEntryId
}

export interface LauncherPluginManifest<
  TPluginId extends string = string,
  TEntryId extends string = string
> {
  capabilities: LauncherPluginCapability[]
  clipboard?: LauncherPluginClipboardManifest
  defaultEntryId: TEntryId
  displayName: string
  entries: Array<LauncherPluginEntryManifest<TEntryId>>
  id: TPluginId
  rpcMethods?: string[]
  runtime: LauncherPluginRuntime
}

export function hasLauncherPluginCapability(
  manifest: LauncherPluginManifest,
  capability: LauncherPluginCapability
): boolean {
  return manifest.capabilities.includes(capability)
}

export function validateLauncherPluginManifest(manifest: LauncherPluginManifest): void {
  const capabilitySet = new Set(manifest.capabilities)
  const entryIdSet = new Set<string>()
  const rpcMethods = manifest.rpcMethods ?? []
  const rpcMethodSet = new Set(rpcMethods)

  if (capabilitySet.size !== manifest.capabilities.length) {
    throw new Error(`Launcher plugin "${manifest.id}" declares duplicate capabilities`)
  }

  for (const entry of manifest.entries) {
    if (entryIdSet.has(entry.id)) {
      throw new Error(`Launcher plugin "${manifest.id}" declares duplicate entry "${entry.id}"`)
    }

    entryIdSet.add(entry.id)
  }

  if (!entryIdSet.has(manifest.defaultEntryId)) {
    throw new Error(
      `Launcher plugin "${manifest.id}" default entry "${manifest.defaultEntryId}" is not declared in its manifest`
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
