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
  const workspacePath = useThreadSelector(threadId, (state) => state?.workspacePath ?? null)
  const threadActions = useThreadActions(threadId)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  // Load workspace path for current thread. File discovery is no longer implicit.
  useEffect(() => {
    async function loadWorkspace(): Promise<void> {
      if (threadId) {
        const path = await window.api.workspace.get(threadId)
        threadActions?.setWorkspacePath(path)
      }
    }
    loadWorkspace()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadActions, threadId])

  async function handleSelectFolder(): Promise<void> {
    await selectWorkspaceFolder(
      threadId,
      (path) => threadActions?.setWorkspacePath(path),
      setLoading,
      setOpen
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
            "h-8 gap-1.5 rounded-full bg-background-secondary px-3 text-xs hover:bg-background-interactive",
            workspacePath ? "text-foreground" : "text-status-warning"
          )}
          disabled={!threadId}
        >
          <Folder className="size-3.5" />
          <span className="max-w-[120px] truncate" data-workspace-picker-label="">
            {workspacePath ? folderName : copy.workspacePicker.selectWorkspace}
          </span>
          <ChevronDown className="size-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 border-border bg-popover p-3" align="start">
        <div className="space-y-3">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {copy.workspacePicker.title}
          </div>

          {workspacePath ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-[12px] border border-border bg-background-secondary p-2">
                <Check className="size-3.5 text-status-nominal shrink-0" />
                <span className="text-sm truncate flex-1" title={workspacePath}>
                  {folderName}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {copy.workspacePicker.linkedHint}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full h-8 text-xs"
                onClick={handleSelectFolder}
                disabled={loading}
              >
                {copy.workspacePicker.changeFolder}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {copy.workspacePicker.selectHint}
              </p>
              <Button
                variant="default"
                size="sm"
                className="w-full h-8 text-xs"
                onClick={handleSelectFolder}
                disabled={loading}
              >
                <Folder className="size-3.5 mr-1.5" />
                {copy.workspacePicker.selectFolder}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
