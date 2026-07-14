import type { ReactNode } from "react"
import { LauncherActionOverlay } from "@/features/launcher-actions/LauncherActionOverlay"
import type { NativeSurfaceActionController } from "./surface-action-controller"

export function NativeSurfaceActionsFooter(props: {
  controller: NativeSurfaceActionController
  leading: ReactNode
}): React.JSX.Element {
  const { controller, leading } = props
  const primaryAction = controller.primaryActionPresentation

  return (
    <>
      <div className="flex min-w-0 items-center gap-[var(--ow-gap-md)]">{leading}</div>

      <div className="flex items-center gap-[var(--ow-gap-sm)]">
        {controller.canOpenActions ? (
          <button
            type="button"
            onClick={controller.openActions}
            onMouseDown={(event) => event.preventDefault()}
            className="launcher-action-link flex h-[var(--launcher-action-control-h)] items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-md)] px-[var(--ow-space-2-5)] [font-size:var(--ow-font-meta)] font-medium text-foreground"
          >
            <span>Actions</span>
            {controller.actionPanelShortcut ? (
              <span className="launcher-shortcut [font-size:var(--ow-font-meta)] text-muted-foreground">
                {controller.actionPanelShortcut}
              </span>
            ) : null}
          </button>
        ) : null}

        <button
          type="button"
          onClick={primaryAction.kind === "ready" ? primaryAction.execute : undefined}
          onMouseDown={(event) => event.preventDefault()}
          disabled={primaryAction.kind === "invalid"}
          className="launcher-action-link flex h-[var(--launcher-action-control-h)] items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-md)] px-[var(--ow-space-2-5)] [font-size:var(--ow-font-meta)] font-medium text-foreground disabled:opacity-40"
        >
          <span>{primaryAction.title}</span>
          {primaryAction.kind === "ready" && primaryAction.shortcut ? (
            <span className="launcher-shortcut [font-size:var(--ow-font-meta)] text-muted-foreground">
              {primaryAction.shortcut}
            </span>
          ) : null}
        </button>
      </div>
    </>
  )
}

export function NativeSurfaceActionLayer(props: {
  controller: NativeSurfaceActionController
}): React.JSX.Element | null {
  const { controller } = props

  if (!controller.showActions || !controller.canOpenActions) {
    return null
  }

  return (
    <LauncherActionOverlay
      actions={controller.actions}
      onClose={controller.closeActions}
      surfaceId="native-action-panel"
    />
  )
}
