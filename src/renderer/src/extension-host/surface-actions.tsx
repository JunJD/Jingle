import { Fragment, useState, type ReactNode } from "react"
import { useShortcutCommandHandler, useShortcutScopeLayer } from "@/shortcuts/shortcut-context"
import { cn } from "@/lib/utils"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import type { NativeActionDescriptor } from "./actions"
import type { NativeSurfaceActionController } from "./surface-action-controller"

const ACTION_PANEL_SHORTCUT_SCOPES = ["launcher.action-panel"] as const

function groupActionsBySection(actions: NativeActionDescriptor[]): Array<{
  actions: NativeActionDescriptor[]
  title?: string
}> {
  const groups: Array<{ actions: NativeActionDescriptor[]; title?: string }> = []

  for (const action of actions) {
    const current = groups[groups.length - 1]
    if (!current || current.title !== action.sectionTitle) {
      groups.push({
        actions: [action],
        title: action.sectionTitle
      })
      continue
    }

    current.actions.push(action)
  }

  return groups
}

export function NativeActionOverlay(props: {
  actions: NativeActionDescriptor[]
  onClose: () => void
}): React.JSX.Element {
  const { actions, onClose } = props
  const groupedActions = groupActionsBySection(actions)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const flatActions = groupedActions.flatMap((group) => group.actions)
  const maxSelectedIndex = Math.max(flatActions.length - 1, 0)
  const activeSelectedIndex = Math.min(selectedIndex, maxSelectedIndex)
  const executeSelectedAction = (): void => {
    const selectedAction = flatActions[activeSelectedIndex]
    if (!selectedAction) {
      return
    }

    void Promise.resolve(selectedAction.onAction()).finally(onClose)
  }

  useShortcutScopeLayer(ACTION_PANEL_SHORTCUT_SCOPES)
  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.actionPanelClose, onClose)
  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.actionPanelMoveSelectionDown, () => {
    setSelectedIndex((current) => {
      const boundedCurrent = Math.min(current, maxSelectedIndex)
      return Math.min(boundedCurrent + 1, maxSelectedIndex)
    })
  })
  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.actionPanelMoveSelectionUp, () => {
    setSelectedIndex((current) => Math.max(Math.min(current, maxSelectedIndex) - 1, 0))
  })
  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.actionPanelExecuteSelection, executeSelectedAction)

  return (
    <div
      className="absolute inset-0 z-50 bg-black/28"
      data-surface="native-action-panel"
      onClick={onClose}
    >
      <div
        className="absolute bottom-12 right-3 w-80 overflow-hidden rounded-2xl border border-border/80 bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="max-h-[60vh] overflow-y-auto py-2">
          {groupedActions.map((group, groupIndex) => (
            <Fragment key={`native-action-group-${groupIndex}`}>
              {group.title ? (
                <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {group.title}
                </div>
              ) : null}
              {group.actions.map((action) => {
                const index = flatActions.findIndex((entry) => entry.id === action.id)
                const isSelected = index === activeSelectedIndex

                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => {
                      void Promise.resolve(action.onAction()).finally(onClose)
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-[13px] transition",
                      isSelected ? "bg-background-secondary" : "hover:bg-background-secondary/70",
                      action.style === "destructive" ? "text-red-500" : "text-foreground"
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {action.icon ? <div className="shrink-0">{action.icon}</div> : null}
                      <span className="truncate">{action.title}</span>
                    </div>
                    {action.shortcut ? (
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {action.shortcut}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}

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
            className="launcher-action-link flex items-center gap-2 rounded-[10px] px-3 py-1 text-[13px] font-medium text-foreground"
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
          className="launcher-action-link flex items-center gap-2 rounded-[10px] px-3 py-1 text-[13px] font-medium text-foreground disabled:opacity-40"
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

  return <NativeActionOverlay actions={controller.actions} onClose={controller.closeActions} />
}
