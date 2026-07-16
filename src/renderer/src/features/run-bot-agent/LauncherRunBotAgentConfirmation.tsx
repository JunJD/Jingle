import { Check, Folder, FolderPlus, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { RunBotAgentConfirmationProjection } from "./use-run-bot-agent-confirmation-controller"

export interface LauncherRunBotAgentConfirmationProps {
  onAddProject: () => Promise<void>
  onCancel: () => void
  onConfirm: () => void
  onSelectProject: (projectId: string) => void
  projection: RunBotAgentConfirmationProjection | null
}

export function LauncherRunBotAgentConfirmation(
  props: LauncherRunBotAgentConfirmationProps
): React.JSX.Element {
  const { onAddProject, onCancel, onConfirm, onSelectProject, projection } = props
  const { copy } = useI18n()

  return (
    <Dialog
      open={projection !== null}
      onOpenChange={(open) => {
        if (!open) {
          onCancel()
        }
      }}
    >
      <DialogContent className="w-[var(--jingle-dialog-mobile-w)] gap-[var(--jingle-space-3)] p-[var(--jingle-space-4)] sm:max-w-[440px]">
        <DialogHeader className="space-y-[var(--jingle-space-1)] pr-[var(--jingle-space-5)]">
          <DialogTitle>{copy.runBotAgent.title}</DialogTitle>
          <DialogDescription className="truncate" title={projection?.title}>
            {projection?.title}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-[var(--jingle-space-2)] [font-size:var(--jingle-font-meta)]">
          {projection?.source ? (
            <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-[var(--jingle-space-2)]">
              <span className="text-muted-foreground">{copy.runBotAgent.source}</span>
              <span className="truncate" title={projection.source.title}>
                {projection.source.label}
              </span>
            </div>
          ) : null}
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-[var(--jingle-space-2)]">
            <span className="text-muted-foreground">{copy.runBotAgent.status}</span>
            <span>{projection?.statusLabel}</span>
          </div>
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-[var(--jingle-space-2)]">
            <span className="text-muted-foreground">{copy.runBotAgent.labels}</span>
            <div className="flex min-w-0 flex-wrap gap-[var(--jingle-space-1)]">
              {projection?.labels.length ? (
                projection.labels.map((label) => (
                  <span
                    key={label.id}
                    className="max-w-full truncate rounded-[var(--jingle-radius-xs)] bg-background-secondary px-[var(--jingle-space-1-5)] py-px"
                  >
                    {label.text}
                  </span>
                ))
              ) : (
                <span className="text-muted-foreground">{copy.runBotAgent.noLabels}</span>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-[var(--jingle-space-2)]">
          <div className="flex items-center justify-between gap-[var(--jingle-space-2)]">
            <span className="[font-size:var(--jingle-font-meta)] font-medium">
              {copy.runBotAgent.project}
            </span>
            <Button
              className="h-[var(--jingle-control-h-compact)] gap-[var(--jingle-space-1)] px-[var(--jingle-space-2)] [font-size:var(--jingle-font-meta)]"
              disabled={projection?.isAddingProject}
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => {
                void onAddProject()
              }}
            >
              {projection?.isAddingProject ? (
                <LoaderCircle className="size-[var(--jingle-icon-xs)] animate-spin" />
              ) : (
                <FolderPlus className="size-[var(--jingle-icon-xs)]" />
              )}
              {copy.runBotAgent.addProject}
            </Button>
          </div>

          <div
            aria-busy={projection?.isLoadingProjects || undefined}
            className="max-h-44 space-y-[var(--jingle-space-1)] overflow-y-auto"
          >
            {projection?.isLoadingProjects ? (
              <div
                aria-label={copy.runBotAgent.project}
                className="flex h-16 items-center justify-center text-muted-foreground"
                role="status"
              >
                <LoaderCircle className="size-[var(--jingle-icon-sm)] animate-spin" />
              </div>
            ) : projection?.projects.length ? (
              projection.projects.map((project) => (
                <Button
                  key={project.projectId}
                  aria-pressed={project.selected}
                  className={cn(
                    "flex h-auto w-full items-center gap-[var(--jingle-space-2)] rounded-[var(--jingle-radius-md)] border px-[var(--jingle-space-2)] py-[var(--jingle-space-2)] text-left",
                    project.selected
                      ? "border-foreground/30 bg-background-secondary"
                      : "border-border hover:bg-background-secondary/60"
                  )}
                  type="button"
                  variant="ghost"
                  onClick={() => onSelectProject(project.projectId)}
                >
                  <Folder className="size-[var(--jingle-icon-sm)] shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate [font-size:var(--jingle-font-body)] font-medium">
                      {project.displayName}
                    </span>
                    <span className="block truncate [font-size:var(--jingle-font-meta)] text-muted-foreground">
                      {project.workspacePath}
                    </span>
                  </span>
                  {project.selected ? (
                    <Check className="size-[var(--jingle-icon-sm)] shrink-0" />
                  ) : null}
                </Button>
              ))
            ) : (
              <div className="rounded-[var(--jingle-radius-md)] border border-dashed border-border px-[var(--jingle-space-3)] py-[var(--jingle-space-4)] text-center [font-size:var(--jingle-font-meta)] text-muted-foreground">
                {copy.runBotAgent.noProjects}
              </div>
            )}
          </div>
        </div>

        {projection?.validationErrors.map((message) => (
          <p key={message} className="[font-size:var(--jingle-font-meta)] text-destructive">
            {message}
          </p>
        ))}
        {projection?.error ? (
          <p className="rounded-[var(--jingle-radius-md)] border border-destructive/25 bg-destructive/10 px-[var(--jingle-space-2)] py-[var(--jingle-space-2)] [font-size:var(--jingle-font-meta)] text-destructive">
            {projection.error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {copy.runBotAgent.cancel}
          </Button>
          <Button disabled={!projection?.canConfirm} type="button" onClick={onConfirm}>
            {copy.runBotAgent.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
