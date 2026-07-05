import {
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject
} from "react"
import { Archive } from "lucide-react"
import { VList, type VListHandle } from "virtua"
import {
  extractMessageText,
  type ComposerMessageInput,
  type ComposerMessageRef
} from "@shared/message-content"
import type { JingleActiveAgentToolCall } from "@jingle/agent-client"
import type { ContentBlock, Message as ThreadMessage } from "@/types"
import type { EditLastUserMessageAndInvokeInput } from "@/lib/agent-control"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import {
  createDefaultMessagesProjection,
  projectTurnPendingApproval,
  projectTurnToolExecutionsView,
  type AgentToolExecutionsView,
  type MessageDisplayRow,
  type MessageTurn,
  type ToolResultInfo
} from "@/lib/message-projection"
import { useThreadSelector } from "@/lib/thread-context"
import { MessageTurnView } from "./MessageTurnView"
import { AssistantSelectionOverlay } from "./AssistantSelectionOverlay"
import {
  useAssistantSelectionReferenceNavigationRegistration,
  type AssistantSelectionReferenceNavigationHandler
} from "./assistant-selection-reference-navigation-context"
import {
  UserMessageNavigationRail,
  type UserMessageNavigationItem
} from "./UserMessageNavigationRail"

type AssistantSelectionRef = Extract<ComposerMessageRef, { type: "assistant-message-selection" }>

interface MessagesProps {
  contentClassName?: string
  contentInsetY?: string
  renderFooter?: () => ReactNode
  threadId: string
  virtualizerRef: RefObject<VListHandle | null>
  isAtBottom?: boolean
  isLoading?: boolean
  isScrolling?: boolean
  onUserScrollIntent?: () => void
  onScroll?: () => void
  onScrollEnd?: () => void
  onScrollToLatest?: () => void
  onBranch?: (messageId: string) => Promise<void> | void
  onEditLastUserMessage?: (input: EditLastUserMessageAndInvokeInput) => Promise<boolean> | boolean
  onRetry?: (input: ComposerMessageInput) => Promise<void> | void
  onAddAssistantSelectionRef?: (ref: AssistantSelectionRef) => void
}

const SCROLL_INTENT_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " "
])
const CHAT_BLANK_USER_SCROLL_INTENT_TTL_MS = 500
const DEFAULT_MESSAGE_PROJECTION = createDefaultMessagesProjection()
const DEFAULT_DISPLAY_ROWS: readonly MessageDisplayRow[] = DEFAULT_MESSAGE_PROJECTION.displayRows
const EMPTY_ACTIVE_TOOL_CALLS: readonly JingleActiveAgentToolCall[] = []
const ASSISTANT_SELECTION_REVEAL_MAX_ATTEMPTS = 60
const ASSISTANT_SELECTION_REVEAL_HIGHLIGHT =
  "color-mix(in srgb, var(--foreground) 10%, transparent)"
const ASSISTANT_SELECTION_REVEAL_CLEAR = "color-mix(in srgb, var(--foreground) 0%, transparent)"

function findTurnByKey(turns: MessageTurn[], turnKey: string): MessageTurn | null {
  return turns.find((turn) => turn.key === turnKey) ?? null
}

function isRuntimeRunActive(status: string | null | undefined): boolean {
  return status === "running" || status === "waiting_approval"
}

function findAssistantMessageElement(
  viewport: HTMLElement,
  messageId: string
): HTMLElement | null {
  for (const element of viewport.querySelectorAll<HTMLElement>("[data-assistant-message-id]")) {
    if (element.dataset.assistantMessageId === messageId) {
      return element
    }
  }

  return null
}

function getScrollViewportElement(scrollViewportId: string): HTMLElement | null {
  return document.getElementById(scrollViewportId)
}

function animateAssistantMessageReveal(element: HTMLElement): void {
  element.animate(
    [
      { backgroundColor: ASSISTANT_SELECTION_REVEAL_HIGHLIGHT },
      { backgroundColor: ASSISTANT_SELECTION_REVEAL_HIGHLIGHT, offset: 0.32 },
      { backgroundColor: ASSISTANT_SELECTION_REVEAL_CLEAR }
    ],
    {
      duration: 1200,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)"
    }
  )
}

function getReasoningBlockText(block: ContentBlock): string {
  return block.reasoning ?? block.text ?? block.content ?? ""
}

