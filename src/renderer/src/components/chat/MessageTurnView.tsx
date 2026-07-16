import { GitForkIcon, RefreshCcwIcon } from "lucide-react"
import { memo, useCallback, useMemo } from "react"
import {
  hasMessageContent,
  toComposerMessageInput,
  type ComposerMessageInput
} from "@shared/message-content"
import { readJingleSteeringStatus } from "@shared/message-steering"
import type { HITLRequest } from "@/types"
import type { EditLastUserMessageAndInvokeInput } from "@/lib/agent-control"
import type { JingleActiveAgentToolCall, JingleAgentRunPhase } from "@jingle/agent-client"
import { useI18n } from "@/lib/i18n"
import {
  buildTurnAssistantEntries,
  getTurnCopyText,
  projectActiveTurnStatus,
  projectTurnElapsedDivider,
  type AgentToolExecutionsView,
  type MessageTurn,
  type ToolResultInfo
} from "@/lib/message-projection"
import { CopyButton } from "../ui/button"
import { MessageAction, MessageActions, MessageToolbar } from "./message"
import { ContextEvidencePanel } from "./ContextEvidencePanel"
import {
  AssistantProcessFold,
  createAssistantProcessEntry,
  renderAssistantProcessEntry,
  splitAssistantProcessEntries,
  SteeredConversationStatusRow,
  TurnElapsedDivider,
  WaitingApprovalStatusRow
} from "./message-turn-activity"
import { ThinkingMessage } from "./message-turn-content"
import { UserMessage } from "./message-turn-user"

