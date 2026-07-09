import { memo, useRef, useEffect, useCallback, useMemo, useState } from "react"
import { Brain, Folder, Send, Shield, Square } from "lucide-react"
import type { VListHandle } from "virtua"
import { PromptInput, PromptInputAction, PromptInputTextarea } from "@/components/agent-ui"
import { useThreadContext, useThreadControl, useThreadSelector } from "@/lib/thread-context"
import type { AgentRunValidator, EditLastUserMessageAndInvokeInput } from "@/lib/agent-control"
import { useAgent } from "@/lib/use-agent"
import { Messages } from "./Messages"
import { AssistantSelectionReferencePill } from "./AssistantSelectionReferences"
import { MemoryReviewPanel } from "./MemoryReviewPanel"
import { ModelSwitcher } from "./ModelSwitcher"
import { ContextEvidencePanel } from "./ContextEvidencePanel"
import { WorkspacePicker } from "./WorkspacePicker"
import { selectWorkspaceFolder } from "@/lib/workspace-utils"
import { ChatTodos } from "./ChatTodos"
import { ChatJumpToLatestButton } from "./ChatJumpToLatestButton"
import { ComposerApprovalPrompt } from "./ComposerApprovalPrompt"
import { ComposerFollowUpQueue } from "./ComposerFollowUpQueue"
import { ContextUsageIndicator } from "./ContextUsageIndicator"
import { AgentErrorNotice } from "./AgentErrorNotice"
import { AssistantSelectionReferenceNavigationProvider } from "./AssistantSelectionReferenceNavigation"
import { useVirtualChatScrollIntent } from "./useVirtualChatScrollIntent"
import { useAssistantSelectionRefs } from "./useAssistantSelectionRefs"
import { useI18n } from "@/lib/i18n"
import { useDisableTabNavigation } from "@/lib/use-disable-tab-navigation"
import { listNativeLauncherSourceMentions } from "@extension-host/index"
import { useWorkspaceFileMentions, type ComposerAreaHandle } from "@/composer-area"
import {
  hasComposerMessageInputContent,
  type ComposerMessageInput,
  type ComposerMessageRef
} from "@shared/message-content"
import type { JingleAgentFollowUpQueueItem } from "@jingle/agent-client"
import type { HITLRequest, Todo } from "@/types"

interface ChatContainerProps {
  threadId: string
}

const EMPTY_TOKEN_USAGE = null
const EMPTY_TODOS: readonly Todo[] = []
type AssistantSelectionRef = Extract<ComposerMessageRef, { type: "assistant-message-selection" }>

const ChatFooter = memo(function ChatFooter(props: {
  clearError: () => void
  hasVisibleTurns: boolean
  isBusy: boolean
  pendingApproval: HITLRequest | null
  threadId: string
  todos: readonly Todo[]
  visibleError: string | null
}): React.JSX.Element {
  const { clearError, hasVisibleTurns, isBusy, pendingApproval, threadId, todos, visibleError } =
    props

  return (
    <div className="flex flex-col gap-[var(--ow-chat-thread-gap)]">
      {!isBusy && todos.length > 0 && (pendingApproval || hasVisibleTurns) && (
        <ChatTodos todos={todos} />
      )}

      {isBusy && todos.length > 0 && <ChatTodos todos={todos} />}

      {!isBusy && <ContextEvidencePanel threadId={threadId} />}

      {!isBusy && <MemoryReviewPanel threadId={threadId} />}

      {visibleError && !isBusy && <AgentErrorNotice error={visibleError} onDismiss={clearError} />}
    </div>
  )
})

