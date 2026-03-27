import { useLayoutEffect, useRef } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn, truncateMiddle } from "@/lib/utils"
import {
  getLauncherResultToneStyle,
  renderLauncherResultIcon
} from "../result-presentation"
import type { LauncherShellItem } from "../types"

function renderTitle(title: string, match?: [number, number]): React.JSX.Element | string {
  if (!match || match[0] < 0 || match[1] < match[0]) {
    return title
  }

  const [start, end] = match

  return (
    <>
      {title.slice(0, start)}
      <span style={{ color: "var(--launcher-accent-line)" }}>{title.slice(start, end + 1)}</span>
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
  const itemsKey = items.map((item) => item.id).join("|")

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
  }, [itemsKey, selectedIndex])

  if (items.length === 0) {
    return null
  }

  return (
    <ScrollArea ref={scrollAreaRef} style={{ backgroundColor: "transparent", height }}>
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
            className={cn(
              "launcher-result-row relative grid h-14 w-full appearance-none grid-cols-[72px_minmax(0,1fr)_80px] items-center gap-3 border-0 px-4 text-left transition",
              isSelected && "launcher-result-row--selected"
            )}
            style={{
              cursor: isPlanned ? "default" : "pointer",
              opacity: isPlanned ? 0.72 : 1
            }}
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {item.presentation.categoryLabel}
            </div>

            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2.5">
                <div
                  className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden"
                  style={getLauncherResultToneStyle(item.presentation.tone)}
                >
                  {renderLauncherResultIcon(item.presentation.icon)}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-medium leading-[1.15] text-foreground">
                    {renderTitle(item.title, item.match)}
                  </div>
                  <div className="mt-0.5 truncate text-[12px] leading-[1.15] text-muted-foreground">
                    {truncateMiddle(item.subtitle, 63, 14)}
                  </div>
                </div>
              </div>
            </div>

            <div className="justify-self-end text-[11px] font-medium text-muted-foreground">
              {item.presentation.listActionLabel}
            </div>
          </button>
        )
      })}
    </ScrollArea>
  )
}
