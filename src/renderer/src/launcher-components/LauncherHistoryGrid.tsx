import { Pin, PinOff, Trash2 } from "lucide-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { getLauncherResultToneStyle } from "@launcher-shell/result-presentation"
import { LauncherResultIconGraphic } from "@launcher-shell/result-icon"
import type { LauncherShellItem } from "@launcher-shell/types"

const historyMenuItemClassName =
  "gap-[var(--jingle-gap-sm)] px-[var(--jingle-space-2)] py-[var(--jingle-space-1)] [font-size:var(--jingle-font-control)] font-medium leading-[var(--jingle-line-body)]"

function LauncherHistoryItemIcon(props: { item: LauncherShellItem }): React.JSX.Element {
  const { item } = props

  return (
    <span
      className="flex h-[var(--launcher-history-icon-size)] w-[var(--launcher-history-icon-size)] items-center justify-center overflow-hidden"
      style={getLauncherResultToneStyle(item.presentation.tone)}
    >
      <LauncherResultIconGraphic icon={item.presentation.icon} />
    </span>
  )
}

export function LauncherHistoryGrid(props: {
  height: number
  items: LauncherShellItem[]
  onExecute: (index: number) => void
  onRemove: (itemId: string) => void
  onSetPinned: (itemId: string, pin: boolean) => void
  selectedIndex: number
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const { height, items, onExecute, onRemove, onSetPinned, selectedIndex } = props

  if (items.length === 0) {
    return null
  }

  return (
    <div
      className="grid grid-cols-8 overflow-hidden border-t border-dashed border-[var(--launcher-border)]"
      style={{ gridAutoRows: "minmax(0, 1fr)", height }}
    >
      {items.map((item, index) => {
        const isSelected = index === selectedIndex

        return (
          <div
            key={item.id}
            className={cn(
              "relative h-full border-r border-dashed border-[var(--launcher-border)]",
              "text-foreground"
            )}
          >
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  onClick={() => onExecute(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  className={cn(
                    "flex h-full w-full appearance-none flex-col items-center justify-center gap-[var(--jingle-gap-sm)] border-0 px-[var(--jingle-space-2)] pb-[var(--jingle-space-2)] pt-[var(--jingle-space-3)] text-center transition",
                    "text-foreground",
                    isSelected && "bg-[var(--launcher-item-hover)]"
                  )}
                >
                  <LauncherHistoryItemIcon item={item} />

                  <span className="w-full truncate [font-size:var(--jingle-font-meta)] leading-[var(--jingle-line-body)] text-foreground/92">
                    {item.title}
                  </span>
                </button>
              </ContextMenuTrigger>

              <ContextMenuContent className="min-w-[166px]">
                <ContextMenuItem
                  className={historyMenuItemClassName}
                  onClick={() => onSetPinned(item.id, !item.pin)}
                >
                  {item.pin ? (
                    <PinOff className="size-[var(--jingle-icon-sm)]" strokeWidth={1.8} />
                  ) : (
                    <Pin className="size-[var(--jingle-icon-sm)]" strokeWidth={1.8} />
                  )}
                  {item.pin ? copy.launcher.unpinHistoryItem : copy.launcher.pinHistoryItem}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  className={historyMenuItemClassName}
                  variant="destructive"
                  onClick={() => onRemove(item.id)}
                >
                  <Trash2 className="size-[var(--jingle-icon-sm)]" strokeWidth={1.8} />
                  {copy.launcher.removeHistoryItem}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>

            {item.pin ? (
              <div className="pointer-events-none absolute right-[var(--jingle-space-1)] top-[var(--jingle-space-1)] h-0 w-0 border-b-[var(--launcher-history-pin-size)] border-l-[var(--launcher-history-pin-size)] border-r-[var(--launcher-history-pin-size)] border-t-[var(--launcher-history-pin-size)] border-b-transparent border-l-transparent border-r-[var(--launcher-pin-indicator)] border-t-[var(--launcher-pin-indicator)]" />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
