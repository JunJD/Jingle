export const PERMISSION_MODE_NAMES = ["explore", "ask-to-edit", "auto"] as const

export type PermissionModeName = (typeof PERMISSION_MODE_NAMES)[number]

export const DEFAULT_PERMISSION_MODE: PermissionModeName = "ask-to-edit"
export const THREAD_PERMISSION_MODE_METADATA_KEY = "permissionMode"
export const RUN_PERMISSION_MODE_SNAPSHOT_METADATA_KEY = "permissionModeSnapshot"

export function isPermissionModeName(value: unknown): value is PermissionModeName {
  return value === "explore" || value === "ask-to-edit" || value === "auto"
}