function getStreamingContentScrollKey(content: ThreadMessage["content"]): string {
  if (typeof content === "string") {
    return `${content.length}:0:0`
  }

  let textLength = 0
  let reasoningLength = 0
  for (const block of content) {
    if (block.type === "reasoning") {
      reasoningLength += getReasoningBlockText(block).length
      continue
    }

    textLength += (block.text ?? block.content ?? "").length
  }

  return `${textLength}:${reasoningLength}:${content.length}`
}

function ContextCompactionRow(): ReactElement {
  const { copy } = useI18n()
  const label = copy.chat.contextCompacted

  return (
    <div className="ow-context-compaction-row" aria-label={label}>
      <div className="ow-context-compaction-rule" aria-hidden="true" />
      <div className="ow-context-compaction-pill">
        <Archive aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
        <span>{label}</span>
      </div>
      <div className="ow-context-compaction-rule" aria-hidden="true" />
    </div>
  )
}

function getToolResultsScrollKey(toolResults: Map<string, ToolResultInfo>): string {
  if (toolResults.size === 0) {
    return "0"
  }

  return Array.from(toolResults, ([toolCallId, result]) => {
    return `${toolCallId}:${getStreamingContentScrollKey(result.content)}`
  }).join("|")
}

function getActiveToolCallsScrollKey(activeToolCalls: readonly JingleActiveAgentToolCall[]): string {
  if (activeToolCalls.length === 0) {
    return "0"
  }

  return activeToolCalls
    .map((toolCall) => `${toolCall.id}:${toolCall.status}:${toolCall.argsText.length}`)
    .join("|")
}

function getStreamingTurnScrollKey(
  turn: MessageTurn | null | undefined,
  message: ThreadMessage | null | undefined
): string | null {
  if (!turn || !message) {
    return null
  }

  const toolCallCount = message.tool_calls?.length ?? 0
  return [
    message.id,
    getStreamingContentScrollKey(message.content),
    toolCallCount,
    getToolResultsScrollKey(turn.toolResults)
  ].join(":")
}

const MessageAutoScroll = memo(function MessageAutoScroll(props: {
  activeTurnScrollKey: string | number | null
  hasFollowTarget: boolean
  isAtBottom: boolean
  isScrolling: boolean
  observeKey: string
  onScrollToLatest: () => void
  rowRef: RefObject<HTMLDivElement | null>
  signatureRef: RefObject<HTMLDivElement | null>
}): null {
  const {
    activeTurnScrollKey,
    hasFollowTarget,
    isAtBottom,
    isScrolling,
    observeKey,
    onScrollToLatest,
    rowRef,
    signatureRef
  } = props
  const frameRef = useRef<number | null>(null)

  const scheduleScrollToLatest = useEffectEvent(() => {
    const shouldAutoScroll = hasFollowTarget && isAtBottom && !isScrolling
    if (!shouldAutoScroll || frameRef.current !== null) {
      return
    }

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      onScrollToLatest()
    })
  })

  useEffect(() => {
    scheduleScrollToLatest()
  }, [activeTurnScrollKey, hasFollowTarget, observeKey])

  useEffect(() => {
    const nodes = [rowRef.current, signatureRef.current].filter(
      (node): node is HTMLDivElement => node !== null
    )
    if (nodes.length === 0 || typeof ResizeObserver === "undefined") {
      return undefined
    }

    let frameId: number | null = null
    const observer = new ResizeObserver(() => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }

      frameId = requestAnimationFrame(() => {
        frameId = null
        scheduleScrollToLatest()
      })
    })

    for (const node of nodes) {
      observer.observe(node)
    }

    return () => {
      observer.disconnect()
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
    }
  }, [observeKey, rowRef, signatureRef])

  useEffect(() => {
    const frame = frameRef

    return () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current)
      }
    }
  }, [])

  return null
})

