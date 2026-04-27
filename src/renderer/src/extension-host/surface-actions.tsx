import type { ReactNode } from "react"
import { LauncherActionOverlay } from "@/features/launcher-actions/LauncherActionOverlay"
import type { NativeSurfaceActionController } from "./surface-action-controller"

export function NativeSurfaceActionsFooter(props: {
  controller: NativeSurfaceActionController
  leading: ReactNode
}): React.JSX.Element {
  const { controller, leading } = props

  return (
    <>
      <div className="flex min-w-0 items-center gap-3">{leading}</div>

      <div className="flex items-center gap-2">
        {controller.canOpenActions ? (
          <button
            type="button"
            onClick={controller.openActions}
            onMouseDown={(event) => event.preventDefault()}
            className="launcher-action-link flex h-7 items-center gap-2 rounded-[var(--ow-radius-md)] px-2.5 text-[var(--ow-font-meta)] font-medium text-foreground"
          >
            <span>Actions</span>
            {controller.actionPanelShortcut ? (
              <span className="launcher-shortcut text-[11px] text-muted-foreground">
                {controller.actionPanelShortcut}
              </span>
            ) : null}
          </button>
        ) : null}

        <button
          type="button"
          onClick={controller.executePrimaryAction}
          onMouseDown={(event) => event.preventDefault()}
          disabled={!controller.primaryAction}
          className="launcher-action-link flex h-7 items-center gap-2 rounded-[var(--ow-radius-md)] px-2.5 text-[var(--ow-font-meta)] font-medium text-foreground disabled:opacity-40"
        >
          <span>{controller.primaryAction?.title ?? controller.primaryActionFallbackTitle}</span>
          {controller.primaryActionShortcut ? (
            <span className="launcher-shortcut text-[11px] text-muted-foreground">
              {controller.primaryActionShortcut}
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
