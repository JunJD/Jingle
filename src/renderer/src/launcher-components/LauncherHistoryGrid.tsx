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
import { getLauncherResultToneStyle, renderLauncherResultIcon } from "@launcher-shell/result-presentation"
import type { LauncherShellItem } from "@launcher-shell/types"

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
                    "flex h-full w-full appearance-none flex-col items-center justify-center gap-2 border-0 px-2 pb-2 pt-3 text-center transition",
                    "text-foreground",
                    isSelected && "bg-[var(--launcher-item-hover)]"
                  )}
                >
                  <span
                    className="flex h-7 w-7 items-center justify-center overflow-hidden"
                    style={getLauncherResultToneStyle(item.presentation.tone)}
                  >
                    {renderLauncherResultIcon(item.presentation.icon)}
                  </span>

                  <span className="line-clamp-1 w-full text-[12px] leading-[1.2] text-foreground/92">
                    {item.title}
                  </span>
                </button>
              </ContextMenuTrigger>

              <ContextMenuContent>
                <ContextMenuItem onClick={() => onSetPinned(item.id, !item.pin)}>
                  {item.pin ? (
                    <PinOff className="size-4" strokeWidth={1.8} />
                  ) : (
                    <Pin className="size-4" strokeWidth={1.8} />
                  )}
                  {item.pin ? copy.launcher.unpinHistoryItem : copy.launcher.pinHistoryItem}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onClick={() => onRemove(item.id)}>
                  <Trash2 className="size-4" strokeWidth={1.8} />
                  {copy.launcher.removeHistoryItem}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>

            {item.pin ? (
              <div className="pointer-events-none absolute right-1 top-1 h-0 w-0 border-t-[6px] border-r-[6px] border-t-[var(--launcher-pin-indicator)] border-r-[var(--launcher-pin-indicator)] border-l-[6px] border-b-[6px] border-l-transparent border-b-transparent" />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
