import { ChevronRight, MoreHorizontal } from "lucide-react"
import { useMemo, useRef, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { IconButton } from "@/components/ui/icon-button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { useSelectedRowScrollIntoView } from "@launcher-components/useSelectedRowScrollIntoView"

export const nativeSurfaceListDropdownClassName =
  "h-[var(--jingle-control-h-md)] max-w-[var(--launcher-dropdown-max-width)] appearance-none rounded-[var(--jingle-radius-md)] border border-border/80 bg-background pl-[var(--jingle-space-3)] pr-[var(--jingle-space-6)] [font-size:var(--jingle-font-meta)] font-medium text-foreground outline-none focus:border-[var(--ring)]"

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
  const {
    isLoadingMore = false,
    onExecute,
    onLoadMore,
    onOpenActions,
    onSelect,
    sections,
    selectedIndex
  } = props
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
      <div className="py-[var(--jingle-space-2)]" data-press-surface="instant">
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
                  onMouseEnter={() => onSelect(index)}
                  className={cn(
                    "mx-[var(--launcher-list-row-x)] grid h-[var(--jingle-row-h-md)] grid-cols-[minmax(0,1fr)_auto] items-center rounded-[var(--jingle-radius-md)] text-left",
                    isSelected ? "bg-background-secondary" : "hover:bg-background-secondary/60"
                  )}
                >
                  <Button
                    type="button"
                    tabIndex={-1}
                    className={cn(
                      "col-span-full row-start-1 grid h-full w-full grid-cols-[minmax(0,1fr)_auto] items-center justify-stretch gap-[var(--jingle-space-2-5)] whitespace-normal rounded-[var(--jingle-radius-md)] px-[var(--launcher-list-row-padding-x)] text-left font-normal hover:bg-transparent",
                      item.hasActionPanel && isSelected && "pr-[var(--jingle-control-icon-inset)]"
                    )}
                    onClick={() => onExecute(index)}
                    variant="ghost"
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
                      {!item.hasActionPanel && item.actionLabel ? (
                        <div className="flex items-center gap-[var(--jingle-gap-sm)] [font-size:var(--jingle-font-caption)] text-muted-foreground">
                          <span>{item.actionLabel}</span>
                          <ChevronRight className="h-[var(--jingle-icon-sm)] w-[var(--jingle-icon-sm)]" />
                        </div>
                      ) : null}
                    </div>
                  </Button>
                  {item.hasActionPanel && isSelected ? (
                    <IconButton
                      label="Open actions"
                      onClick={() => onOpenActions(index)}
                      className="col-start-2 row-start-1 mr-[var(--launcher-list-row-padding-x)] flex h-[var(--launcher-action-control-h)] w-[var(--launcher-action-control-h)] items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                      size="icon-sm"
                      tooltip={false}
                      variant="ghost"
                    >
                      <MoreHorizontal className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />
                    </IconButton>
                  ) : null}
                </div>
              )
            })}
          </div>
        ))}
        {onLoadMore ? (
          <Button
            type="button"
            onClick={onLoadMore}
            loading={isLoadingMore}
            loadingLabel="Loading"
            className="mx-[var(--launcher-list-row-x)] mt-[var(--jingle-space-1)] flex h-[var(--jingle-row-h-md)] w-[calc(100%-(var(--launcher-list-row-x)*2))] items-center justify-center gap-[var(--jingle-gap-sm)] rounded-[var(--jingle-radius-md)] px-[var(--launcher-list-row-padding-x)] [font-size:var(--jingle-font-body)] font-medium text-muted-foreground hover:bg-background-secondary/60 hover:text-foreground disabled:opacity-60"
            variant="ghost"
          >
            <span>Load More</span>
          </Button>
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
        <div
          aria-live="polite"
          className="flex items-center gap-[var(--jingle-gap-sm)] [font-size:var(--jingle-font-body)] text-muted-foreground"
          role="status"
        >
          <Spinner />
          <span>{presentation.label}</span>
        </div>
      ) : (
        <EmptyState
          className="p-0"
          description={presentation.description}
          title={presentation.title}
          action={
            presentation.kind === "ready" && presentation.action ? (
              <Button
                type="button"
                pressEffect="scale"
                onClick={presentation.action.execute}
                onMouseDown={(event) => event.preventDefault()}
                variant="outline"
              >
                <span>{presentation.action.title}</span>
                <ChevronRight className="h-[var(--jingle-icon-sm)] w-[var(--jingle-icon-sm)]" />
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  )
}
