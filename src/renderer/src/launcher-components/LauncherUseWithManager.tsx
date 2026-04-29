import { CircleMinus, CirclePlus } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import {
  getLauncherResultToneStyle,
  renderLauncherResultIcon
} from "@launcher-shell/result-presentation"
import { getLauncherCommandAddressKey } from "@launcher-shell/use-with-preferences"
import type { LauncherIndexedCommand } from "@launcher-shell/pages"

function LauncherUseWithManagerSection(props: {
  commands: LauncherIndexedCommand[]
  enabled: boolean
  onSetCommandEnabled: (command: LauncherIndexedCommand, enabled: boolean) => void
  title: string
}): React.JSX.Element {
  const { copy } = useI18n()
  const { commands, enabled, onSetCommandEnabled, title } = props
  const actionLabel = enabled
    ? copy.launcher.useWithDisableCommand
    : copy.launcher.useWithEnableCommand

  return (
    <section>
      <div className="flex h-6 items-center px-6 text-[11px] font-semibold text-muted-foreground">
        <span>
          {title} · {commands.length}
        </span>
      </div>

      {commands.map((command) => (
        <button
          key={getLauncherCommandAddressKey(command.address)}
          type="button"
          className={cn(
            "launcher-result-row relative mx-2.5 grid h-11 w-[calc(100%-1.25rem)] appearance-none grid-cols-[26px_minmax(0,1fr)_88px] items-center gap-2 rounded-[var(--ow-radius-md)] border-0 px-3 text-left transition hover:bg-[var(--launcher-item-hover)]",
            enabled && "text-foreground"
          )}
          onClick={() => onSetCommandEnabled(command, !enabled)}
          onMouseDown={(event) => event.preventDefault()}
        >
          <div
            className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-[6px]"
            style={getLauncherResultToneStyle("neutral")}
          >
            {renderLauncherResultIcon({
              name: command.iconName ?? "search",
              type: "glyph"
            })}
          </div>

          <div className="min-w-0">
            <div className="truncate text-[var(--ow-font-body)] font-medium leading-[1.15] text-foreground">
              {command.title}
            </div>
            <div className="mt-0.5 truncate text-[var(--ow-font-meta)] leading-[1.15] text-muted-foreground">
              {enabled
                ? [command.ownerTitle, command.description].filter(Boolean).join(" · ")
                : copy.launcher.useWithDisabledSubtitle}
            </div>
          </div>

          <div className="flex items-center justify-end gap-1.5 text-[var(--ow-font-meta)] font-medium text-muted-foreground">
            {enabled ? (
              <CircleMinus className="h-3.5 w-3.5" />
            ) : (
              <CirclePlus className="h-3.5 w-3.5" />
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
