export async function selectWorkspaceFolder(
  currentThreadId: string | null,
  setWorkspacePath: (path: string | null) => void,
  setLoading: (loading: boolean) => void,
  setOpen?: (open: boolean) => void,
  options?: {
    onBlockedByPendingWorkspaceMemory?: () => void
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
      setWorkspacePath(path)
    }
    if (setOpen) setOpen(false)
  } catch (e) {
    console.error("[WorkspacePicker] Select folder error:", e)
  } finally {
    setLoading(false)
  }
}