export const MessageTurnView = memo(function MessageTurnView(props: {
  activeToolCalls: readonly JingleActiveAgentToolCall[]
  activeRunPhase?: JingleAgentRunPhase | null
  activeRunStartedAt?: Date | null
  isActiveTurn: boolean
  isLatestTurn: boolean
  onBranch?: (messageId: string) => Promise<void> | void
  onEditLastUserMessage?: (input: EditLastUserMessageAndInvokeInput) => Promise<boolean> | boolean
  onRetry?: (input: ComposerMessageInput) => Promise<void> | void
  pendingApproval?: HITLRequest | null
  isStreaming: boolean
  streamingAssistantId: string | null
  toolExecutions: AgentToolExecutionsView
  toolResults: Map<string, ToolResultInfo>
  turn: MessageTurn
  threadId: string
}): React.JSX.Element {
  const { copy } = useI18n()
  const {
    activeToolCalls,
    activeRunPhase,
    activeRunStartedAt,
    isActiveTurn,
    isLatestTurn,
    isStreaming,
    onBranch,
    onEditLastUserMessage,
    onRetry,
    pendingApproval,
    streamingAssistantId,
    threadId,
    toolExecutions,
    toolResults,
    turn
  } = props
  const copyText = getTurnCopyText(turn)
  const retryInput =
    turn.user && hasMessageContent(turn.user.content)
      ? toComposerMessageInput(turn.user.content, turn.user.metadata)
      : null
  const handleSubmitUserEdit = useCallback(
    async (input: EditLastUserMessageAndInvokeInput): Promise<boolean> => {
      return (await onEditLastUserMessage?.(input)) ?? false
    },
    [onEditLastUserMessage]
  )
  const assistantEntries = useMemo(
    () => buildTurnAssistantEntries(turn, { activeToolCalls, streamingAssistantId }),
    [activeToolCalls, streamingAssistantId, turn]
  )
  const turnElapsed = useMemo(
    () => projectTurnElapsedDivider({ activeRunStartedAt, isStreaming, turn }),
    [activeRunStartedAt, isStreaming, turn]
  )
  const activeTurnStatus = useMemo(
    () =>
      projectActiveTurnStatus({ activeRunPhase, assistantEntries, isStreaming, pendingApproval }),
    [activeRunPhase, assistantEntries, isStreaming, pendingApproval]
  )
  const activeTurnStatusRow =
    activeTurnStatus?.kind === "thinking" ? (
      <ThinkingMessage
        coachTip={activeTurnStatus.coachTip}
        isStreaming
        key={`thinking:${streamingAssistantId ?? "active"}`}
        text=""
      />
    ) : activeTurnStatus?.kind === "waiting_approval" ? (
      <WaitingApprovalStatusRow
        key={`${activeTurnStatus.kind}:${activeTurnStatus.toolCallId ?? "turn"}`}
      />
    ) : null
  const steeredConversationStatusRow =
    readJingleSteeringStatus(turn.user?.metadata) === "applied" ? (
      <SteeredConversationStatusRow />
    ) : null
  const { finalEntries, processEntries } = useMemo(
    () => splitAssistantProcessEntries(assistantEntries),
    [assistantEntries]
  )
  const latestEntryIndex = assistantEntries.length - 1
  const shouldFoldProcess =
    !isLatestTurn && !isStreaming && processEntries.some((item) => item.kind === "agent-activity")
  const visibleEntries = shouldFoldProcess
    ? finalEntries
    : assistantEntries.map(createAssistantProcessEntry)
  const processFold =
    shouldFoldProcess && processEntries.length > 0 ? (
      <AssistantProcessFold
        entries={processEntries}
        key="assistant-process-fold"
        pendingApproval={pendingApproval}
        threadId={threadId}
        turnElapsed={turnElapsed}
        toolExecutions={toolExecutions}
        toolResults={toolResults}
      >
        {processEntries.map((entry) =>
          renderAssistantProcessEntry({
            activeTurnStatus,
            entry,
            isStreaming,
            latestEntryIndex,
            pendingApproval,
            streamingAssistantId,
            threadId,
            toolExecutions,
            toolResults
          })
        )}
      </AssistantProcessFold>
    ) : null

  return (
    <div
      className="space-y-[var(--jingle-space-2-5)]"
      data-message-turn-active={isActiveTurn ? "true" : "false"}
      data-message-turn-folded={shouldFoldProcess ? "true" : "false"}
      data-message-turn-key={turn.key}
      data-message-turn-streaming={isStreaming ? "true" : "false"}
    >
      {turn.user ? (
        <UserMessage
          editInput={onEditLastUserMessage ? retryInput : null}
          key={`${turn.user.id}:${onEditLastUserMessage ? "editable" : "read-only"}`}
          message={turn.user}
          onSubmitEdit={onEditLastUserMessage ? handleSubmitUserEdit : undefined}
          threadId={threadId}
        />
      ) : null}
      {steeredConversationStatusRow}
      {turnElapsed && !processFold ? <TurnElapsedDivider projection={turnElapsed} /> : null}
      {activeTurnStatus?.placement === "before_entries" ? activeTurnStatusRow : null}
      {processFold}
      {visibleEntries.map((entry) =>
        renderAssistantProcessEntry({
          activeTurnStatus,
          entry,
          isStreaming,
          latestEntryIndex,
          pendingApproval,
          streamingAssistantId,
          threadId,
          toolExecutions,
          toolResults
        })
      )}
      {activeTurnStatus?.placement === "after_entries" ? activeTurnStatusRow : null}
      <ContextEvidencePanel threadId={threadId} turnId={turn.key} />
      {turn.assistants.length > 0 && !isStreaming ? (
        <MessageToolbar className="mt-0 justify-start">
          <MessageActions>
            {isActiveTurn && onRetry && retryInput ? (
              <MessageAction
                label={copy.chat.retryMessage}
                onClick={() => void onRetry(retryInput)}
                tooltip={copy.chat.retryMessage}
              >
                <RefreshCcwIcon className="size-[var(--jingle-icon-action)]" />
              </MessageAction>
            ) : null}
            {turn.branchMessageId && onBranch ? (
              <MessageAction
                label={copy.launcher.branchChat}
                onClick={() => void onBranch(turn.branchMessageId!)}
                tooltip={copy.launcher.branchChat}
              >
                <GitForkIcon className="size-[var(--jingle-icon-sm)]" />
              </MessageAction>
            ) : null}
            {copyText ? (
              <MessageAction asChild label={copy.chat.copyMessage} tooltip={copy.chat.copyMessage}>
                <CopyButton
                  className="size-[22px] rounded-[var(--jingle-radius-sm)] text-muted-foreground hover:text-foreground [&_svg]:size-[var(--jingle-icon-action)]"
                  copiedLabel={copy.common.copied}
                  copyErrorLabel={copy.common.copyFailed}
                  copyLabel={copy.chat.copyMessage}
                  iconClassName="size-[var(--jingle-icon-action)]"
                  text={copyText}
                />
              </MessageAction>
            ) : null}
          </MessageActions>
        </MessageToolbar>
      ) : null}
    </div>
  )
})
