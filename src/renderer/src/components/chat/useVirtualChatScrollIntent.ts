import { useCallback, useEffect, useRef, useState } from "react"
import type { RefObject } from "react"
import type { VListHandle } from "virtua"

export const CHAT_AT_BOTTOM_THRESHOLD_PX = 300
export const CHAT_JUMP_TO_LATEST_GAP_PX = 16
const CHAT_USER_SCROLL_INTENT_TTL_MS = 500

interface UseVirtualChatScrollIntentOptions {
  atBottomThresholdPx?: number
  enabled?: boolean
  jumpToLatestGapPx?: number
  resetKey: string
  totalCount: number
  virtualizerRef: RefObject<VListHandle | null>
}

interface UseVirtualChatScrollIntentResult {
  forceScrollToLatest: () => void
  handleScroll: () => void
  handleScrollEnd: () => void
  isAtBottom: boolean
  isScrolling: boolean
  jumpToLatestOffsetPx: number
  markUserScrollIntent: () => void
  scrollToLatest: () => void
  showJumpToLatest: boolean
}

function getIsAtBottom(virtualizer: VListHandle, thresholdPx: number): boolean {
  return virtualizer.scrollSize - virtualizer.scrollOffset - virtualizer.viewportSize <= thresholdPx
}

function canMeasureVirtualizer(virtualizer: VListHandle): boolean {
  return virtualizer.viewportSize > 0 && virtualizer.scrollSize >= virtualizer.viewportSize
}

export function useVirtualChatScrollIntent(
  options: UseVirtualChatScrollIntentOptions
): UseVirtualChatScrollIntentResult {
  const {
    atBottomThresholdPx = CHAT_AT_BOTTOM_THRESHOLD_PX,
    enabled = true,
    jumpToLatestGapPx = CHAT_JUMP_TO_LATEST_GAP_PX,
    resetKey,
    totalCount,
    virtualizerRef
  } = options
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)
  const isAtBottomRef = useRef(true)
  const totalCountRef = useRef(totalCount)
  const pendingResetScrollRef = useRef(false)
  const resetFrameRef = useRef<number | null>(null)
  const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userScrollIntentAtRef = useRef(0)

  const setAtBottomState = useCallback((next: boolean): void => {
    isAtBottomRef.current = next
    setIsAtBottom((current) => (current === next ? current : next))
  }, [])

  const scrollToLatestInternal = useCallback(
    (force: boolean): boolean => {
      if (!force && (!enabled || !isAtBottomRef.current)) {
        return false
      }

      const virtualizer = virtualizerRef.current
      const latestItemIndex = totalCountRef.current - 1
      if (!virtualizer || latestItemIndex < 0) {
        return false
      }

      virtualizer.scrollToIndex(latestItemIndex, { align: "end" })
      setAtBottomState(true)
      return true
    },
    [enabled, setAtBottomState, virtualizerRef]
  )

  const scrollToLatest = useCallback((): void => {
    scrollToLatestInternal(false)
  }, [scrollToLatestInternal])

  const forceScrollToLatest = useCallback((): void => {
    if (scrollToLatestInternal(true)) {
      pendingResetScrollRef.current = false
    }
  }, [scrollToLatestInternal])

  const cancelResetFrame = useCallback((): void => {
    if (resetFrameRef.current === null) {
      return
    }

    cancelAnimationFrame(resetFrameRef.current)
    resetFrameRef.current = null
  }, [])

  const requestResetScroll = useCallback((): void => {
    cancelResetFrame()
    resetFrameRef.current = requestAnimationFrame(() => {
      resetFrameRef.current = null
      if (scrollToLatestInternal(true)) {
        pendingResetScrollRef.current = false
      }
    })
  }, [cancelResetFrame, scrollToLatestInternal])

  const handleScrollEnd = useCallback((): void => {
    if (scrollEndTimerRef.current) {
      clearTimeout(scrollEndTimerRef.current)
      scrollEndTimerRef.current = null
    }

    setIsScrolling(false)
  }, [])

  const markUserScrollIntent = useCallback((): void => {
    userScrollIntentAtRef.current = Date.now()
  }, [])

  const handleScroll = useCallback((): void => {
    const virtualizer = virtualizerRef.current
    if (!virtualizer) {
      return
    }

    if (!canMeasureVirtualizer(virtualizer)) {
      return
    }

    if (pendingResetScrollRef.current) {
      requestResetScroll()
    }

    const hasUserScrollIntent =
      Date.now() - userScrollIntentAtRef.current <= CHAT_USER_SCROLL_INTENT_TTL_MS

    if (hasUserScrollIntent) {
      setIsScrolling((current) => (current ? current : true))
    } else {
      setIsScrolling(false)
    }

    const measuredAtBottom = getIsAtBottom(virtualizer, atBottomThresholdPx)
    if (hasUserScrollIntent || measuredAtBottom) {
      setAtBottomState(measuredAtBottom)
    }

    if (scrollEndTimerRef.current) {
      clearTimeout(scrollEndTimerRef.current)
    }

    if (hasUserScrollIntent) {
      scrollEndTimerRef.current = setTimeout(() => {
        scrollEndTimerRef.current = null
        setIsScrolling(false)
      }, 150)
    }
  }, [atBottomThresholdPx, requestResetScroll, setAtBottomState, virtualizerRef])

  useEffect(() => {
    totalCountRef.current = totalCount

    if (pendingResetScrollRef.current && totalCount > 0) {
      requestResetScroll()
    }
  }, [requestResetScroll, totalCount])

  useEffect(() => {
    pendingResetScrollRef.current = true
    requestResetScroll()
  }, [requestResetScroll, resetKey])

  useEffect(() => {
    return () => {
      cancelResetFrame()
      if (scrollEndTimerRef.current) {
        clearTimeout(scrollEndTimerRef.current)
      }
    }
  }, [cancelResetFrame])

  return {
    forceScrollToLatest,
    handleScroll,
    handleScrollEnd,
    isAtBottom,
    isScrolling,
    jumpToLatestOffsetPx: jumpToLatestGapPx,
    markUserScrollIntent,
    scrollToLatest,
    showJumpToLatest: !isAtBottom && totalCount > 0
  }
}
