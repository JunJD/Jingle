import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { useEffect, useMemo, useState } from "react"
import type { OpenTarget } from "@shared/open-targets"
import { ChevronDown, FolderOpen, MonitorUp, Terminal } from "lucide-react"
import { LauncherAiMenuItem } from "./LauncherAiMenuItem"
import { cn } from "@/lib/utils"

const EMPTY_TARGETS: OpenTarget[] = []

interface LauncherAiOpenTargetMenuProps {
  labels: {
    openFolder: string
    openTarget: string
  }
  folderPath: string | null
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
  const { folderPath, labels } = props
  const folderName = getFolderName(folderPath)
  const [targetState, setTargetState] = useState<{
    folderPath: string
    targets: OpenTarget[]
  } | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const targets = targetState?.folderPath === folderPath ? targetState.targets : EMPTY_TARGETS
  const primaryTarget = useMemo(() => {
    return (
      targets.find((target) => target.kind === "application") ??
      targets.find((target) => target.kind === "file-manager") ??
      targets[0] ??
      null
    )
  }, [targets])

  useEffect(() => {
    if (!folderPath) {
      return
    }

    let cancelled = false

    window.api.openTargets.list({ folderPath }).then((response) => {
      if (!cancelled) {
        setTargetState({
          folderPath,
          targets: response.targets
        })
      }
    })

    return () => {
      cancelled = true
    }
  }, [folderPath])

  function openTarget(targetId: string): void {
    if (!folderPath) {
      return
    }

    void window.api.openTargets.open({ folderPath, targetId })
  }

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
            openTarget(primaryTarget.id)
          }
        }}
      >
        {primaryTarget ? (
          getTargetIcon(primaryTarget)
        ) : (
          <FolderOpen className="size-[var(--ow-icon-sm)]" />
        )}
      </button>
      <DropdownMenu.Root open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={labels.openTarget}
            disabled={!folderPath}
            title={labels.openTarget}
            onMouseDown={(event) => event.preventDefault()}
            className={cn(
              "launcher-ai-open-target-control__chevron launcher-icon-button",
              "data-[state=open]:bg-background-secondary/70 data-[state=open]:text-foreground"
            )}
          >
            <ChevronDown className="size-[var(--ow-icon-xs)]" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
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
                  openTarget(target.id)
                }}
              >
                {target.label}
              </LauncherAiMenuItem>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}
