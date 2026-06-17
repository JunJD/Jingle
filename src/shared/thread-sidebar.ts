export const THREAD_PINNED_METADATA_KEY = "pinned"

export function isThreadPinned(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.[THREAD_PINNED_METADATA_KEY] === true
}
