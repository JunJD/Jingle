import { CircleMinus, CirclePlus } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import {
  getLauncherResultToneStyle,
  renderLauncherResultIcon
} from "@launcher-shell/result-presentation"
import { getLauncherIndexedCommandIcon } from "@launcher-shell/search-items"
import { getLauncherCommandAddressKey } from "@launcher-shell/use-with-preferences"
import type { LauncherIndexedCommand } from "@launcher-shell/pages"

function LauncherUseWithManagerSection(props: {
  commands: LauncherIndexedCommand[]
  enabled: boolean
  onSetCommandEnabled: (command: LauncherIndexedCommand, enabled: boolean) => void
  title: string
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const { commands, enabled, onSetCommandEnabled, title } = props
  const actionLabel = enabled
    ? copy.launcher.useWithDisableCommand
    : copy.launcher.useWithEnableCommand

  if (commands.length === 0) {
    return null
  }

  return (
    <section>
      <div className="flex h-[var(--ow-section-h)] items-center px-[var(--launcher-result-section-x)] [font-size:var(--ow-font-meta)] font-semibold text-muted-foreground">
        <span>
          {title} · {commands.length}
        </span>
      </div>

      {commands.map((command) => (
        <button
          key={getLauncherCommandAddressKey(command.address)}
          type="button"
          className={cn(
            "launcher-result-row relative mx-[var(--launcher-result-row-x)] grid h-[var(--ow-row-h-md)] w-[calc(100%-(var(--launcher-result-row-x)*2))] appearance-none grid-cols-[var(--launcher-result-icon-column)_minmax(0,1fr)_var(--launcher-result-trailing-column)] items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-md)] border-0 px-[var(--launcher-result-row-padding-x)] text-left transition hover:bg-[var(--launcher-item-hover)]",
            enabled && "text-foreground"
          )}
          onClick={() => onSetCommandEnabled(command, !enabled)}
          onMouseDown={(event) => event.preventDefault()}
        >
          <div
            className="flex h-[var(--ow-icon-md)] w-[var(--ow-icon-md)] shrink-0 items-center justify-center overflow-hidden rounded-[var(--ow-radius-sm)]"
            style={getLauncherResultToneStyle("neutral")}
          >
            {renderLauncherResultIcon(getLauncherIndexedCommandIcon(command))}
          </div>

          <div className="min-w-0">
            <div className="truncate [font-size:var(--ow-font-body)] font-medium leading-[var(--ow-line-tight)] text-foreground">
              {command.title}
            </div>
            <div className="mt-[var(--ow-leading-nudge)] truncate [font-size:var(--ow-font-meta)] leading-[var(--ow-line-tight)] text-muted-foreground">
              {enabled
                ? [command.ownerTitle, command.description].filter(Boolean).join(" · ")
                : copy.launcher.useWithDisabledSubtitle}
            </div>
          </div>

          <div className="flex items-center justify-end gap-[var(--ow-space-1-5)] [font-size:var(--ow-font-meta)] font-medium text-muted-foreground">
            {enabled ? (
              <CircleMinus className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
            ) : (
              <CirclePlus className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
            )}
            <span>{actionLabel}</span>
          </div>
        </button>
      ))}
    </section>
  )
}

export function LauncherUseWithManager(props: {
  availableCommands: LauncherIndexedCommand[]
  enabledCommands: LauncherIndexedCommand[]
  height: number
  onSetCommandEnabled: (command: LauncherIndexedCommand, enabled: boolean) => void
}): React.JSX.Element {
  const { copy } = useI18n()
  const { availableCommands, enabledCommands, height, onSetCommandEnabled } = props

  return (
    <ScrollArea
      data-surface="launcher-use-with-manager"
      style={{ backgroundColor: "transparent", height }}
    >
      <LauncherUseWithManagerSection
        commands={enabledCommands}
        enabled
        onSetCommandEnabled={onSetCommandEnabled}
        title={copy.launcher.useWithEnabled}
      />
      <LauncherUseWithManagerSection
        commands={availableCommands}
        enabled={false}
        onSetCommandEnabled={onSetCommandEnabled}
        title={copy.launcher.useWithAvailable}
      />
    </ScrollArea>
  )
}
