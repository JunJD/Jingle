import {
  DEFAULT_PERMISSION_MODE,
  isPermissionModeName,
  RUN_PERMISSION_MODE_SNAPSHOT_METADATA_KEY,
  THREAD_PERMISSION_MODE_METADATA_KEY,
  type PermissionModeName
} from "@shared/permission-mode"
import type { RunRow, ThreadRow } from "../db"

export { RUN_PERMISSION_MODE_SNAPSHOT_METADATA_KEY, THREAD_PERMISSION_MODE_METADATA_KEY }

function parseMetadata(value: string | null | undefined): Record<string, unknown> {
  if (!value) {
    return {}
  }

  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function readThreadPermissionMode(
  thread: Pick<ThreadRow, "metadata"> | null
): PermissionModeName {
  const metadata = parseMetadata(thread?.metadata)
  const value = metadata[THREAD_PERMISSION_MODE_METADATA_KEY]
  return isPermissionModeName(value) ? value : DEFAULT_PERMISSION_MODE
}

export function readRunPermissionModeSnapshot(
  run: Pick<RunRow, "metadata"> | null
): PermissionModeName {
  const metadata = parseMetadata(run?.metadata)
  const value = metadata[RUN_PERMISSION_MODE_SNAPSHOT_METADATA_KEY]
  return isPermissionModeName(value) ? value : DEFAULT_PERMISSION_MODE
}

export function mergeThreadPermissionModeMetadata(
  thread: Pick<ThreadRow, "metadata"> | null,
  permissionMode: PermissionModeName
): Record<string, unknown> {
  return {
    ...parseMetadata(thread?.metadata),
    [THREAD_PERMISSION_MODE_METADATA_KEY]: permissionMode
  }
}

export function mergeRunMetadata(
  run: Pick<RunRow, "metadata"> | null,
  updates: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...parseMetadata(run?.metadata),
    ...updates
  }
}
