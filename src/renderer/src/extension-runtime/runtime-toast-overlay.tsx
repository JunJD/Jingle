import { useEffect, useMemo } from "react"
import { AlertCircle, CheckCircle2, X } from "lucide-react"
import { matchesLauncherActionShortcut } from "@/features/launcher-actions/controller-core"
import { cn } from "@/lib/utils"
import type {
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
      ? "border-red-500/25 bg-red-500/8 text-red-700"
      : "border-border bg-background-elevated/95 text-foreground"
  const Icon = toast.toast.style === "failure" ? AlertCircle : CheckCircle2

  return (
    <div className="pointer-events-none absolute right-[var(--jingle-space-4)] top-[var(--jingle-space-4)] z-30 flex w-[min(360px,calc(100%-var(--jingle-space-8)))] justify-end">
      <div
        className={cn(
          "pointer-events-auto flex min-w-0 gap-[var(--jingle-gap-sm)] rounded-[var(--jingle-radius-panel)] border px-[var(--jingle-space-3)] py-[var(--jingle-space-2)] shadow-lg backdrop-blur",
          tone
        )}
      >
        <Icon className="mt-[2px] size-[var(--jingle-icon-sm)] shrink-0" />
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
                <button
                  key={`${toast.id}:${action.title}:${action.id ?? ""}`}
                  type="button"
                  className="rounded-[var(--jingle-radius-sm)] border border-border/80 bg-background px-[var(--jingle-space-2)] py-[var(--jingle-space-0-5)] [font-size:var(--jingle-font-caption)] font-medium text-foreground transition hover:bg-muted"
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
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Dismiss toast"
          className="flex size-[var(--jingle-icon-action)] shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
          onClick={onDismiss}
        >
          <X className="size-[var(--jingle-icon-xs)]" />
        </button>
      </div>
    </div>
  )
}
