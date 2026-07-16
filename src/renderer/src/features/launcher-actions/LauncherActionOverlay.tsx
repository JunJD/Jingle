import { Fragment, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
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
  const [submenuStack, setSubmenuStack] = useState<
    Array<{ actions: LauncherActionDescriptor[]; title: string }>
  >([])
  const activeMenu = submenuStack[submenuStack.length - 1] ?? null
  const visibleActions = activeMenu?.actions ?? actions
  const groupedActions = useMemo(() => groupActionsBySection(visibleActions), [visibleActions])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const flatActions = groupedActions.flatMap((group) => group.actions)
  const maxSelectedIndex = Math.max(flatActions.length - 1, 0)
  const activeSelectedIndex = Math.min(selectedIndex, maxSelectedIndex)
  const enterSubmenu = (action: LauncherActionDescriptor): void => {
    if (!action.children || action.children.length === 0) {
      return
    }

    const childActions = action.children
    setSubmenuStack((current) => [...current, { actions: childActions, title: action.title }])
    setSelectedIndex(0)
  }
  const popSubmenu = (): void => {
    setSubmenuStack((current) => current.slice(0, -1))
    setSelectedIndex(0)
  }
  const executeSelectedAction = (): void => {
    const selectedAction = flatActions[activeSelectedIndex]
    if (!selectedAction || selectedAction.disabled) {
      return
    }

    if (selectedAction.children && selectedAction.children.length > 0) {
      enterSubmenu(selectedAction)
      return
    }

    void Promise.resolve(selectedAction.onAction()).finally(onClose)
  }

  useShortcutScopeLayer(ACTION_PANEL_SHORTCUT_SCOPES)
  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.actionPanelClose, () => {
    if (submenuStack.length > 0) {
      popSubmenu()
      return
    }

    onClose()
  })
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
    <div className="absolute inset-0 z-50" data-surface={surfaceId}>
      <Button
        aria-label="Close launcher action panel"
        className="absolute inset-0 h-full w-full rounded-none bg-black/28 p-0 hover:bg-black/28"
        onClick={onClose}
        type="button"
        variant="ghost"
      />
      <div
        data-press-surface="instant"
        className="absolute bottom-[var(--launcher-action-panel-bottom)] right-[var(--launcher-action-panel-right)] w-[var(--launcher-action-panel-width)] overflow-hidden rounded-[var(--jingle-radius-dialog)] border border-border/80 bg-background shadow-md"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="max-h-[var(--launcher-action-panel-max-h)] overflow-y-auto p-[var(--jingle-space-2)]">
          {activeMenu ? (
            <div className="-mx-[var(--jingle-space-2)] mb-[var(--jingle-space-2)] border-b border-border/70 px-[var(--jingle-space-2)] pb-[var(--jingle-space-2)]">
              <Button
                type="button"
                onClick={popSubmenu}
                className="flex h-[var(--jingle-control-h-lg)] w-full items-center gap-[var(--jingle-gap-sm)] rounded-[var(--jingle-radius-md)] px-[var(--jingle-space-3)] text-left [font-size:var(--jingle-font-body)] text-muted-foreground hover:bg-background-secondary"
                variant="ghost"
              >
                <ChevronLeft
                  className="size-[var(--jingle-icon-action)] shrink-0"
                  strokeWidth={2.2}
                />
                <span className="truncate">{activeMenu.title}</span>
              </Button>
            </div>
          ) : null}
          {groupedActions.map((group, groupIndex) => (
            <Fragment key={`launcher-action-group-${groupIndex}`}>
              {group.title ? (
                <div className="px-[var(--jingle-space-2)] pb-[var(--jingle-space-1)] pt-[var(--jingle-space-2)] [font-size:var(--jingle-font-caption)] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {group.title}
                </div>
              ) : null}
              {group.actions.map((action) => {
                const index = flatActions.findIndex((entry) => entry.id === action.id)
                const isFocused = index === activeSelectedIndex
                const isChecked = action.checked === true

                return (
                  <Button
                    key={action.id}
                    type="button"
                    onClick={() => {
                      if (action.disabled) {
                        return
                      }

                      if (action.children && action.children.length > 0) {
                        enterSubmenu(action)
                      } else {
                        void Promise.resolve(action.onAction()).finally(onClose)
                      }
                    }}
                    disabled={action.disabled}
                    className={cn(
                      "flex h-[var(--jingle-control-h-lg)] w-full items-center justify-between gap-[var(--jingle-gap-md)] rounded-[var(--jingle-radius-md)] px-[var(--jingle-space-3)] text-left [font-size:var(--jingle-font-body)] focus-visible:outline-none",
                      isChecked
                        ? "bg-background-secondary font-medium text-foreground"
                        : "hover:bg-background-secondary/70",
                      isFocused && !isChecked ? "bg-background-secondary/45" : null,
                      action.style === "destructive" ? "text-red-500" : "text-foreground",
                      action.disabled ? "cursor-default opacity-45" : null
                    )}
                    variant="ghost"
                  >
                    <div className="flex min-w-0 items-center gap-[var(--jingle-gap-md)]">
                      {action.icon ? (
                        <div className="flex size-[var(--jingle-icon-action)] shrink-0 items-center justify-center [&>svg]:size-[var(--jingle-icon-action)]">
                          {action.icon}
                        </div>
                      ) : null}
                      <span className="truncate">{action.title}</span>
                    </div>

                    {action.shortcut ? (
                      <span className="launcher-shortcut shrink-0 [font-size:var(--jingle-font-meta)] text-muted-foreground">
                        {action.shortcut}
                      </span>
                    ) : action.children && action.children.length > 0 ? (
                      <span className="flex size-[var(--jingle-icon-md)] shrink-0 items-center justify-center text-muted-foreground">
                        <ChevronRight
                          className="size-[var(--jingle-icon-action)]"
                          strokeWidth={2.2}
                        />
                      </span>
                    ) : action.accessory ? (
                      <span className="flex size-[var(--jingle-icon-md)] shrink-0 items-center justify-center text-primary [&>svg]:size-[var(--jingle-icon-action)]">
                        {action.accessory}
                      </span>
                    ) : null}
                  </Button>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}
