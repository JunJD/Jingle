import { LAUNCHER_COMMAND_IDS, type LauncherCommandId } from "./ids"

export const CONFIGURABLE_SHORTCUT_COMMAND_IDS = [
  LAUNCHER_COMMAND_IDS.toggle
] as const satisfies readonly LauncherCommandId[]

const configurableShortcutCommandIdSet = new Set<string>(CONFIGURABLE_SHORTCUT_COMMAND_IDS)

export function listConfigurableShortcutCommandIds(): readonly LauncherCommandId[] {
  return CONFIGURABLE_SHORTCUT_COMMAND_IDS
}

export function isShortcutCommandConfigurable(commandId: string): boolean {
  return configurableShortcutCommandIdSet.has(commandId)
}
