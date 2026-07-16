import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { useState } from "react"
import type { OpenTarget } from "@shared/open-targets"
import { ChevronDown, FolderOpen, MonitorUp, Terminal } from "lucide-react"
import { LauncherAiMenuItem } from "./LauncherAiMenuItem"
import { useRequiredOpenTargetContext } from "@/lib/open-target-context"
import { cn } from "@/lib/utils"

interface LauncherAiOpenTargetMenuProps {
  labels: {
    openFolder: string
    openTarget: string
  }
}

function getFolderName(folderPath: string | null): string | null {
  if (!folderPath) {
    return null
  }

  const normalized = folderPath.replace(/[\\/]+$/, "")
  const parts = normalized.split(/[\\/]+/)
  return parts.at(-1) || normalized
}

function getTargetIcon(target: OpenTarget): React.JSX.Element {
  if (target.iconDataUrl) {
    return <img alt="" className="launcher-ai-menu__app-icon" src={target.iconDataUrl} />
  }

  if (target.kind === "terminal") {
    return <Terminal />
  }

  if (target.kind === "application") {
    return <MonitorUp />
  }

  return <FolderOpen />
}

export function LauncherAiOpenTargetMenu(props: LauncherAiOpenTargetMenuProps): React.JSX.Element {
  const { labels } = props
  const { folderPath, openTarget, primaryTarget, setSelectedTargetId, targets } =
    useRequiredOpenTargetContext()
  const folderName = getFolderName(folderPath)
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="launcher-ai-open-target-control">
      <button
        type="button"
        aria-label={labels.openFolder}
        className="launcher-ai-open-target-control__main launcher-icon-button"
        disabled={!folderPath || !primaryTarget}
        title={primaryTarget ? `${labels.openTarget}: ${primaryTarget.label}` : labels.openFolder}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (primaryTarget) {
            setSelectedTargetId(primaryTarget.id)
            openTarget(primaryTarget.id)
          }
        }}
      >
        {primaryTarget ? (
          getTargetIcon(primaryTarget)
        ) : (
          <FolderOpen className="size-[var(--jingle-icon-sm)]" />
        )}
      </button>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={labels.openTarget}
            disabled={!folderPath}
            title={labels.openTarget}
            onMouseDown={(event) => event.preventDefault()}
            className={cn(
              "launcher-ai-open-target-control__chevron launcher-icon-button",
              "aria-[expanded=true]:bg-background-secondary/70 aria-[expanded=true]:text-foreground"
            )}
          >
            <ChevronDown className="size-[var(--jingle-icon-xs)]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="launcher-ai-menu launcher-ai-open-target-menu"
          side="bottom"
          sideOffset={6}
        >
          {folderName ? (
            <div className="launcher-ai-open-target-menu__context" title={folderPath ?? ""}>
              {folderName}
            </div>
          ) : null}
          {targets.length === 0 ? (
            <LauncherAiMenuItem disabled icon={<FolderOpen />}>
              {labels.openTarget}
            </LauncherAiMenuItem>
          ) : null}
          {targets.map((target) => (
            <LauncherAiMenuItem
              key={target.id}
              icon={getTargetIcon(target)}
              onSelect={() => {
                setSelectedTargetId(target.id)
                openTarget(target.id)
              }}
            >
              {target.label}
            </LauncherAiMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
