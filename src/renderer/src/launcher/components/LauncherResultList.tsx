import { History, Search, Sparkles } from "lucide-react"
import type { LauncherResultItem } from "../../../../shared/launcher"

function getResultIcon(kind: LauncherResultItem["kind"]): React.JSX.Element {
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

function getChipStyle(kind: LauncherResultItem["kind"]): React.CSSProperties {
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

export function LauncherResultList(props: {
  items: LauncherResultItem[]
  selectedIndex: number
  onSelect: (index: number) => void
}): React.JSX.Element | null {
  const { items, selectedIndex, onSelect } = props

  if (items.length === 0) {
    return null
  }

  return (
    <div style={{ backgroundColor: "var(--launcher-surface)" }}>
      {items.map((item, index) => {
        const isSelected = index === selectedIndex
        const isPlanned = item.availability === "planned"

        return (
          <button
            key={item.id}
            type="button"
            onMouseEnter={() => onSelect(index)}
            onMouseDown={(event) => event.preventDefault()}
            className="flex h-14 w-full appearance-none items-center gap-3 border-0 pl-6 pr-8 text-left transition"
            style={{
              backgroundColor: isSelected
                ? "var(--launcher-row-active)"
                : "var(--launcher-surface)",
              opacity: isPlanned ? 0.72 : 1
            }}
          >
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
              style={getChipStyle(item.kind)}
            >
              {getResultIcon(item.kind)}
            </div>

            <div className="min-w-0 flex flex-1 items-baseline gap-3">
              <div className="truncate text-[14px] font-medium text-foreground">{item.title}</div>
              <div className="truncate text-[13px] text-muted-foreground">{item.subtitle}</div>
            </div>

            <div className="ml-4 min-w-[32px] shrink-0 pr-1 text-right text-[13px] text-muted-foreground">
              {item.trailingLabel}
            </div>
          </button>
        )
      })}
    </div>
  )
}
