import { useLayoutEffect, useRef } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { truncateMiddle } from "@/lib/utils"
import { History, Search, Sparkles } from "lucide-react"
import type { LauncherShellItem } from "../types"

function getResultIcon(kind: LauncherShellItem["kind"]): React.JSX.Element {
  switch (kind) {
    case "application":
      return <Search className="size-4" />
    case "ai":
      return <Sparkles className="size-4" />
    case "history":
      return <History className="size-4" />
    default:
      return <Search className="size-4" />
  }
}

function getChipStyle(kind: LauncherShellItem["kind"]): React.CSSProperties {
  switch (kind) {
    case "application":
      return {
        backgroundColor: "var(--launcher-app-chip-bg)",
        color: "var(--launcher-app-chip-fg)"
      }
    case "ai":
      return {
        backgroundColor: "var(--launcher-ai-chip-bg)",
        color: "var(--launcher-ai-chip-fg)"
      }
    case "history":
      return {
        backgroundColor: "var(--launcher-history-chip-bg)",
        color: "var(--launcher-history-chip-fg)"
      }
    default:
      return {
        backgroundColor: "var(--launcher-history-chip-bg)",
        color: "var(--launcher-history-chip-fg)"
      }
  }
}

function renderTitle(title: string, match?: [number, number]): React.JSX.Element | string {
  if (!match || match[0] < 0 || match[1] < match[0]) {
    return title
  }

  const [start, end] = match

  return (
    <>
      {title.slice(0, start)}
      <span style={{ color: "var(--status-critical)" }}>{title.slice(start, end + 1)}</span>
      {title.slice(end + 1)}
    </>
  )
}

export function LauncherResultList(props: {
  height: number
  items: LauncherShellItem[]
  onExecute: (index: number) => void
  selectedIndex: number
}): React.JSX.Element | null {
  const { height, items, onExecute, selectedIndex } = props
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  useLayoutEffect(() => {
    if (selectedIndex < 0) {
      return
    }

    const viewport = scrollAreaRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLDivElement | null
    const item = itemRefs.current[selectedIndex]

    if (!viewport || !item) {
      return
    }

    const tolerance = 2
    const viewportRect = viewport.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    const deltaTop = itemRect.top - viewportRect.top
    const deltaBottom = itemRect.bottom - viewportRect.bottom

    if (deltaTop < -tolerance) {
      viewport.scrollTop += deltaTop
      return
    }

    if (deltaBottom > tolerance) {
      viewport.scrollTop += deltaBottom
    }
  }, [selectedIndex, items.length])

  if (items.length === 0) {
    return null
  }

  return (
    <ScrollArea ref={scrollAreaRef} style={{ backgroundColor: "var(--launcher-surface)", height }}>
      {items.map((item, index) => {
        const isSelected = index === selectedIndex
        const isPlanned = item.availability === "planned"

        return (
          <button
            key={item.id}
            ref={(element) => {
              itemRefs.current[index] = element
            }}
            type="button"
            onClick={() => onExecute(index)}
            onMouseDown={(event) => event.preventDefault()}
            className="flex h-[70px] w-full appearance-none items-center gap-3 border-0 pl-6 pr-6 text-left transition"
            style={{
              backgroundColor: isSelected
                ? "var(--launcher-row-active)"
                : "var(--launcher-surface)",
              borderBottom: "1px solid var(--launcher-border)",
              cursor: isPlanned ? "default" : "pointer",
              opacity: isPlanned ? 0.72 : 1
            }}
          >
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-none"
              style={getChipStyle(item.kind)}
            >
              {item.iconDataUrl ? (
                <img src={item.iconDataUrl} alt="" className="h-7 w-7 object-contain" />
              ) : (
                getResultIcon(item.kind)
              )}
            </div>

            <div className="min-w-0 flex flex-1 flex-col justify-center gap-1">
              <div className="truncate text-[14px] font-medium text-foreground">
                {renderTitle(item.title, item.match)}
              </div>
              <div className="truncate text-[13px] text-muted-foreground">
                {truncateMiddle(item.subtitle, 63, 14)}
              </div>
            </div>
          </button>
        )
      })}
    </ScrollArea>
  )
}
