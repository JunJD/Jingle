import { selectWorkspaceFolder } from "@/lib/workspace-utils"
import { Check, ChevronDown, Folder } from "lucide-react"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useThreadActions, useThreadSelector } from "@/lib/thread-context"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"

interface WorkspacePickerProps {
  threadId: string
}

export function WorkspacePicker({ threadId }: WorkspacePickerProps): React.JSX.Element {
  const { copy } = useI18n()
  const workspacePath = useThreadSelector(threadId, (state) => state?.agent.workspacePath ?? null)
  const threadActions = useThreadActions(threadId)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null)

  // Load workspace path for current thread. File discovery is no longer implicit.
  useEffect(() => {
    async function loadWorkspace(): Promise<void> {
      if (threadId) {
        const path = await window.api.workspace.get(threadId)
        threadActions?.setWorkspacePath(path)
      }
    }
    loadWorkspace()
  }, [threadActions, threadId])

  async function handleSelectFolder(): Promise<void> {
    setBlockedMessage(null)
    await selectWorkspaceFolder(
      threadId,
      (path) => threadActions?.setWorkspacePath(path),
      setLoading,
      setOpen,
      {
        onBlockedByPendingWorkspaceMemory: () => {
          setBlockedMessage(copy.chat.pendingWorkspaceMemoryBlocksWorkspaceChange)
        }
      }
    )
  }

  const folderName = workspacePath?.split("/").pop()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          data-workspace-picker-trigger=""
          data-workspace-picker-path={workspacePath ?? ""}
          data-workspace-picker-thread-id={threadId}
          className={cn(
            "h-[var(--ow-control-h-md)] gap-[var(--ow-space-1-5)] rounded-full bg-background-secondary px-[var(--ow-space-3)] [font-size:var(--ow-font-meta)] hover:bg-background-interactive",
            workspacePath ? "text-foreground" : "text-status-warning"
          )}
          disabled={!threadId}
        >
          <Folder className="size-[var(--ow-icon-sm)]" />
          <span
            className="max-w-[var(--ow-chip-label-max-width)] truncate"
            data-workspace-picker-label=""
          >
            {workspacePath ? folderName : copy.workspacePicker.selectWorkspace}
          </span>
          <ChevronDown className="size-[var(--ow-icon-compact)] opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--ow-popover-w-sm)] border-border bg-popover p-[var(--ow-space-3)]"
        align="start"
      >
        <div className="space-y-[var(--ow-space-3)]">
          <div className="[font-size:var(--ow-font-meta)] font-medium uppercase tracking-wider text-muted-foreground">
            {copy.workspacePicker.title}
          </div>

          {workspacePath ? (
            <div className="space-y-[var(--ow-space-2)]">
              {blockedMessage ? (
                <div className="rounded-[var(--ow-radius-md)] border border-status-warning/40 bg-status-warning/10 px-[var(--ow-space-2)] py-[var(--ow-space-2)] [font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-status-warning">
                  {blockedMessage}
                </div>
              ) : null}
              <div className="flex items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-panel)] border border-border bg-background-secondary p-[var(--ow-space-2)]">
                <Check className="size-[var(--ow-icon-sm)] text-status-nominal shrink-0" />
                <span
                  className="flex-1 truncate [font-size:var(--ow-font-body)]"
                  title={workspacePath}
                >
                  {folderName}
                </span>
              </div>
              <p className="[font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-muted-foreground">
                {copy.workspacePicker.linkedHint}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-[var(--ow-control-h-md)] w-full [font-size:var(--ow-font-meta)]"
                onClick={handleSelectFolder}
                disabled={loading}
              >
                {copy.workspacePicker.changeFolder}
              </Button>
            </div>
          ) : (
            <div className="space-y-[var(--ow-space-2)]">
              {blockedMessage ? (
                <div className="rounded-[var(--ow-radius-md)] border border-status-warning/40 bg-status-warning/10 px-[var(--ow-space-2)] py-[var(--ow-space-2)] [font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-status-warning">
                  {blockedMessage}
                </div>
              ) : null}
              <p className="[font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-muted-foreground">
                {copy.workspacePicker.selectHint}
              </p>
              <Button
                variant="default"
                size="sm"
                className="h-[var(--ow-control-h-md)] w-full [font-size:var(--ow-font-meta)]"
                onClick={handleSelectFolder}
                disabled={loading}
              >
                <Folder className="size-[var(--ow-icon-sm)] mr-[var(--ow-space-1-5)]" />
                {copy.workspacePicker.selectFolder}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
