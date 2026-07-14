import { ChevronRight, LoaderCircle, MoreHorizontal } from "lucide-react"
import { useMemo, useRef, type ReactNode } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { useSelectedRowScrollIntoView } from "@launcher-components/useSelectedRowScrollIntoView"

export const nativeSurfaceListDropdownClassName =
  "h-[var(--jingle-control-h-md)] max-w-[var(--launcher-dropdown-max-width)] appearance-none rounded-[var(--jingle-radius-md)] border border-border/80 bg-background pl-[var(--jingle-space-3)] pr-[var(--jingle-space-6)] [font-size:var(--jingle-font-meta)] font-medium text-foreground outline-none transition focus:border-[var(--ring)]"

export interface NativeSurfaceListItemPresentation {
  accessory?: ReactNode
  actionLabel?: string
  hasActionPanel: boolean
  icon?: ReactNode
  id: string
  subtitle?: string
  title: string
}

export interface NativeSurfaceListSectionPresentation {
  id: string
  items: NativeSurfaceListItemPresentation[]
  subtitle?: string
  title?: string
}

export type NativeSurfaceListEmptyPresentation =
  | {
      kind: "loading"
      label: string
    }
  | {
      action?: {
        execute: () => void
        title: string
      }
      description?: string
      kind: "ready"
      title: string
    }
  | {
      description: string
      kind: "invalid"
      title: string
    }

