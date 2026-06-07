export async function selectWorkspaceFolder(
  currentThreadId: string | null,
  refreshThreadData: (threadId: string) => Promise<void>,
  setLoading: (loading: boolean) => void,
  setOpen?: (open: boolean) => void,
  options?: {
    onBlockedByPendingWorkspaceMemory?: () => void
    onError?: (error: string) => void
  }
): Promise<void> {
  if (!currentThreadId) return
  setLoading(true)
  try {
    const guard = await window.api.memory.getPendingWorkspaceMemoryGuard(currentThreadId)
    if (guard.hasPendingWorkspaceSuggestions) {
      options?.onBlockedByPendingWorkspaceMemory?.()
      return
    }

    const path = await window.api.workspace.select(currentThreadId)
    if (path) {
      await refreshThreadData(currentThreadId)
    }
    if (setOpen) setOpen(false)
  } catch (e) {
    console.error("[WorkspacePicker] Select folder error:", e)
    options?.onError?.(e instanceof Error ? e.message : String(e))
  } finally {
    setLoading(false)
  }
}
