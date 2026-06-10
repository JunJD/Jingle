import { Fragment, useMemo, useState } from "react"
import { ChevronRight } from "lucide-react"
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

    setSubmenuStack((current) => [
      ...current,
      { actions: action.children ?? [], title: action.title }
    ])
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
    <div className="absolute inset-0 z-50 bg-black/28" data-surface={surfaceId} onClick={onClose}>
      <div
        className="absolute bottom-[var(--launcher-action-panel-bottom)] right-[var(--launcher-action-panel-right)] w-[var(--launcher-action-panel-width)] overflow-hidden rounded-[var(--ow-radius-dialog)] border border-border/80 bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="max-h-[var(--launcher-action-panel-max-h)] overflow-y-auto py-[var(--ow-space-2)]">
          {activeMenu ? (
            <div className="border-b border-border/70 px-[var(--ow-space-2)] pb-[var(--ow-space-2)]">
              <button
                type="button"
                onClick={popSubmenu}
                className="flex h-[var(--ow-control-h-lg)] w-full items-center gap-[var(--ow-gap-md)] rounded-[var(--ow-radius-md)] px-[var(--ow-space-3)] text-left [font-size:var(--ow-font-body)] text-muted-foreground transition hover:bg-background-secondary/70"
              >
                <span className="rotate-180 [font-size:var(--ow-font-title)] leading-none">›</span>
                <span className="truncate">{activeMenu.title}</span>
              </button>
            </div>
          ) : null}
          {groupedActions.map((group, groupIndex) => (
            <Fragment key={`launcher-action-group-${groupIndex}`}>
              {group.title ? (
                <div className="px-[var(--ow-space-4)] pb-[var(--ow-space-1)] pt-[var(--ow-space-2)] [font-size:var(--ow-font-caption)] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
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
                      "mx-[var(--ow-space-2)] flex h-[var(--ow-control-h-lg)] w-[calc(100%-(var(--ow-space-2)*2))] items-center justify-between gap-[var(--ow-gap-md)] rounded-[var(--ow-radius-md)] px-[var(--ow-space-3)] text-left [font-size:var(--ow-font-body)] transition",
                      isSelected ? "bg-background-secondary" : "hover:bg-background-secondary/70",
                      action.style === "destructive" ? "text-red-500" : "text-foreground",
                      action.disabled ? "cursor-default opacity-45" : null
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-[var(--ow-gap-md)]">
                      {action.icon ? (
                        <div className="flex size-[var(--ow-icon-action)] shrink-0 items-center justify-center [&>svg]:size-[var(--ow-icon-action)]">
                          {action.icon}
                        </div>
                      ) : null}
                      <span className="truncate">{action.title}</span>
                    </div>

                    {action.shortcut ? (
                      <span className="launcher-shortcut shrink-0 [font-size:var(--ow-font-meta)] text-muted-foreground">
                        {action.shortcut}
                      </span>
                    ) : action.children && action.children.length > 0 ? (
                      <ChevronRight className="size-[var(--ow-icon-sm)] shrink-0 text-muted-foreground" />
                    ) : action.accessory ? (
                      <span className="flex size-[var(--ow-icon-action)] shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-[var(--ow-icon-action)]">
                        {action.accessory}
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
