import { Fragment, useEffect, useState, type ReactNode } from "react"
import { formatLauncherCommandShortcut } from "@/shortcuts/format-shortcut"
import { cn } from "@/lib/utils"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import type { NativeActionDescriptor } from "./actions"
import { NativeSurfaceHeaderLeading } from "./chrome"

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key === "ArrowDown") {
        event.preventDefault()
        setSelectedIndex((current) => Math.min(current + 1, flatActions.length - 1))
        return
      }

      if (event.key === "ArrowUp") {
        event.preventDefault()
        setSelectedIndex((current) => Math.max(current - 1, 0))
        return
      }

      if (event.key === "Enter") {
        event.preventDefault()
        void Promise.resolve(flatActions[selectedIndex]?.onAction()).finally(onClose)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [flatActions, onClose, selectedIndex])

  return (
    <div className="absolute inset-0 z-50 bg-black/28" onClick={onClose}>
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
                const isSelected = index === selectedIndex

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

interface NativeSurfaceActionKeyEvent {
  ctrlKey: boolean
  key: string
  metaKey: boolean
  preventDefault: () => void
}

export interface NativeSurfaceActionController {
  actionPanelShortcut: string | null
  actions: NativeActionDescriptor[]
  canOpenActions: boolean
  closeActions: () => void
  executePrimaryAction: () => void
  handleKeyDown: (event: NativeSurfaceActionKeyEvent) => boolean
  openActions: () => void
  primaryAction: NativeActionDescriptor | null
  primaryActionFallbackTitle: string
  primaryActionShortcut: string | null
  showActions: boolean
}

export interface NativeSurfaceController {
  actionController: NativeSurfaceActionController
  actionLayer: React.JSX.Element | null
  footer: React.JSX.Element
  headerLeading: React.JSX.Element
}

function isRichTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return target instanceof HTMLTextAreaElement || target.isContentEditable
}

export function useNativeSurfaceActionController(params: {
  actions: NativeActionDescriptor[]
  primaryActionFallbackTitle: string
}): NativeSurfaceActionController {
  const { actions, primaryActionFallbackTitle } = params
  const [showActions, setShowActions] = useState(false)
  const primaryAction = actions[0] ?? null
  const canOpenActions = actions.length > 1
  const actionPanelShortcut = formatLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.actionsOpen)
  const primaryActionShortcut = formatLauncherCommandShortcut(
    LAUNCHER_COMMAND_IDS.actionsExecutePrimary
  )

  const executePrimaryAction = (): void => {
    if (primaryAction) {
      void Promise.resolve(primaryAction.onAction())
    }
  }

  const handleKeyDown = (event: NativeSurfaceActionKeyEvent): boolean => {
    if (event.key === "Enter") {
      event.preventDefault()
      executePrimaryAction()
      return true
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && canOpenActions) {
      event.preventDefault()
      setShowActions(true)
      return true
    }

    return false
  }

  return {
    actionPanelShortcut,
    actions,
    canOpenActions,
    closeActions: () => setShowActions(false),
    executePrimaryAction,
    handleKeyDown,
    openActions: () => setShowActions(true),
    primaryAction,
    primaryActionFallbackTitle,
    primaryActionShortcut,
    showActions
  }
}

export function useNativeSurfaceController(params: {
  actions: NativeActionDescriptor[]
  footerCount?: string | null
  footerLabel: string
  headerLabel?: string
  primaryActionFallbackTitle: string
}): NativeSurfaceController {
  const { actions, footerCount, footerLabel, headerLabel, primaryActionFallbackTitle } = params
  const actionController = useNativeSurfaceActionController({
    actions,
    primaryActionFallbackTitle
  })

  useEffect(() => {
    if (actionController.showActions) {
      return
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) {
        return
      }

      if (event.key === "Enter" && isRichTextInputTarget(event.target)) {
        return
      }

      actionController.handleKeyDown(event)
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [actionController])

  return {
    actionController,
    actionLayer: <NativeSurfaceActionLayer controller={actionController} />,
    footer: (
      <NativeSurfaceActionsFooter
        controller={actionController}
        leading={
          <>
            <div className="truncate text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
              {footerLabel}
            </div>
            {footerCount ? (
              <div className="shrink-0 text-[12px] text-muted-foreground">{footerCount}</div>
            ) : null}
          </>
        }
      />
    ),
    headerLeading: <NativeSurfaceHeaderLeading label={headerLabel} />
  }
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
