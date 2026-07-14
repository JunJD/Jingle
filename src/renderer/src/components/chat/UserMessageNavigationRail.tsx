import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject
} from "react"
import type { VListHandle } from "virtua"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import "./user-message-navigation-rail.css"

export interface UserMessageNavigationItem {
  id: string
  label: string
  position: number
  rowIndex: number
}

interface UserMessageNavigationRailProps {
  items: readonly UserMessageNavigationItem[]
  scrollViewportId: string
  virtualizerRef: RefObject<VListHandle | null>
}

interface PreviewState {
  item: UserMessageNavigationItem
  top: number
}

const MIN_NAVIGATION_ITEM_COUNT = 4
const VIEWPORT_EDGE_INSET_PX = 16
const ACTIVE_MARKER_ANCHOR_RATIO = 0.35

function getScrollViewport(scrollViewportId: string): HTMLElement | null {
  return document.getElementById(scrollViewportId)
}

function getVisibleItemIds(
  items: readonly UserMessageNavigationItem[],
  virtualizer: VListHandle
): Set<string> {
  if (items.length === 0) {
    return new Set()
  }

  const viewportTop = virtualizer.scrollOffset
  const viewportBottom = viewportTop + virtualizer.viewportSize
  const visibleIds: string[] = []

  for (const item of items) {
    const itemTop = virtualizer.getItemOffset(item.rowIndex)
    const itemBottom = itemTop + virtualizer.getItemSize(item.rowIndex)
    if (
      itemBottom > viewportTop + VIEWPORT_EDGE_INSET_PX &&
      itemTop < viewportBottom - VIEWPORT_EDGE_INSET_PX
    ) {
      visibleIds.push(item.id)
    }
  }

  if (visibleIds.length > 0) {
    return new Set(visibleIds)
  }

  const anchorOffset = viewportTop + virtualizer.viewportSize * ACTIVE_MARKER_ANCHOR_RATIO
  let currentItem = items[0]!
  for (const item of items) {
    if (virtualizer.getItemOffset(item.rowIndex) > anchorOffset) {
      break
    }
    currentItem = item
  }

  return new Set([currentItem.id])
}

