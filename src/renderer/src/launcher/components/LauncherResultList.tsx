import { useLayoutEffect, useRef } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn, truncateMiddle } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import { FileText, Folder, History, Search, Sparkles } from "lucide-react"
import type { LauncherShellItem } from "../types"

function getResultIcon(kind: LauncherShellItem["kind"]): React.JSX.Element {
  switch (kind) {
    case "application":
      return <Search className="size-4" />
    case "file":
      return <FileText className="size-4" />
    case "directory":
      return <Folder className="size-4" />
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
    case "file":
    case "directory":
      return {
        backgroundColor: "var(--launcher-history-chip-bg)",
        color: "var(--launcher-history-chip-fg)"
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
  const { copy } = useI18n()
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
            className={cn(
              "relative grid h-auto w-full appearance-none grid-cols-[84px_minmax(0,1fr)_92px] items-start gap-4 border-0 px-6 py-4 text-left transition",
              "border-t border-[var(--launcher-border)] first:border-t-0",
              isSelected &&
                "before:absolute before:bottom-4 before:left-0 before:top-4 before:w-[3px] before:rounded-full before:bg-[var(--launcher-accent-line)]"
            )}
            style={{
              backgroundColor: isSelected
                ? "var(--launcher-row-active)"
                : "var(--launcher-surface)",
              cursor: isPlanned ? "default" : "pointer",
              opacity: isPlanned ? 0.72 : 1
            }}
          >
            <div className="pt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {item.kind === "application"
                ? copy.launcher.resultKindApp
                : item.kind === "file"
                  ? copy.launcher.resultKindFile
                  : item.kind === "directory"
                    ? copy.launcher.resultKindDirectory
                    : item.kind === "ai"
                      ? copy.launcher.resultKindAgent
                      : copy.launcher.resultKindThread}
            </div>

            <div className="min-w-0">
              <div className="flex min-w-0 items-start gap-3">
                <div
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden"
                  style={getChipStyle(item.kind)}
                >
                  {item.iconDataUrl ? (
                    <img src={item.iconDataUrl} alt="" className="h-5 w-5 object-contain" />
                  ) : (
                    getResultIcon(item.kind)
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-medium text-foreground">
                    {renderTitle(item.title, item.match)}
                  </div>
                  <div className="mt-1 truncate text-[13px] text-muted-foreground">
                    {truncateMiddle(item.subtitle, 63, 14)}
                  </div>
                </div>
              </div>
            </div>

            <div className="justify-self-end pt-0.5 text-[12px] text-muted-foreground">
              {isPlanned
                ? copy.launcher.planned
                : item.kind === "application"
                  ? copy.launcher.enter
                  : copy.launcher.openGeneric}
            </div>
          </button>
        )
      })}
    </ScrollArea>
  )
}
