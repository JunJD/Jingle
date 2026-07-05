import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { Info } from "lucide-react"
import type { Todo } from "@/types"
import { cn } from "@/lib/utils"
import { LauncherAiProgressList } from "./LauncherAiProgressList"

export interface LauncherAiEnvironmentInfo {
  modelLabel: string | null
  permissionLabel: string
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
    environmentThread: string
    environmentWorkspace: string
  }
}

function EnvironmentRow(props: {
  dataAttributes?: Record<`data-${string}`, string>
  label: string
  title?: string
  value: string
}): React.JSX.Element {
  const { dataAttributes, label, title, value } = props
  let valueTitle = value

  if (title !== undefined) {
    valueTitle = title
  }

  return (
    <div className="launcher-ai-environment-menu__row" {...dataAttributes}>
      <span className="launcher-ai-environment-menu__label">{label}</span>
      <span className="launcher-ai-environment-menu__value" title={valueTitle}>
        {value}
      </span>
    </div>
  )
}

export function LauncherAiEnvironmentMenu(
  props: LauncherAiEnvironmentMenuProps
): React.JSX.Element {
  const { environment, labels } = props
  let workspaceValue = labels.environmentNoWorkspace
  let modelLabel = labels.environmentNoModel
  let threadLabel = labels.environmentNoThread
  const workspaceDataAttributes: Record<`data-${string}`, string> = {}

  if (environment.workspacePath !== null) {
    workspaceValue = environment.workspacePath
    workspaceDataAttributes["data-launcher-ai-workspace-path"] = environment.workspacePath
  }

  if (environment.modelLabel !== null) {
    modelLabel = environment.modelLabel
  }

  if (environment.threadId !== null) {
    threadLabel = environment.threadId
    workspaceDataAttributes["data-launcher-ai-workspace-thread-id"] = environment.threadId
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={labels.environmentInfo}
          data-launcher-ai-environment-trigger=""
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
          <EnvironmentRow
            dataAttributes={workspaceDataAttributes}
            label={labels.environmentWorkspace}
            value={workspaceValue}
          />
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
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