const MessageTurnRow = memo(function MessageTurnRow(props: {
  isAtBottom: boolean
  isActiveTurnBlankActive: boolean
  isLastTurnRow: boolean
  isLoading?: boolean
  isScrolling: boolean
  hasVisibleTurns: boolean
  observeKey: string
  onBranch?: (messageId: string) => Promise<void> | void
  onEditLastUserMessage?: (input: EditLastUserMessageAndInvokeInput) => Promise<boolean> | boolean
  onRetry?: (input: ComposerMessageInput) => Promise<void> | void
  onScrollToLatest?: () => void
  rowRef: RefObject<HTMLDivElement | null>
  threadId: string
  turnKey: string
}): React.JSX.Element | null {
  const {
    isAtBottom,
    isActiveTurnBlankActive,
    isLastTurnRow,
    isLoading,
    isScrolling,
    hasVisibleTurns,
    observeKey,
    onBranch,
    onEditLastUserMessage,
    onRetry,
    onScrollToLatest,
    rowRef,
    threadId,
    turnKey
  } = props
  const turn = useThreadSelector(threadId, (state) =>
    findTurnByKey(state?.view.messageProjection.turns ?? [], turnKey)
  )
  const isActiveTurn = useThreadSelector(
    threadId,
    (state) => state?.view.messageProjection.activeTurnKey === turnKey
  )
  const activeAssistantId = useThreadSelector(threadId, (state) =>
    state?.view.messageProjection.activeTurnKey === turnKey
      ? state.view.messageProjection.activeAssistantId
      : null
  )
  const activeToolCallId = useThreadSelector(threadId, (state) =>
    state?.view.messageProjection.activeTurnKey === turnKey
      ? (state.agent.activeRun?.currentToolCallId ?? null)
      : null
  )
  const activeToolCalls = useThreadSelector(threadId, (state) =>
    state?.view.messageProjection.activeTurnKey === turnKey
      ? (state.agent.activeRun?.toolCalls ?? EMPTY_ACTIVE_TOOL_CALLS)
      : EMPTY_ACTIVE_TOOL_CALLS
  )
  const activeRunPhase = useThreadSelector(threadId, (state) =>
    state?.view.messageProjection.activeTurnKey === turnKey
      ? (state.agent.activeRun?.phase ?? null)
      : null
  )
  const activeRunStartedAt = useThreadSelector(threadId, (state) =>
    state?.view.messageProjection.activeTurnKey === turnKey
      ? (state.agent.activeRun?.startedAt ?? null)
      : null
  )
  const activeRunStatus = useThreadSelector(threadId, (state) =>
    state?.view.messageProjection.activeTurnKey === turnKey
      ? (state.agent.activeRun?.status ?? null)
      : null
  )
  const turnPendingApproval = useThreadSelector(threadId, (state) =>
    projectTurnPendingApproval({
      activeToolCalls:
        state?.view.messageProjection.activeTurnKey === turnKey
          ? state.agent.activeRun?.toolCalls
          : EMPTY_ACTIVE_TOOL_CALLS,
      isActiveTurn: state?.view.messageProjection.activeTurnKey === turnKey,
      pendingApproval: state?.agent.pendingApproval ?? null,
      turn
    })
  )
  const toolExecutions = useMemo<AgentToolExecutionsView>(
    () =>
      projectTurnToolExecutionsView({
        activeToolCallId,
        activeToolCalls,
        pendingApproval: turnPendingApproval,
        turn
      }),
    [activeToolCallId, activeToolCalls, turn, turnPendingApproval]
  )

  if (!turn) {
    return null
  }

  const isStreaming = isActiveTurn && isRuntimeRunActive(activeRunStatus)
  const streamingAssistantId = isStreaming ? activeAssistantId : null
  const activeAssistant = streamingAssistantId
    ? turn.assistants.find((message) => message.id === streamingAssistantId)
    : null
  const activeTurnScrollKey = [
    getStreamingTurnScrollKey(turn, activeAssistant),
    getActiveToolCallsScrollKey(activeToolCalls)
  ].join(":")

  return (
    <>
      <MessageTurnView
        activeRunPhase={activeRunPhase}
        activeRunStartedAt={activeRunStartedAt}
        activeToolCalls={activeToolCalls}
        isActiveTurn={isActiveTurn}
        isLatestTurn={isLastTurnRow}
        isStreaming={isStreaming}
        onBranch={isStreaming || isLoading ? undefined : onBranch}
        onEditLastUserMessage={
          isLastTurnRow && !isStreaming && !isLoading && !turnPendingApproval
            ? onEditLastUserMessage
            : undefined
        }
        onRetry={isActiveTurn && !isStreaming && !isLoading ? onRetry : undefined}
        pendingApproval={turnPendingApproval}
        streamingAssistantId={streamingAssistantId}
        threadId={threadId}
        toolExecutions={toolExecutions}
        toolResults={turn.toolResults}
        turn={turn}
      />
      {isLastTurnRow && onScrollToLatest && !isActiveTurnBlankActive ? (
        <MessageAutoScroll
          activeTurnScrollKey={activeTurnScrollKey}
          hasFollowTarget={hasVisibleTurns}
          isAtBottom={isAtBottom}
          isScrolling={isScrolling}
          observeKey={observeKey}
          onScrollToLatest={onScrollToLatest}
          rowRef={rowRef}
          signatureRef={rowRef}
        />
      ) : null}
    </>
  )
})

