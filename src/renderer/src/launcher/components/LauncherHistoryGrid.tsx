import { Pin } from "lucide-react"
import { cn } from "@/lib/utils"
import { getLauncherResultToneStyle, renderLauncherResultIcon } from "../result-presentation"
import type { LauncherShellItem } from "../types"

export function LauncherHistoryGrid(props: {
  items: LauncherShellItem[]
  onExecute: (index: number) => void
  selectedIndex: number
}): React.JSX.Element | null {
  const { items, onExecute, selectedIndex } = props

  if (items.length === 0) {
    return null
  }

  return (
    <div className="grid grid-cols-8 border-t border-dashed border-[var(--launcher-border)]">
      {items.map((item, index) => {
        const isSelected = index === selectedIndex

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onExecute(index)}
            onMouseDown={(event) => event.preventDefault()}
            className={cn(
              "relative flex h-[70px] appearance-none flex-col items-center justify-center gap-1.5 border-0 border-r border-dashed border-[var(--launcher-border)] px-2 text-center transition",
              "text-foreground",
              isSelected && "bg-[var(--launcher-item-hover)]"
            )}
          >
            {item.pin ? (
              <span className="absolute right-1.5 top-1.5 text-[var(--launcher-accent-line)]">
                <Pin className="size-3 fill-current" strokeWidth={1.8} />
              </span>
            ) : null}

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
        )
      })}
    </div>
  )
}
