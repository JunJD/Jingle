import { useLayoutEffect, useRef } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useI18n } from "@/lib/i18n"
import { cn, truncateMiddle } from "@/lib/utils"
import {
  getLauncherResultToneStyle,
  renderLauncherResultIcon
} from "@launcher-shell/result-presentation"
import type {
  LauncherHomeSurfaceSection,
  LauncherHomeSurfaceSectionKind
} from "@launcher-shell/home-surface"
import type { LauncherShellItem } from "@launcher-shell/types"

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

function getSectionLabel(
  sectionKind: LauncherHomeSurfaceSectionKind,
  copy: ReturnType<typeof useI18n>["copy"]
): string | null {
  switch (sectionKind) {
    case "commands":
      return null
    case "command-intents":
      return copy.launcher.actionsLabel
    case "search-results":
      return copy.launcher.searchResults
    case "suggestions":
      return copy.launcher.suggestions
    default:
      return null
  }
}

function getResultTrailingLabel(
  item: LauncherShellItem,
  copy: ReturnType<typeof useI18n>["copy"]
): string {
  if (item.kind === "ai") {
    return copy.launcher.resultKindAgent
  }

  if (item.kind === "application") {
    return "Application"
  }

  if (item.kind === "plugin") {
    return "Command"
  }

  return copy.launcher.openGeneric
}

export function LauncherResultList(props: {
  height: number
  onExecute: (index: number) => void
  sections: LauncherHomeSurfaceSection[]
  selectedIndex: number
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const { height, onExecute, sections, selectedIndex } = props
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const items = sections.flatMap((section) => section.items)
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

  const sectionRows = sections.flatMap((section, sectionIndex) => {
    const precedingItemsCount = sections
      .slice(0, sectionIndex)
      .reduce((count, currentSection) => count + currentSection.items.length, 0)

    return [
      {
        key: `header:${section.kind}`,
        kind: "header" as const,
        label: getSectionLabel(section.kind, copy)
      },
      ...section.items.map((item, itemIndex) => ({
        index: precedingItemsCount + itemIndex,
        item,
        key: item.id,
        kind: "item" as const
      }))
    ]
  })

  return (
    <ScrollArea ref={scrollAreaRef} style={{ backgroundColor: "transparent", height }}>
      {sectionRows.map((row) => {
        if (row.kind === "header") {
          if (!row.label) {
            return row.key === "header:commands" ? (
              <div key={row.key} className="mx-6 my-2 h-px bg-border/70" aria-hidden="true" />
            ) : null
          }

          return (
            <div
              key={row.key}
              className="px-6 pb-1 pt-3 text-[12px] font-semibold text-muted-foreground"
            >
              {row.label}
            </div>
          )
        }

        const isSelected = row.index === selectedIndex
        const isPlanned = row.item.availability === "planned"

        return (
          <button
            key={row.key}
            ref={(element) => {
              itemRefs.current[row.index] = element
            }}
            type="button"
            onClick={() => onExecute(row.index)}
            onMouseDown={(event) => event.preventDefault()}
            className={cn(
              "launcher-result-row relative mx-3 grid h-14 w-[calc(100%-1.5rem)] appearance-none grid-cols-[32px_minmax(0,1fr)_104px] items-center gap-3 rounded-[12px] border-0 px-3 text-left transition",
              isSelected && "launcher-result-row--selected"
            )}
            style={{
              cursor: isPlanned ? "default" : "pointer",
              opacity: isPlanned ? 0.72 : 1
            }}
          >
            <div
              className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-[7px]"
              style={getLauncherResultToneStyle(row.item.presentation.tone)}
            >
              {renderLauncherResultIcon(row.item.presentation.icon)}
            </div>

            <div className="min-w-0">
              <div className="truncate text-[14px] font-medium leading-[1.15] text-foreground">
                {renderTitle(row.item.title, row.item.match)}
              </div>
              <div className="mt-0.5 truncate text-[12px] leading-[1.15] text-muted-foreground">
                {truncateMiddle(row.item.subtitle, 72, 16)}
              </div>
            </div>

            <div className="justify-self-end text-right text-[12px] font-medium text-muted-foreground">
              {getResultTrailingLabel(row.item, copy)}
            </div>
          </button>
        )
      })}
    </ScrollArea>
  )
}
