export type LauncherPluginRuntime = "external-webview" | "internal-react"

export type LauncherPluginCapability = "clipboard" | "navigation" | "surface" | "threads"

export interface LauncherPluginEntryManifest<TEntryId extends string = string> {
  id: TEntryId
}

export interface LauncherPluginManifest<
  TPluginId extends string = string,
  TEntryId extends string = string
> {
  capabilities: LauncherPluginCapability[]
  defaultEntryId: TEntryId
  displayName: string
  entries: Array<LauncherPluginEntryManifest<TEntryId>>
  id: TPluginId
  rpcMethods?: string[]
  runtime: LauncherPluginRuntime
}