export function Messages(props: MessagesProps): React.JSX.Element {
  const {
    contentClassName,
    contentInsetY = "var(--ow-chat-thread-y)",
    isAtBottom = true,
    isLoading,
    isScrolling = false,
    onAddAssistantSelectionRef,
    onBranch,
    onEditLastUserMessage,
    onRetry,
    onScroll,
    onScrollEnd,
    onScrollToLatest,
    onUserScrollIntent,
    renderFooter,
    threadId,
    virtualizerRef
  } = props
  const displayRows = useThreadSelector(
    threadId,
    (state) => state?.view.messageProjection.displayRows ?? DEFAULT_DISPLAY_ROWS
  )
  const turns = useThreadSelector(
    threadId,
    (state) => state?.view.messageProjection.turns ?? DEFAULT_MESSAGE_PROJECTION.turns
  )
  const activeTurnKey = useThreadSelector(
    threadId,
    (state) => state?.view.messageProjection.activeTurnKey ?? null
  )
  const latestTurnKey = useThreadSelector(
    threadId,
    (state) => state?.view.messageProjection.turns.at(-1)?.key ?? null
  )
  const visibleTurnCount = useThreadSelector(
    threadId,
    (state) => state?.view.messageProjection.turns.length ?? 0
  )
  const activeTurnIndex = displayRows.findIndex(
    (row) => row.kind === "turn" && row.turnKey === activeTurnKey
  )
  const keepMounted = useMemo(
    () => (isLoading && activeTurnIndex >= 0 ? [activeTurnIndex] : []),
    [activeTurnIndex, isLoading]
  )
  const lastTurnRowRef = useRef<HTMLDivElement | null>(null)
  const activeTurnBlankFrameRef = useRef<number | null>(null)
  const activeTurnBlankScrollOffsetRef = useRef<number | null>(null)
  const activeTurnBlankUserScrollIntentAtRef = useRef(0)
  const scrollViewportId = useId()
  const virtualRowPadding = "pb-[var(--ow-chat-turn-gap)]"
  const shouldStartActiveTurnBlank = Boolean(
    isLoading &&
    activeTurnKey &&
    activeTurnIndex >= 0 &&
    latestTurnKey !== null &&
    activeTurnKey === latestTurnKey
  )
  const [activeTurnBlank, setActiveTurnBlank] = useState<{
    spacerHeight: number
    turnKey: string | null
  }>(() => ({
    spacerHeight: 0,
    turnKey: null
  }))
  const isActiveTurnBlankActive =
    activeTurnBlank.spacerHeight > 0 &&
    activeTurnBlank.turnKey !== null &&
    activeTurnBlank.turnKey === latestTurnKey
  const bottomSpacerHeight = `calc(${
    isActiveTurnBlankActive ? activeTurnBlank.spacerHeight : 0
  }px + ${contentInsetY})`

  const measureActiveTurnBlank = useEffectEvent((scrollToPinnedTurn: boolean) => {
    if (activeTurnBlankFrameRef.current !== null) {
      cancelAnimationFrame(activeTurnBlankFrameRef.current)
    }

    activeTurnBlankFrameRef.current = requestAnimationFrame(() => {
      activeTurnBlankFrameRef.current = null
      const blankTurnKey = shouldStartActiveTurnBlank ? activeTurnKey : activeTurnBlank.turnKey
      if (!blankTurnKey || blankTurnKey !== latestTurnKey || visibleTurnCount === 0) {
        return
      }

      const virtualizer = virtualizerRef.current
      const row = lastTurnRowRef.current
      if (!virtualizer || !row || virtualizer.viewportSize <= 0) {
        return
      }

      const rowHeight = row.getBoundingClientRect().height
      const spacerHeight = Math.max(Math.round(virtualizer.viewportSize - rowHeight), 0)

      setActiveTurnBlank((current) => {
        const next = {
          spacerHeight,
          turnKey: spacerHeight > 0 ? blankTurnKey : null
        }
        return current.spacerHeight === next.spacerHeight && current.turnKey === next.turnKey
          ? current
          : next
      })

      if (scrollToPinnedTurn && activeTurnIndex >= 0) {
        requestAnimationFrame(() => {
          virtualizerRef.current?.scrollToIndex(activeTurnIndex, { align: "start" })
        })
      }
    })
  })

  const markUserScrollIntent = useCallback(() => {
    activeTurnBlankUserScrollIntentAtRef.current = Date.now()
    onUserScrollIntent?.()
  }, [onUserScrollIntent])

  const handleScroll = useCallback(() => {
    const virtualizer = virtualizerRef.current
    if (virtualizer) {
      const currentOffset = virtualizer.scrollOffset
      const previousOffset = activeTurnBlankScrollOffsetRef.current
      activeTurnBlankScrollOffsetRef.current = currentOffset

      const hasUserScrollIntent =
        Date.now() - activeTurnBlankUserScrollIntentAtRef.current <=
        CHAT_BLANK_USER_SCROLL_INTENT_TTL_MS

      if (
        isActiveTurnBlankActive &&
        !isLoading &&
        hasUserScrollIntent &&
        previousOffset !== null &&
        currentOffset < previousOffset
      ) {
        const scrollReduction = Math.round(previousOffset - currentOffset)
        setActiveTurnBlank((current) => {
          if (!current.turnKey || current.spacerHeight <= 0) {
            return current
          }

          const spacerHeight = Math.max(current.spacerHeight - scrollReduction, 0)
          return {
            spacerHeight,
            turnKey: spacerHeight > 0 ? current.turnKey : null
          }
        })
      }
    }

    onScroll?.()
  }, [isActiveTurnBlankActive, isLoading, onScroll, virtualizerRef])

  useEffect(() => {
    if (!shouldStartActiveTurnBlank || !activeTurnKey) {
      return
    }

    activeTurnBlankScrollOffsetRef.current = virtualizerRef.current?.scrollOffset ?? null
    measureActiveTurnBlank(true)
  }, [activeTurnKey, shouldStartActiveTurnBlank, virtualizerRef])

  useEffect(() => {
    if (!isActiveTurnBlankActive) {
      return undefined
    }

    const node = lastTurnRowRef.current
    if (!node || typeof ResizeObserver === "undefined") {
      return undefined
    }

    const observer = new ResizeObserver(() => {
      measureActiveTurnBlank(false)
    })
    observer.observe(node)

    return () => observer.disconnect()
  }, [activeTurnBlank.turnKey, isActiveTurnBlankActive])

  useEffect(() => {
    const activeTurnBlankFrame = activeTurnBlankFrameRef

    return () => {
      if (activeTurnBlankFrame.current !== null) {
        cancelAnimationFrame(activeTurnBlankFrame.current)
      }
    }
  }, [])

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.buttons > 0) {
        markUserScrollIntent()
      }
    },
    [markUserScrollIntent]
  )
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (SCROLL_INTENT_KEYS.has(event.key)) {
        markUserScrollIntent()
      }
    },
    [markUserScrollIntent]
  )
  const turnRowIndexByKey = useMemo(() => {
    const turnRowIndexByKey = new Map<string, number>()
    displayRows.forEach((row, index) => {
      if (row.kind === "turn") {
        turnRowIndexByKey.set(row.turnKey, index)
      }
    })

    return turnRowIndexByKey
  }, [displayRows])
  const assistantMessageRowIndexById = useMemo(() => {
    const rowIndexByMessageId = new Map<string, number>()
    for (const turn of turns) {
      const rowIndex = turnRowIndexByKey.get(turn.key)
      if (rowIndex === undefined) {
        continue
      }

      for (const assistant of turn.assistants) {
        rowIndexByMessageId.set(assistant.id, rowIndex)
      }
    }

    return rowIndexByMessageId
  }, [turnRowIndexByKey, turns])
  const revealAssistantSelectionReference = useCallback(
    (ref: AssistantSelectionRef): void => {
      if (ref.sourceThreadId !== threadId) {
        return
      }

      const rowIndex = assistantMessageRowIndexById.get(ref.sourceMessageId)
      const virtualizer = virtualizerRef.current
      const viewport = getScrollViewportElement(scrollViewportId)
      if (rowIndex === undefined || !virtualizer || !viewport) {
        return
      }

      virtualizer.scrollToIndex(rowIndex, { align: "start", smooth: true })

      let attempt = 0
      const revealMountedMessage = () => {
        attempt += 1
        const element = findAssistantMessageElement(viewport, ref.sourceMessageId)
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "start" })
          animateAssistantMessageReveal(element)
          return
        }

        if (attempt < ASSISTANT_SELECTION_REVEAL_MAX_ATTEMPTS) {
          requestAnimationFrame(revealMountedMessage)
        }
      }

      requestAnimationFrame(revealMountedMessage)
    },
    [assistantMessageRowIndexById, scrollViewportId, threadId, virtualizerRef]
  )
  const referenceNavigationHandler = useMemo<AssistantSelectionReferenceNavigationHandler>(
    () => ({
      canRevealReference: (ref) =>
        ref.sourceThreadId === threadId && assistantMessageRowIndexById.has(ref.sourceMessageId),
      revealReference: revealAssistantSelectionReference
    }),
    [assistantMessageRowIndexById, revealAssistantSelectionReference, threadId]
  )
  useAssistantSelectionReferenceNavigationRegistration(referenceNavigationHandler)
  const userNavigationItems = useMemo<readonly UserMessageNavigationItem[]>(() => {
    const items: UserMessageNavigationItem[] = []
    for (const turn of turns) {
      if (!turn.user) {
        continue
      }

      const rowIndex = turnRowIndexByKey.get(turn.key)
      if (rowIndex === undefined) {
        continue
      }

      items.push({
        id: turn.key,
        label: extractMessageText(turn.user.content).trim(),
        position: items.length + 1,
        rowIndex
      })
    }

    return items
  }, [turnRowIndexByKey, turns])

  return (
    <div
      className="relative h-full min-h-0"
      onKeyDownCapture={handleKeyDown}
      onPointerDownCapture={markUserScrollIntent}
      onPointerMoveCapture={handlePointerMove}
      onTouchMoveCapture={markUserScrollIntent}
      onWheelCapture={markUserScrollIntent}
    >
      <VList
        data={displayRows}
        keepMounted={keepMounted}
        ref={virtualizerRef}
        className="h-full overflow-x-hidden overflow-y-auto overscroll-contain scrollbar-hide"
        id={scrollViewportId}
        style={{
          overflowAnchor: "none",
          paddingTop: contentInsetY
        }}
        onScroll={handleScroll}
        onScrollEnd={onScrollEnd}
        bufferSize={typeof window === "undefined" ? 400 : window.innerHeight}
      >
        {(row): ReactElement => {
          const isTurnRow = row.kind === "turn"
          const isLastTurnRow = isTurnRow && row.turnKey === latestTurnKey

          return (
            <div
              key={row.key}
              ref={(node) => {
                if (isLastTurnRow) {
                  lastTurnRowRef.current = node
                }
              }}
              className={cn(
                contentClassName,
                isTurnRow && row.turnKey !== latestTurnKey && virtualRowPadding
              )}
            >
              {row.kind === "turn" ? (
                <MessageTurnRow
                  hasVisibleTurns={visibleTurnCount > 0}
                  isActiveTurnBlankActive={isActiveTurnBlankActive}
                  isAtBottom={isAtBottom}
                  isLastTurnRow={isLastTurnRow}
                  isLoading={isLoading}
                  isScrolling={isScrolling}
                  observeKey={row.key}
                  onBranch={onBranch}
                  onEditLastUserMessage={onEditLastUserMessage}
                  onRetry={onRetry}
                  onScrollToLatest={onScrollToLatest}
                  rowRef={lastTurnRowRef}
                  threadId={threadId}
                  turnKey={row.turnKey}
                />
              ) : row.kind === "context-compaction" ? (
                <ContextCompactionRow />
              ) : (
                <>
                  {renderFooter?.()}
                  <div aria-hidden="true" style={{ height: bottomSpacerHeight }} />
                </>
              )}
            </div>
          )
        }}
      </VList>
      <UserMessageNavigationRail
        items={userNavigationItems}
        scrollViewportId={scrollViewportId}
        virtualizerRef={virtualizerRef}
      />
      <AssistantSelectionOverlay onAddRef={onAddAssistantSelectionRef} threadId={threadId} />
    </div>
  )
}
