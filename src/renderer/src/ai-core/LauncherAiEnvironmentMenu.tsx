import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { CheckCircle2, Circle, Info, Loader2, XCircle } from "lucide-react"
import { useState } from "react"
import type { Subagent, Todo } from "@/types"
import {
  getSubagentStatusLabel,
  getSubagentTypeBadge,
  type SubagentStatusLabels
} from "@/lib/subagent-view"
import { cn } from "@/lib/utils"
import { LauncherAiProgressList } from "./LauncherAiProgressList"

export interface LauncherAiEnvironmentInfo {
  modelLabel: string | null
  permissionLabel: string
  subagents: readonly Subagent[]
  threadId: string | null
  todos: readonly Todo[]
  workspacePath: string | null
}

interface LauncherAiEnvironmentMenuProps {
  environment: LauncherAiEnvironmentInfo
  labels: {
    environmentInfo: string
    environmentModel: string
    environmentNoModel: string
    environmentNoThread: string
    environmentNoWorkspace: string
    environmentPermission: string
    environmentProgress: string
    environmentProgressMore: (count: number) => string
    environmentSubagents: string
    environmentSubagentStatuses: SubagentStatusLabels
    environmentThread: string
    environmentWorkspace: string
  }
}

const SUBAGENT_VISIBLE_LIMIT = 6

const SUBAGENT_STATUS_ICON = {
  completed: CheckCircle2,
  failed: XCircle,
  pending: Circle,
  running: Loader2
}

const SUBAGENT_STATUS_ICON_CLASS_NAME = {
  completed: "text-muted-foreground",
  failed: "text-status-critical",
  pending: "text-muted-foreground",
  running: "text-status-info"
}

function LauncherAiSubagentList(props: {
  label: string
  moreLabel: (count: number) => string
  statusLabels: SubagentStatusLabels
  subagents: readonly Subagent[]
}): React.JSX.Element | null {
  const { label, moreLabel, statusLabels, subagents } = props
  const [isExpanded, setIsExpanded] = useState(false)

  if (subagents.length === 0) {
    return null
  }

  const visibleSubagents = isExpanded ? subagents : subagents.slice(0, SUBAGENT_VISIBLE_LIMIT)
  const hiddenCount = subagents.length - visibleSubagents.length

  return (
    <div className="launcher-ai-environment-menu__subagents">
      <div className="launcher-ai-progress__heading">{label}</div>
      <div className="launcher-ai-progress__list">
        {visibleSubagents.map((subagent) => {
          const Icon = SUBAGENT_STATUS_ICON[subagent.status]

          return (
            <div className="launcher-ai-progress__item" key={subagent.id}>
              <Icon
                className={cn(
                  "launcher-ai-progress__icon",
                  SUBAGENT_STATUS_ICON_CLASS_NAME[subagent.status],
                  subagent.status === "running" && "animate-spin"
                )}
              />
              <span className="launcher-ai-progress__copy">
                <span>{subagent.name}</span>
                <span className="launcher-ai-progress__meta">
                  {[
                    getSubagentTypeBadge(subagent.subagentType),
                    getSubagentStatusLabel(subagent.status, statusLabels)
                  ].join(" · ")}
                </span>
              </span>
            </div>
          )
        })}
      </div>
      {hiddenCount > 0 ? (
        <button
          className="launcher-ai-progress__more"
          type="button"
          onClick={() => setIsExpanded(true)}
        >
          {moreLabel(hiddenCount)}
        </button>
      ) : null}
    </div>
  )
}

function EnvironmentRow(props: {
  label: string
  title?: string
  value: string
}): React.JSX.Element {
  const { label, title, value } = props

  return (
    <div className="launcher-ai-environment-menu__row">
      <span className="launcher-ai-environment-menu__label">{label}</span>
      <span className="launcher-ai-environment-menu__value" title={title ?? value}>
        {value}
      </span>
    </div>
  )
}

export function LauncherAiEnvironmentMenu(
  props: LauncherAiEnvironmentMenuProps
): React.JSX.Element {
  const { environment, labels } = props
  const workspaceValue = environment.workspacePath ?? labels.environmentNoWorkspace
  const modelLabel = environment.modelLabel ?? labels.environmentNoModel
  const threadLabel = environment.threadId ?? labels.environmentNoThread

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={labels.environmentInfo}
          title={labels.environmentInfo}
          onMouseDown={(event) => event.preventDefault()}
          className={cn(
            "launcher-ai-environment-menu__trigger launcher-icon-button flex h-[var(--launcher-icon-button-size)] w-[var(--launcher-icon-button-size)] shrink-0 appearance-none items-center justify-center rounded-full border-0 text-muted-foreground transition hover:text-foreground",
            "data-[state=open]:bg-background-secondary/70 data-[state=open]:text-foreground"
          )}
        >
          <Info className="size-[var(--ow-icon-sm)]" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          className="launcher-ai-menu launcher-ai-environment-menu"
          side="bottom"
          sideOffset={6}
        >
          <div className="launcher-ai-environment-menu__heading">{labels.environmentInfo}</div>
          <EnvironmentRow label={labels.environmentWorkspace} value={workspaceValue} />
          <EnvironmentRow label={labels.environmentModel} value={modelLabel} />
          <EnvironmentRow
            label={labels.environmentPermission}
            value={environment.permissionLabel}
          />
          <EnvironmentRow label={labels.environmentThread} value={threadLabel} />
          <LauncherAiProgressList
            className="launcher-ai-environment-menu__progress"
            label={labels.environmentProgress}
            moreLabel={labels.environmentProgressMore}
            todos={environment.todos}
          />
          <LauncherAiSubagentList
            label={labels.environmentSubagents}
            moreLabel={labels.environmentProgressMore}
            statusLabels={labels.environmentSubagentStatuses}
            subagents={environment.subagents}
          />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
