import { useEffect, useMemo, type ReactNode } from "react"
import { AlertCircle, CheckCircle2, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { matchesLauncherActionShortcut } from "@/features/launcher-actions/controller-core"
import { cn } from "@/lib/utils"
import type {
  ExtensionRuntimeRecoverableIssue,
  ExtensionToastActionPayload,
  ExtensionToastPayload
} from "@shared/extension-runtime-protocol"
import { formatRuntimeActionShortcut, toLauncherActionShortcut } from "./runtime-action-shortcuts"

export interface RuntimeToastState {
  id: number
  toast: ExtensionToastPayload
}

type RuntimeExecutableToastAction = ExtensionToastActionPayload & { id: string }

export function RuntimeToastOverlay(props: {
  onAction: (actionId: string) => void
  onDismiss: () => void
  toast: RuntimeToastState | null
}): React.JSX.Element | null {
  const { onAction, onDismiss, toast } = props
  const actions = useMemo(
    () =>
      [toast?.toast.primaryAction, toast?.toast.secondaryAction].filter(
        (action): action is RuntimeExecutableToastAction => Boolean(action?.id)
      ),
    [toast]
  )

  useEffect(() => {
    if (actions.length === 0) {
      return
    }

    const handleToastShortcut = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) {
        return
      }

      const action = actions.find((candidate) => {
        const shortcut = toLauncherActionShortcut(candidate.shortcut)
        return shortcut ? matchesLauncherActionShortcut(shortcut, event) : false
      })
      if (!action) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      onAction(action.id)
    }

    window.addEventListener("keydown", handleToastShortcut, { capture: true })
    return () => {
      window.removeEventListener("keydown", handleToastShortcut, { capture: true })
    }
  }, [actions, onAction])

  if (!toast) {
    return null
  }

  const tone =
    toast.toast.style === "failure"
      ? "border-destructive/35 bg-background-elevated text-foreground"
      : "border-border bg-background-elevated text-foreground"
  const Icon = toast.toast.style === "failure" ? AlertCircle : CheckCircle2

  return (
    <div className="pointer-events-none absolute right-[var(--jingle-space-4)] top-[var(--jingle-space-4)] z-30 flex w-[min(360px,calc(100%-var(--jingle-space-8)))] justify-end">
      <div
        className={cn(
          "pointer-events-auto flex min-w-0 gap-[var(--jingle-gap-sm)] rounded-[var(--jingle-radius-panel)] border px-[var(--jingle-space-3)] py-[var(--jingle-space-2)] shadow-md",
          tone
        )}
      >
        <Icon
          className={cn(
            "mt-[2px] size-[var(--jingle-icon-sm)] shrink-0",
            toast.toast.style === "failure" ? "text-destructive" : "text-muted-foreground"
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate [font-size:var(--jingle-font-body)] font-medium">
            {toast.toast.title}
          </div>
          {toast.toast.message ? (
            <div className="mt-[var(--jingle-space-0-5)] line-clamp-2 [font-size:var(--jingle-font-caption)] leading-[var(--jingle-line-body)] text-muted-foreground">
              {toast.toast.message}
            </div>
          ) : null}
          {actions.length > 0 ? (
            <div className="mt-[var(--jingle-space-1-5)] flex flex-wrap gap-[var(--jingle-gap-xs)]">
              {actions.map((action) => (
                <Button
                  key={`${toast.id}:${action.title}:${action.id ?? ""}`}
                  type="button"
                  className="rounded-[var(--jingle-radius-sm)] border border-border/80 bg-background px-[var(--jingle-space-2)] py-[var(--jingle-space-0-5)] [font-size:var(--jingle-font-caption)] font-medium text-foreground transition hover:bg-muted"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onAction(action.id)
                  }}
                >
                  {action.title}
                  {action.shortcut ? (
                    <span className="ml-[var(--jingle-space-1-5)] text-muted-foreground">
                      {formatRuntimeActionShortcut(action.shortcut)}
                    </span>
                  ) : null}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
        <IconButton
          label="Dismiss toast"
          className="flex size-[var(--jingle-icon-action)] shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
          onClick={onDismiss}
          size="icon-sm"
          tooltip={false}
          variant="ghost"
        >
          <X className="size-[var(--jingle-icon-xs)]" />
        </IconButton>
      </div>
    </div>
  )
}

export function RuntimeIssueBand(props: {
  issues: readonly ExtensionRuntimeRecoverableIssue[]
  onDiscardIssue: (issueId: string) => void
}): React.JSX.Element | null {
  const { issues, onDiscardIssue } = props
  if (issues.length === 0) {
    return null
  }

  return (
    <div
      aria-live="polite"
      className="flex max-h-40 w-full shrink-0 gap-[var(--jingle-gap-sm)] overflow-y-auto border-b border-destructive/35 bg-background-elevated px-[var(--jingle-space-3)] py-[var(--jingle-space-2)] text-foreground"
      data-runtime-issue-band
      role="status"
    >
      <AlertCircle className="mt-[2px] size-[var(--jingle-icon-sm)] shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <div className="[font-size:var(--jingle-font-body)] font-medium">
          Stored values need attention
        </div>
        <div className="mt-[var(--jingle-space-1)] space-y-[var(--jingle-space-1)]">
          {issues.map((issue) => (
            <div
              key={issue.id}
              className="break-words [font-size:var(--jingle-font-caption)] leading-[var(--jingle-line-body)] text-muted-foreground"
              data-runtime-recovery-strategy={issue.recovery.strategy}
            >
              <div className="text-foreground">
                <code>{issue.recovery.key}</code>
                {issue.recovery.strategy === "replace-value"
                  ? ": Update the owning field to establish a current value."
                  : ": Discard this stored value to continue."}
              </div>
              <div>{issue.message}</div>
              {issue.recovery.strategy === "discard-value" ? (
                <Button
                  className="mt-[var(--jingle-space-1)]"
                  onClick={() => onDiscardIssue(issue.id)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Trash2 className="size-[var(--jingle-icon-xs)]" />
                  Discard stored value
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function RuntimeIssueSurfaceLayout(props: {
  children?: ReactNode
  issues: readonly ExtensionRuntimeRecoverableIssue[]
  onDiscardIssue: (issueId: string) => void
  surface: "runtime-detail" | "runtime-form" | "runtime-list"
}): React.JSX.Element {
  const { children, issues, onDiscardIssue, surface } = props

  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-col"
      data-runtime-issue-layout={surface}
    >
      <RuntimeIssueBand issues={issues} onDiscardIssue={onDiscardIssue} />
      <div className="relative min-h-0 flex-1" data-runtime-issue-content>
        {children}
      </div>
    </div>
  )
}
