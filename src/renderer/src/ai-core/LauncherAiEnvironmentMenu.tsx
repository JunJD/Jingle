import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { Info } from "lucide-react"
import { cn } from "@/lib/utils"

export interface LauncherAiEnvironmentInfo {
  modelLabel: string | null
  permissionLabel: string
  threadId: string | null
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
    environmentThread: string
    environmentWorkspace: string
  }
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
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