export function NativeSurfaceListRows(props: {
  isLoadingMore?: boolean
  onLoadMore?: () => void
  onExecute: (index: number) => void
  onOpenActions: (index: number) => void
  onSelect: (index: number) => void
  sections: NativeSurfaceListSectionPresentation[]
  selectedIndex: number
}): React.JSX.Element | null {
  const { isLoadingMore = false, onExecute, onLoadMore, onOpenActions, onSelect, sections, selectedIndex } = props
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Array<HTMLDivElement | null>>([])
  const indexedSections = useMemo(
    () =>
      sections.map((section, sectionIndex) => {
        const sectionStartIndex = sections
          .slice(0, sectionIndex)
          .reduce((count, current) => count + current.items.length, 0)

        return {
          ...section,
          indexedItems: section.items.map((item, itemIndex) => ({
            index: sectionStartIndex + itemIndex,
            item
          }))
        }
      }),
    [sections]
  )
  const items = indexedSections.flatMap((section) =>
    section.indexedItems.map((indexedItem) => indexedItem.item)
  )
  const itemsKey = items.map((item) => item.id).join("|")
  const activeSelectedIndex = Math.min(selectedIndex, Math.max(items.length - 1, 0))

  useSelectedRowScrollIntoView({
    itemRefs,
    itemsKey,
    scrollAreaRef,
    selectedIndex: activeSelectedIndex,
    tolerance: 0
  })

  if (items.length === 0) {
    return null
  }

  return (
    <ScrollArea ref={scrollAreaRef} className="flex-1">
      <div className="py-[var(--jingle-space-2)]">
        {indexedSections.map((section) => (
          <div key={section.id}>
            {section.title ? (
              <div className="flex h-[var(--jingle-section-h)] items-center justify-between gap-[var(--jingle-gap-md)] px-[var(--launcher-list-section-x)] [font-size:var(--jingle-font-meta)] font-semibold text-muted-foreground">
                <span>{section.title}</span>
                {section.subtitle ? (
                  <span className="[font-size:var(--jingle-font-caption)] font-medium">
                    {section.subtitle}
                  </span>
                ) : null}
              </div>
            ) : null}
            {section.indexedItems.map(({ index, item }) => {
              const isSelected = index === activeSelectedIndex

              return (
                <div
                  key={item.id}
                  ref={(element) => {
                    itemRefs.current[index] = element
                  }}
                  role="button"
                  tabIndex={-1}
                  onClick={() => onExecute(index)}
                  onMouseEnter={() => onSelect(index)}
                  className={cn(
                    "mx-[var(--launcher-list-row-x)] grid h-[var(--jingle-row-h-md)] grid-cols-[minmax(0,1fr)_auto] items-center gap-[var(--jingle-space-2-5)] rounded-[var(--jingle-radius-md)] px-[var(--launcher-list-row-padding-x)] text-left transition",
                    isSelected ? "bg-background-secondary" : "hover:bg-background-secondary/60"
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-[var(--jingle-gap-md)]">
                      {item.icon ? (
                        <div className="flex h-[var(--jingle-icon-md)] w-[var(--jingle-icon-md)] shrink-0 items-center justify-center text-muted-foreground">
                          {item.icon}
                        </div>
                      ) : null}
                      <div className="min-w-0">
                        <div className="truncate [font-size:var(--jingle-font-body)] font-medium text-foreground">
                          {item.title}
                        </div>
                        {item.subtitle ? (
                          <div className="truncate [font-size:var(--jingle-font-meta)] text-muted-foreground">
                            {item.subtitle}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-[var(--jingle-gap-md)]">
                    {item.accessory ? (
                      <div className="flex shrink-0 items-center gap-[var(--jingle-gap-xs)] text-muted-foreground">
                        {item.accessory}
                      </div>
                    ) : null}
                    {item.hasActionPanel && isSelected ? (
                      <div
                        onClick={(event) => {
                          event.stopPropagation()
                          onOpenActions(index)
                        }}
                        className="flex h-[var(--launcher-action-control-h)] w-[var(--launcher-action-control-h)] items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground"
                      >
                        <MoreHorizontal className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />
                      </div>
                    ) : item.actionLabel ? (
                      <div className="flex items-center gap-[var(--jingle-gap-sm)] [font-size:var(--jingle-font-caption)] text-muted-foreground">
                        <span>{item.actionLabel}</span>
                        <ChevronRight className="h-[var(--jingle-icon-sm)] w-[var(--jingle-icon-sm)]" />
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
        {onLoadMore ? (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="mx-[var(--launcher-list-row-x)] mt-[var(--jingle-space-1)] flex h-[var(--jingle-row-h-md)] w-[calc(100%-(var(--launcher-list-row-x)*2))] items-center justify-center gap-[var(--jingle-gap-sm)] rounded-[var(--jingle-radius-md)] px-[var(--launcher-list-row-padding-x)] [font-size:var(--jingle-font-body)] font-medium text-muted-foreground transition hover:bg-background-secondary/60 hover:text-foreground disabled:opacity-60"
          >
            {isLoadingMore ? (
              <LoaderCircle className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)] animate-spin" />
            ) : null}
            <span>{isLoadingMore ? "Loading..." : "Load More"}</span>
          </button>
        ) : null}
      </div>
    </ScrollArea>
  )
}

export function NativeSurfaceListEmptyState(props: {
  presentation: NativeSurfaceListEmptyPresentation
}): React.JSX.Element {
  const { presentation } = props

  return (
    <div className="flex flex-1 items-center justify-center px-[var(--jingle-space-6)]">
      {presentation.kind === "loading" ? (
        <div className="flex items-center gap-[var(--jingle-gap-sm)] [font-size:var(--jingle-font-body)] text-muted-foreground">
          <LoaderCircle className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)] animate-spin" />
          <span>{presentation.label}</span>
        </div>
      ) : (
        <div className="max-w-[var(--jingle-empty-max-w)] space-y-[var(--jingle-space-3)] text-center">
          <div className="space-y-[var(--jingle-space-1)]">
            <div className="[font-size:var(--jingle-font-title)] font-semibold text-foreground">
              {presentation.title}
            </div>
            {presentation.description ? (
              <div className="[font-size:var(--jingle-font-body)] leading-[var(--jingle-line-chat)] text-muted-foreground">
                {presentation.description}
              </div>
            ) : null}
          </div>
          {presentation.kind === "ready" && presentation.action ? (
            <button
              type="button"
              onClick={presentation.action.execute}
              onMouseDown={(event) => event.preventDefault()}
              className="inline-flex h-[var(--jingle-control-h-md)] items-center gap-[var(--jingle-gap-sm)] rounded-[var(--jingle-radius-md)] border border-border bg-background px-[var(--jingle-space-3)] [font-size:var(--jingle-font-control)] font-medium text-foreground transition hover:bg-background-secondary"
            >
              <span>{presentation.action.title}</span>
              <ChevronRight className="h-[var(--jingle-icon-sm)] w-[var(--jingle-icon-sm)]" />
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}
