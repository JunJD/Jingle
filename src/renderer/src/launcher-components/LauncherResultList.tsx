import { useRef } from "react"
import { Settings2 } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useI18n } from "@/lib/i18n"
import { cn, truncateMiddle } from "@/lib/utils"
import {
  getLauncherResultToneStyle,
  renderLauncherResultIcon
} from "@launcher-shell/result-presentation"
import type { LauncherHomeSurfaceSection } from "@launcher-shell/home-surface"
import type { LauncherShellItem } from "@launcher-shell/types"
import { useSelectedRowScrollIntoView } from "./useSelectedRowScrollIntoView"

const SECTION_HEADER_LABEL_START_LENGTH = 34
const SECTION_HEADER_LABEL_END_LENGTH = 12

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
  section: LauncherHomeSurfaceSection,
  copy: ReturnType<typeof useI18n>["copy"]
): string | null {
  if (section.title) {
    return section.title
  }

  switch (section.kind) {
    case "commands":
      return null
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
  if (item.trailingLabel) {
    return item.trailingLabel
  }

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

function getLauncherResultScrollKey(item: LauncherShellItem | undefined): string | null {
  if (!item) {
    return null
  }

  if (item.commandRef) {
    switch (item.commandRef.kind) {
      case "built-in-command":
        return `command:${item.commandRef.builtInId}:${item.commandRef.commandName}`
      case "extension-command":
        return `command:${item.commandRef.extensionName}:${item.commandRef.commandName}`
    }
  }

  if (item.command?.type === "replace-query") {
    return "suggestion:complete-query"
  }

  if (item.kind === "suggestion" && item.action.type === "open-url") {
    return "suggestion:browser-search"
  }

  return item.id
}

export function LauncherResultList(props: {
  height: number
  onExecute: (index: number) => void
  onSectionAction?: (action: NonNullable<LauncherHomeSurfaceSection["action"]>) => void
  sections: LauncherHomeSurfaceSection[]
  selectedIndex: number
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const { height, onExecute, onSectionAction, sections, selectedIndex } = props
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const items = sections.flatMap((section) => section.items)
  const selectedItemKey = getLauncherResultScrollKey(items[selectedIndex])

  useSelectedRowScrollIntoView({
    itemRefs,
    scrollAreaRef,
    selectedItemKey,
    selectedIndex
  })

  if (items.length === 0) {
    return null
  }

  const sectionRows = sections.flatMap((section, sectionIndex) => {
    const precedingItemsCount = sections
      .slice(0, sectionIndex)
      .reduce((count, currentSection) => count + currentSection.items.length, 0)

    return [
      {
        action: section.action,
        key: `header:${section.kind}`,
        kind: "header" as const,
        label: getSectionLabel(section, copy)
      },
      ...section.items.map((item, itemIndex) => ({
        index: precedingItemsCount + itemIndex,
        item,
        key: getLauncherResultScrollKey(item) ?? item.id,
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

          const sectionAction = row.action

          return (
            <div
              key={row.key}
              className="flex h-[var(--ow-section-h)] items-center px-[var(--launcher-result-section-x)] [font-size:var(--ow-font-meta)] font-semibold text-muted-foreground"
            >
              <div className="flex min-w-0 items-center gap-[var(--ow-gap-sm)]">
                <span className="block max-w-[420px] truncate" title={row.label}>
                  {truncateMiddle(
                    row.label,
                    SECTION_HEADER_LABEL_START_LENGTH,
                    SECTION_HEADER_LABEL_END_LENGTH
                  )}
                </span>
                {sectionAction ? (
                  <button
                    type="button"
                    className="launcher-action-link flex h-5 w-5 shrink-0 appearance-none items-center justify-center rounded-[6px] border-0 text-muted-foreground transition hover:text-foreground"
                    title={sectionAction.title}
                    aria-label={sectionAction.title}
                    onClick={() => onSectionAction?.(sectionAction)}
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
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
              "launcher-result-row relative mx-[var(--launcher-result-row-x)] grid h-[var(--ow-row-h-md)] w-[calc(100%-(var(--launcher-result-row-x)*2))] appearance-none grid-cols-[var(--launcher-result-icon-column)_minmax(0,1fr)_var(--launcher-result-trailing-column)] items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-md)] border-0 px-[var(--launcher-result-row-padding-x)] text-left transition",
              isSelected && "launcher-result-row--selected"
            )}
            style={{
              cursor: isPlanned ? "default" : "pointer",
              opacity: isPlanned ? 0.72 : 1
            }}
          >
            <div
              className="flex h-[var(--ow-icon-md)] w-[var(--ow-icon-md)] shrink-0 items-center justify-center overflow-hidden rounded-[var(--ow-radius-sm)]"
              style={getLauncherResultToneStyle(row.item.presentation.tone)}
            >
              {renderLauncherResultIcon(row.item.presentation.icon)}
            </div>

            <div className="min-w-0">
              <div className="truncate [font-size:var(--ow-font-body)] font-medium leading-[var(--ow-line-tight)] text-foreground">
                {renderTitle(row.item.title, row.item.match)}
              </div>
              <div className="mt-[var(--ow-leading-nudge)] truncate [font-size:var(--ow-font-meta)] leading-[var(--ow-line-tight)] text-muted-foreground">
                {truncateMiddle(row.item.subtitle, 72, 16)}
              </div>
            </div>

            <div className="justify-self-end text-right [font-size:var(--ow-font-meta)] font-medium text-muted-foreground">
              {getResultTrailingLabel(row.item, copy)}
            </div>
          </button>
        )
      })}
    </ScrollArea>
  )
}
