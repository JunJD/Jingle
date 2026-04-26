import { useLayoutEffect, type RefObject } from "react"

const RADIX_SCROLL_VIEWPORT_SELECTOR = "[data-radix-scroll-area-viewport]"

export function useSelectedRowScrollIntoView<TElement extends HTMLElement>(params: {
  itemRefs: RefObject<Array<TElement | null>>
  itemsKey: string
  scrollAreaRef: RefObject<HTMLDivElement | null>
  selectedIndex: number
  tolerance?: number
}): void {
  const { itemRefs, itemsKey, scrollAreaRef, selectedIndex, tolerance = 2 } = params

  useLayoutEffect(() => {
    if (selectedIndex < 0) {
      return
    }

    const viewport = scrollAreaRef.current?.querySelector(
      RADIX_SCROLL_VIEWPORT_SELECTOR
    ) as HTMLDivElement | null
    const item = itemRefs.current[selectedIndex]

    if (!viewport || !item) {
      return
    }

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
  }, [itemRefs, itemsKey, scrollAreaRef, selectedIndex, tolerance])
}
