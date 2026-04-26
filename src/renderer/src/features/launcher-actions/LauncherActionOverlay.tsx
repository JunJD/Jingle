import { Fragment, useState } from "react"
import { useShortcutCommandHandler, useShortcutScopeLayer } from "@/shortcuts/shortcut-context"
import { cn } from "@/lib/utils"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import type { LauncherActionDescriptor } from "./model"

const ACTION_PANEL_SHORTCUT_SCOPES = ["launcher.action-panel"] as const

function groupActionsBySection(actions: LauncherActionDescriptor[]): Array<{
  actions: LauncherActionDescriptor[]
  title?: string
}> {
  const groups: Array<{ actions: LauncherActionDescriptor[]; title?: string }> = []

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

export function LauncherActionOverlay(props: {
  actions: LauncherActionDescriptor[]
  onClose: () => void
  surfaceId?: string
}): React.JSX.Element {
  const { actions, onClose, surfaceId = "launcher-action-panel" } = props
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
    <div className="absolute inset-0 z-50 bg-black/28" data-surface={surfaceId} onClick={onClose}>
      <div
        className="absolute bottom-12 right-3 w-80 overflow-hidden rounded-[var(--ow-radius-dialog)] border border-border/80 bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="max-h-[60vh] overflow-y-auto py-2">
          {groupedActions.map((group, groupIndex) => (
            <Fragment key={`launcher-action-group-${groupIndex}`}>
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
                      <span className="launcher-shortcut shrink-0 text-[11px] text-muted-foreground">
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
