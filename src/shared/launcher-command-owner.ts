import type {
  LauncherPluginCapability as CommandOwnerCapability,
  LauncherPluginCommandManifest as CommandManifest,
  LauncherPluginCommandMode as CommandMode,
  LauncherPluginManifest as CommandOwnerManifest
} from "./launcher-plugin"
import { validateLauncherPluginManifest } from "./launcher-plugin"

export type LauncherCommandOwnerCapability = CommandOwnerCapability
export type LauncherCommandMode = CommandMode
export type LauncherCommandManifest<TCommandName extends string = string> =
  CommandManifest<TCommandName>
export type LauncherCommandOwnerManifest<
  TOwnerId extends string = string,
  TCommandName extends string = string
> = CommandOwnerManifest<TOwnerId, TCommandName>

export function validateLauncherCommandOwnerManifest(
  manifest: LauncherCommandOwnerManifest
): void {
  validateLauncherPluginManifest(manifest)
}