export const UserMessageNavigationRail = memo(function UserMessageNavigationRail(
  props: UserMessageNavigationRailProps
): React.JSX.Element | null {
  const { items, scrollViewportId, virtualizerRef } = props
  const { copy } = useI18n()
  const railRef = useRef<HTMLDivElement | null>(null)
  const scrubRef = useRef<{ pointerId: number; itemId: string } | null>(null)
  const didScrubRef = useRef(false)
  const [activeItemIds, setActiveItemIds] = useState<Set<string>>(() => new Set())
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [scrubbedItemId, setScrubbedItemId] = useState<string | null>(null)

  const updatePreview = useCallback((item: UserMessageNavigationItem, button: HTMLElement) => {
    const rail = railRef.current
    if (!rail) {
      return
    }

    const railRect = rail.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    setPreview({
      item,
      top: buttonRect.top - railRect.top + buttonRect.height / 2
    })
  }, [])

  const clearPreview = useCallback(() => {
    if (scrubRef.current) {
      return
    }
    setPreview(null)
  }, [])

  const scrollToItem = useCallback(
    (item: UserMessageNavigationItem, smooth: boolean) => {
      const virtualizer = virtualizerRef.current
      if (!virtualizer) {
        return
      }

      virtualizer.scrollToIndex(item.rowIndex, { align: "start", smooth })
      setActiveItemIds(new Set([item.id]))
    },
    [virtualizerRef]
  )

  const findEventItem = useCallback(
    (
      eventTarget: EventTarget | null
    ): { button: HTMLElement; item: UserMessageNavigationItem } | null => {
      if (!(eventTarget instanceof Element)) {
        return null
      }

      const button = eventTarget.closest<HTMLElement>("[data-user-message-navigation-item-id]")
      if (!button) {
        return null
      }

      const itemId = button.dataset.userMessageNavigationItemId
      const item = items.find((item) => item.id === itemId)
      return item ? { button, item } : null
    },
    [items]
  )

  useEffect(() => {
    const viewport = getScrollViewport(scrollViewportId)
    const virtualizer = virtualizerRef.current
    if (!viewport || !virtualizer) {
      return undefined
    }

    let frameId: number | null = null
    const updateActiveItems = () => {
      frameId = null
      setActiveItemIds((current) => {
        const next = getVisibleItemIds(items, virtualizer)
        if (current.size === next.size && [...current].every((id) => next.has(id))) {
          return current
        }
        return next
      })
    }
    const scheduleUpdate = () => {
      if (frameId !== null) {
        return
      }
      frameId = requestAnimationFrame(updateActiveItems)
    }

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate)
    observer?.observe(viewport)
    viewport.addEventListener("scroll", scheduleUpdate, { passive: true })
    window.addEventListener("resize", scheduleUpdate)
    scheduleUpdate()

    return () => {
      viewport.removeEventListener("scroll", scheduleUpdate)
      window.removeEventListener("resize", scheduleUpdate)
      observer?.disconnect()
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
    }
  }, [items, scrollViewportId, virtualizerRef])

  if (items.length < MIN_NAVIGATION_ITEM_COUNT) {
    return null
  }

  const releaseScrub = (event: PointerEvent<HTMLDivElement>) => {
    const scrub = scrubRef.current
    if (scrub === null || scrub.pointerId !== event.pointerId) {
      return
    }

    scrubRef.current = null
    setScrubbedItemId(null)
    setPreview(null)
    event.currentTarget.releasePointerCapture(event.pointerId)
    window.setTimeout(() => {
      didScrubRef.current = false
    }, 0)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }

    const target = findEventItem(event.target)
    if (!target) {
      return
    }

    scrubRef.current = { pointerId: event.pointerId, itemId: target.item.id }
    didScrubRef.current = false
    setScrubbedItemId(target.item.id)
    updatePreview(target.item, target.button)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const scrub = scrubRef.current
    if (!scrub || scrub.pointerId !== event.pointerId || event.buttons % 2 === 0) {
      return
    }

    const rail = railRef.current
    if (!rail) {
      return
    }

    const railRect = rail.getBoundingClientRect()
    const target = findEventItem(
      document.elementFromPoint(railRect.left + railRect.width / 2, event.clientY)
    )
    if (!target || target.item.id === scrub.itemId) {
      return
    }

    scrubRef.current = { pointerId: event.pointerId, itemId: target.item.id }
    didScrubRef.current = true
    setScrubbedItemId(target.item.id)
    updatePreview(target.item, target.button)
    scrollToItem(target.item, false)
  }

  return (
    <nav
      aria-label={copy.chat.userMessageNavigationLabel}
      className="pointer-events-none absolute left-[var(--jingle-space-3)] top-1/2 z-20 hidden -translate-y-1/2 lg:block"
    >
      <div className="relative pointer-events-auto" ref={railRef}>
        <div
          className="jingle-user-message-navigation-rail-list flex max-h-[min(70vh,40rem)] flex-col overflow-y-auto overscroll-contain scrollbar-hide"
          data-scrubbing={scrubbedItemId === null ? undefined : true}
          onLostPointerCapture={releaseScrub}
          onPointerCancel={releaseScrub}
          onPointerDown={handlePointerDown}
          onPointerLeave={clearPreview}
          onPointerMove={handlePointerMove}
          onPointerUp={releaseScrub}
        >
          {items.map((item) => {
            const isActive = activeItemIds.has(item.id)
            const isScrubbed = scrubbedItemId === item.id
            return (
              <button
                aria-current={isActive ? "true" : undefined}
                aria-label={copy.chat.userMessageNavigationJump(item.position)}
                className="jingle-user-message-navigation-rail-row group/navigation-row flex h-2.5 w-9 shrink-0 cursor-default items-center outline-none"
                data-scrub-target={isScrubbed ? true : undefined}
                data-user-message-navigation-item-id={item.id}
                key={item.id}
                onBlur={clearPreview}
                onClick={(event) => {
                  if (didScrubRef.current) {
                    didScrubRef.current = false
                    return
                  }
                  const target = findEventItem(event.currentTarget)
                  if (target) {
                    updatePreview(target.item, target.button)
                    scrollToItem(target.item, true)
                  }
                }}
                onFocus={(event) => updatePreview(item, event.currentTarget)}
                onPointerEnter={(event) => updatePreview(item, event.currentTarget)}
                type="button"
              >
                <span className="flex h-0.5 w-[30px] items-center">
                  <span
                    className={cn(
                      "jingle-user-message-navigation-rail-marker h-0.5 bg-muted-foreground opacity-40 group-focus-visible/navigation-row:bg-foreground group-focus-visible/navigation-row:opacity-100",
                      scrubbedItemId === null &&
                        "group-hover/navigation-row:bg-foreground group-hover/navigation-row:opacity-100",
                      isActive && !isScrubbed && "bg-foreground opacity-60",
                      isScrubbed && "bg-foreground opacity-100"
                    )}
                  />
                </span>
              </button>
            )
          })}
        </div>
        {preview ? (
          <div
            className="pointer-events-none absolute left-full z-30 w-80 max-w-[calc(100vw-var(--jingle-space-4))] -translate-y-1/2 overflow-hidden rounded-[var(--jingle-radius-lg)] bg-popover/95 p-[var(--jingle-space-2)] text-popover-foreground shadow-xl ring-[0.5px] ring-border/80 backdrop-blur-sm"
            style={{ top: preview.top }}
          >
            <div className="min-w-0 truncate [font-size:var(--jingle-font-body)] font-medium leading-[var(--jingle-line-body)] text-foreground">
              {copy.chat.userMessageNavigationJump(preview.item.position)}
            </div>
            <div className="mt-[var(--jingle-space-1)] line-clamp-3 [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-body)] text-muted-foreground">
              {preview.item.label.length > 0
                ? preview.item.label
                : copy.chat.userMessageNavigationNoContent}
            </div>
          </div>
        ) : null}
      </div>
    </nav>
  )
})