const ChatThreadViewport = memo(function ChatThreadViewport(props: {
  clearError: () => void
  isBusy: boolean
  onAddAssistantSelectionRef?: (ref: AssistantSelectionRef) => void
  onEditLastUserMessage: (input: EditLastUserMessageAndInvokeInput) => Promise<boolean> | boolean
  onRetry: (input: ComposerMessageInput) => Promise<void> | void
  onSelectWorkspace: () => Promise<void> | void
  pendingApproval: HITLRequest | null
  threadId: string
  visibleError: string | null
  workspaceChangeError: string | null
}): React.JSX.Element {
  const {
    clearError,
    isBusy,
    onAddAssistantSelectionRef,
    onEditLastUserMessage,
    onRetry,
    onSelectWorkspace,
    pendingApproval,
    threadId,
    visibleError,
    workspaceChangeError
  } = props
  const { copy } = useI18n()
  const virtualizerRef = useRef<VListHandle>(null)
  const workspacePath = useThreadSelector(threadId, (state) => state?.agent.workspacePath ?? null)
  const hasVisibleTurns = useThreadSelector(
    threadId,
    (state) => (state?.view.messageProjection.turns.length ?? 0) > 0
  )
  const displayRowCount = useThreadSelector(
    threadId,
    (state) => state?.view.messageProjection.displayRows.length ?? 0
  )
  const todos = useThreadSelector(threadId, (state) => state?.agent.todos ?? EMPTY_TODOS)
  const showEmptyChat = !hasVisibleTurns && !isBusy && !visibleError
  const chatVirtualItemCount = showEmptyChat ? 0 : displayRowCount

  const {
    forceScrollToLatest,
    handleScroll: handleChatScroll,
    handleScrollEnd: handleChatScrollEnd,
    isAtBottom,
    isScrolling,
    jumpToLatestOffsetPx,
    markUserScrollIntent,
    scrollToLatest,
    showJumpToLatest
  } = useVirtualChatScrollIntent({
    resetKey: threadId,
    totalCount: chatVirtualItemCount,
    virtualizerRef
  })

  const handleDismissError = useCallback((): void => {
    clearError()
  }, [clearError])
  const renderFooter = useCallback(
    () => (
      <ChatFooter
        clearError={handleDismissError}
        hasVisibleTurns={hasVisibleTurns}
        isBusy={isBusy}
        pendingApproval={pendingApproval}
        threadId={threadId}
        todos={todos}
        visibleError={visibleError}
      />
    ),
    [handleDismissError, hasVisibleTurns, isBusy, pendingApproval, threadId, todos, visibleError]
  )

  return (
    <div className="relative min-h-0 flex-1">
      {showEmptyChat ? (
        <div className="h-full overflow-y-auto px-[var(--ow-chat-thread-x)] py-[var(--ow-chat-thread-y)]">
          <div className="mx-auto max-w-[var(--ow-chat-thread-max-width)]">
            <div className="flex flex-col items-center justify-center py-[var(--ow-chat-empty-y)] text-muted-foreground">
              <div className="mb-3 text-section-header">{copy.chat.newThreadEyebrow}</div>
              {workspacePath ? (
                <div className="text-center">
                  <div className="[font-size:var(--ow-chat-hero-title)] font-semibold tracking-normal text-foreground">
                    {copy.chat.startConversation}
                  </div>
                  <div className="mt-[var(--ow-space-3)] [font-size:var(--ow-font-body)] text-muted-foreground">
                    {copy.chat.describeOutcome}
                  </div>
                </div>
              ) : (
                <div className="space-y-[var(--ow-space-3)] text-center [font-size:var(--ow-font-body)]">
                  <div>
                    <span className="text-status-warning">{copy.chat.selectWorkspaceTitle}</span>
                    <span className="mt-[var(--ow-space-1)] block [font-size:var(--ow-font-meta)] opacity-75">
                      {copy.chat.selectWorkspaceHint}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-[var(--ow-control-h-md)] items-center justify-center gap-[var(--ow-space-1-5)] rounded-full bg-background-secondary px-[var(--ow-space-3)] [font-size:var(--ow-font-meta)] text-status-warning transition-colors duration-100 hover:bg-background-interactive disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void onSelectWorkspace()}
                  >
                    <Folder className="size-[var(--ow-icon-sm)]" />
                    <span className="max-w-[var(--ow-chip-label-max-width)] truncate">
                      {copy.chat.selectWorkspace}
                    </span>
                  </button>
                  {workspaceChangeError ? (
                    <div className="mx-auto max-w-[var(--ow-chat-empty-copy-max-width)] [font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-status-warning">
                      {workspaceChangeError}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <Messages
          contentClassName="mx-auto w-full max-w-[var(--ow-chat-thread-max-width)] px-[var(--ow-chat-thread-x)]"
          contentInsetY="var(--ow-chat-thread-y)"
          isAtBottom={isAtBottom}
          isLoading={isBusy}
          isScrolling={isScrolling}
          onAddAssistantSelectionRef={onAddAssistantSelectionRef}
          onEditLastUserMessage={onEditLastUserMessage}
          onRetry={onRetry}
          onScroll={handleChatScroll}
          onScrollEnd={handleChatScrollEnd}
          onScrollToLatest={scrollToLatest}
          onUserScrollIntent={markUserScrollIntent}
          renderFooter={renderFooter}
          threadId={threadId}
          virtualizerRef={virtualizerRef}
        />
      )}

      {showJumpToLatest && (
        <div
          className="absolute left-1/2 z-10 -translate-x-1/2"
          style={{ bottom: jumpToLatestOffsetPx }}
        >
          <ChatJumpToLatestButton
            isLoading={isBusy}
            label={copy.launcher.jumpToLatest}
            onClick={forceScrollToLatest}
          />
        </div>
      )}
    </div>
  )
})

export function ChatContainer({ threadId }: ChatContainerProps): React.JSX.Element {
  const { copy, locale } = useI18n()
  const sourceMentions = useMemo(
    () => listNativeLauncherSourceMentions(window.electron.process.platform, locale),
    [locale]
  )
  const inputRef = useRef<ComposerAreaHandle>(null)
  const [temporaryMode, setTemporaryMode] = useState(false)
  const [workspaceChangeError, setWorkspaceChangeError] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const workspaceFileMentionState = useWorkspaceFileMentions(threadId, mentionQuery)
  const {
    addSelectionRef,
    clearSelectionRefs,
    refs: assistantSelectionRefs,
    removeSelectionRef
  } = useAssistantSelectionRefs(threadId)
  useDisableTabNavigation(inputRef)

  const threadContext = useThreadContext()
  const threadControl = useThreadControl(threadId)
  const tokenUsage = useThreadSelector(
    threadId,
    (state) => state?.agent.tokenUsage ?? EMPTY_TOKEN_USAGE
  )
  const currentModel = useThreadSelector(threadId, (state) => state?.agent.currentModel ?? null)
  const validateRun = useCallback<AgentRunValidator>(
    ({ workspacePath }) => {
      return workspacePath ? null : copy.chat.inputNeedsWorkspace
    },
    [copy.chat.inputNeedsWorkspace]
  )
  const agent = useAgent({
    threadId,
    temporaryMode,
    validateRun
  })
  const {
    view: { canStop, error: visibleError, isBusy },
    control: { clearError, editLastUserMessageAndInvoke, invoke, resume, stop }
  } = agent
  const pendingApproval = useThreadSelector(
    threadId,
    (state) => state?.agent.pendingApproval ?? null
  )
  const followUpQueue = useThreadSelector(threadId, (state) => state?.agent.followUpQueue ?? null)
  const activeRun = useThreadSelector(threadId, (state) => state?.agent.activeRun ?? null)
  const composerAvailabilityInput = useMemo(
    () => ({
      refs: assistantSelectionRefs,
      text: input
    }),
    [assistantSelectionRefs, input]
  )
  const canInvoke = hasComposerMessageInputContent(composerAvailabilityInput) && !pendingApproval
  const showStopAction = canStop && !canInvoke
  const showFollowUpQueue = Boolean(followUpQueue && followUpQueue.count > 0)

  useEffect(() => {
    inputRef.current?.focus()
  }, [threadId])

  const getCurrentComposerMessageInput = useCallback((): ComposerMessageInput => {
    const composer = inputRef.current
    return {
      refs: [...(composer?.getRefs() ?? []), ...assistantSelectionRefs],
      text: composer?.getModelText() ?? input
    }
  }, [assistantSelectionRefs, input])
  const invokeWithComposerRefs = useCallback(async (): Promise<boolean> => {
    const didInvoke = await invoke(getCurrentComposerMessageInput())
    if (didInvoke) {
      setInput("")
      clearSelectionRefs()
      setMentionQuery(null)
    }

    return didInvoke
  }, [clearSelectionRefs, getCurrentComposerMessageInput, invoke])
  const editQueuedFollowUp = useCallback(
    async (item: JingleAgentFollowUpQueueItem): Promise<void> => {
      const edited = await threadControl.agent.takeFollowUp(item.requestId)
      if (!edited) {
        return
      }

      setInput(edited.messageInput.text)
      clearSelectionRefs()
      setMentionQuery(null)
      window.requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    },
    [clearSelectionRefs, threadControl]
  )
  const deleteQueuedFollowUp = useCallback(
    async (item: JingleAgentFollowUpQueueItem): Promise<void> => {
      await threadControl.agent.removeFollowUp(item.requestId)
    },
    [threadControl]
  )
  const steerQueuedFollowUp = useCallback(
    async (item: JingleAgentFollowUpQueueItem): Promise<void> => {
      await threadControl.agent.steerFollowUp(
        item.requestId,
        activeRun ? { runId: activeRun.runId, turnId: activeRun.turnId } : undefined
      )
    },
    [activeRun, threadControl]
  )
  const retry = useCallback(
    async (retryInput: ComposerMessageInput): Promise<void> => {
      await invoke(retryInput)
    },
    [invoke]
  )
  const editLastUserMessage = useCallback(
    async (editInput: EditLastUserMessageAndInvokeInput): Promise<boolean> => {
      return editLastUserMessageAndInvoke(editInput)
    },
    [editLastUserMessageAndInvoke]
  )
  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    await invokeWithComposerRefs()
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleCancel = async (): Promise<void> => {
    await stop()
  }

  const handleSelectWorkspaceFromEmptyState = useCallback(async (): Promise<void> => {
    setWorkspaceChangeError(null)
    await selectWorkspaceFolder(threadId, threadContext.loadThreadData, () => {}, undefined, {
      onError: (error) => {
        setWorkspaceChangeError(error)
      },
      onBlockedByPendingWorkspaceMemory: () => {
        setWorkspaceChangeError(copy.chat.pendingWorkspaceMemoryBlocksWorkspaceChange)
      }
    })
  }, [copy.chat.pendingWorkspaceMemoryBlocksWorkspaceChange, threadContext, threadId])

  return (
    <AssistantSelectionReferenceNavigationProvider>
      <div className="chat-thread-surface flex min-h-0 flex-1 flex-col overflow-hidden">
        <ChatThreadViewport
          clearError={clearError}
          isBusy={isBusy}
          onAddAssistantSelectionRef={addSelectionRef}
          onEditLastUserMessage={editLastUserMessage}
          onRetry={retry}
          onSelectWorkspace={handleSelectWorkspaceFromEmptyState}
          pendingApproval={pendingApproval}
          threadId={threadId}
          visibleError={visibleError}
          workspaceChangeError={workspaceChangeError}
        />

        <div className="border-t border-border bg-background-elevated/60 px-[var(--ow-chat-thread-x)] py-[var(--ow-chat-footer-y)]">
          <form onSubmit={handleSubmit} className="mx-auto max-w-[var(--ow-chat-thread-max-width)]">
            <div className="flex flex-col gap-[var(--ow-gap-md)]">
              {pendingApproval ? (
                <ComposerApprovalPrompt
                  key={pendingApproval.id}
                  onDecision={(decision) => {
                    void resume(decision)
                  }}
                  request={pendingApproval}
                />
              ) : (
                <div>
                  {followUpQueue ? (
                    <ComposerFollowUpQueue
                      onDeleteQueuedFollowUp={deleteQueuedFollowUp}
                      onEditQueuedFollowUp={editQueuedFollowUp}
                      onSteerQueuedFollowUp={steerQueuedFollowUp}
                      queue={followUpQueue}
                    />
                  ) : null}
                  <PromptInput
                    className={`px-[var(--ow-space-4)] py-[var(--ow-space-4)] ${
                      showFollowUpQueue ? "rounded-t-none border-t-0" : ""
                    }`}
                    disabled={Boolean(pendingApproval)}
                    isLoading={isBusy}
                    maxHeight="200px"
                    minHeight="var(--ow-chat-composer-input-min-h)"
                    onSubmit={() => {
                      void invokeWithComposerRefs()
                    }}
                    onValueChange={setInput}
                    value={input}
                  >
                    <div className="flex min-w-0 items-end gap-[var(--ow-gap-md)]">
                      <PromptInputTextarea
                        composerRef={inputRef}
                        mode="composer"
                        onMentionQueryChange={setMentionQuery}
                        onKeyDown={handleKeyDown}
                        placeholder={copy.chat.messagePlaceholder}
                        sourceMentions={sourceMentions}
                        workspaceFileMentions={workspaceFileMentionState.files}
                        workspaceFileSearchEnabled={workspaceFileMentionState.searchEnabled}
                        workspaceFileSearchIncomplete={workspaceFileMentionState.isIncomplete}
                        workspaceFileSearchInProgress={workspaceFileMentionState.isSearching}
                        className="min-w-0 flex-1 resize-none bg-transparent px-0 py-0 [font-size:var(--ow-font-display)] text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
                      />
                      <div className="flex h-[var(--ow-chat-composer-action-h)] shrink-0 items-center justify-center">
                        <div className="flex items-center gap-[var(--ow-gap-sm)]">
                          {showStopAction ? (
                            <PromptInputAction
                              onClick={handleCancel}
                              icon={<Square className="size-[var(--ow-icon-action)]" />}
                              label={copy.launcher.aiStopLabel}
                              className="size-[var(--ow-control-h-md)] bg-background-elevated"
                            />
                          ) : null}
                          <PromptInputAction
                            type="submit"
                            disabled={!canInvoke}
                            icon={<Send className="size-[var(--ow-icon-action)]" />}
                            label={copy.launcher.aiPrimaryLabel}
                            className="size-[var(--ow-control-h-md)] bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                          />
                        </div>
                      </div>
                    </div>
                    <AssistantSelectionReferencePill
                      refs={assistantSelectionRefs}
                      removable
                      onClear={clearSelectionRefs}
                      onRemove={removeSelectionRef}
                    />
                  </PromptInput>
                </div>
              )}

              <div className="flex items-center justify-between gap-[var(--ow-gap-lg)]">
                <div className="flex items-center gap-[var(--ow-gap-sm)]">
                  <ModelSwitcher threadId={threadId} />
                  <div className="h-[var(--ow-control-divider-h)] w-px bg-border" />
                  <WorkspacePicker threadId={threadId} />
                  <button
                    type="button"
                    className={`inline-flex h-[var(--ow-control-h-md)] items-center gap-[var(--ow-space-1-5)] rounded-full border px-[var(--ow-space-2-5)] [font-size:var(--ow-font-meta)] transition ${
                      temporaryMode
                        ? "border-status-warning/40 bg-status-warning/10 text-status-warning"
                        : "border-border bg-background-elevated text-muted-foreground hover:bg-background-secondary hover:text-foreground"
                    }`}
                    onClick={() => setTemporaryMode((current) => !current)}
                    aria-pressed={temporaryMode}
                  >
                    {temporaryMode ? (
                      <Shield className="size-[var(--ow-icon-sm)]" />
                    ) : (
                      <Brain className="size-[var(--ow-icon-sm)]" />
                    )}
                    <span className="max-w-[var(--ow-chip-label-max-width)] truncate">
                      {temporaryMode ? copy.chat.memoryTemporaryOn : copy.chat.memoryTemporaryOff}
                    </span>
                  </button>
                </div>
                {tokenUsage && currentModel && (
                  <ContextUsageIndicator tokenUsage={tokenUsage} modelId={currentModel} />
                )}
              </div>
            </div>
          </form>
        </div>
      </div>
    </AssistantSelectionReferenceNavigationProvider>
  )
}
