import { ChevronRight, LoaderCircle, MoreHorizontal } from "lucide-react"
import { useMemo, useRef, type ReactNode } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { useSelectedRowScrollIntoView } from "@launcher-components/useSelectedRowScrollIntoView"

export const nativeSurfaceListDropdownClassName =
  "h-[var(--ow-control-h-md)] max-w-[var(--launcher-dropdown-max-width)] appearance-none rounded-[var(--ow-radius-md)] border border-border/80 bg-background pl-[var(--ow-space-3)] pr-[var(--ow-space-6)] [font-size:var(--ow-font-meta)] font-medium text-foreground outline-none transition focus:border-[var(--ring)]"

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

export function NativeSurfaceListRows(props: {
  onExecute: (index: number) => void
  onOpenActions: (index: number) => void
  onSelect: (index: number) => void
  sections: NativeSurfaceListSectionPresentation[]
  selectedIndex: number
}): React.JSX.Element | null {
  const { onExecute, onOpenActions, onSelect, sections, selectedIndex } = props
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
      <div className="py-[var(--ow-space-2)]">
        {indexedSections.map((section) => (
          <div key={section.id}>
            {section.title ? (
              <div className="flex h-[var(--ow-section-h)] items-center justify-between gap-[var(--ow-gap-md)] px-[var(--launcher-list-section-x)] [font-size:var(--ow-font-meta)] font-semibold text-muted-foreground">
                <span>{section.title}</span>
                {section.subtitle ? (
                  <span className="[font-size:var(--ow-font-caption)] font-medium">
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
                    "mx-[var(--launcher-list-row-x)] grid h-[var(--ow-row-h-md)] grid-cols-[minmax(0,1fr)_auto] items-center gap-[var(--ow-space-2-5)] rounded-[var(--ow-radius-md)] px-[var(--launcher-list-row-padding-x)] text-left transition",
                    isSelected ? "bg-background-secondary" : "hover:bg-background-secondary/60"
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-[var(--ow-gap-md)]">
                      {item.icon ? (
                        <div className="flex h-[var(--ow-icon-md)] w-[var(--ow-icon-md)] shrink-0 items-center justify-center text-muted-foreground">
                          {item.icon}
                        </div>
                      ) : null}
                      <div className="min-w-0">
                        <div className="truncate [font-size:var(--ow-font-body)] font-medium text-foreground">
                          {item.title}
                        </div>
                        {item.subtitle ? (
                          <div className="truncate [font-size:var(--ow-font-meta)] text-muted-foreground">
                            {item.subtitle}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-[var(--ow-gap-md)]">
                    {item.accessory ? (
                      <div className="flex shrink-0 items-center gap-[var(--ow-gap-xs)] text-muted-foreground">
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
                        <MoreHorizontal className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />
                      </div>
                    ) : item.actionLabel ? (
                      <div className="flex items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-caption)] text-muted-foreground">
                        <span>{item.actionLabel}</span>
                        <ChevronRight className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

export function NativeSurfaceListEmptyState(props: {
  actionTitle?: string
  description?: string
  isLoading?: boolean
  onAction?: () => void
  title?: string
}): React.JSX.Element {
  const { actionTitle, description, isLoading = false, onAction, title } = props

  return (
    <div className="flex flex-1 items-center justify-center px-[var(--ow-space-6)]">
      {isLoading ? (
        <div className="flex items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-body)] text-muted-foreground">
          <LoaderCircle className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)] animate-spin" />
          <span>Loading...</span>
        </div>
      ) : title || description || onAction ? (
        <div className="max-w-[var(--ow-empty-max-w)] space-y-[var(--ow-space-3)] text-center">
          <div className="space-y-[var(--ow-space-1)]">
            <div className="[font-size:var(--ow-font-title)] font-semibold text-foreground">
              {title ?? "No items"}
            </div>
            {description ? (
              <div className="[font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-muted-foreground">
                {description}
              </div>
            ) : null}
          </div>
          {onAction ? (
            <button
              type="button"
              onClick={onAction}
              onMouseDown={(event) => event.preventDefault()}
              className="inline-flex h-[var(--ow-control-h-md)] items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-md)] border border-border bg-background px-[var(--ow-space-3)] [font-size:var(--ow-font-control)] font-medium text-foreground transition hover:bg-background-secondary"
            >
              <span>{actionTitle ?? "Open"}</span>
              <ChevronRight className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
            </button>
          ) : null}
        </div>
      ) : (
        <div className="[font-size:var(--ow-font-body)] text-muted-foreground">No items</div>
      )}
    </div>
  )
}
