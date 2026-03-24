import { useEffect } from "react"
import type { LauncherFeaturePageRenderProps } from "./types"
import { useLauncherAiSession } from "../hooks/useLauncherAiSession"
import { LauncherAiConversation, LauncherAiEmptyState } from "./LauncherAiConversation"
import { LauncherAiPageChrome } from "./LauncherAiPageChrome"
import { AI_PAGE_CHROME, AI_PAGE_VIEWPORT_HEIGHT } from "./ai-config"

export function LauncherAiPage(props: LauncherFeaturePageRenderProps): React.JSX.Element {
  const { inputRef, onBack, onViewportHeightChange, seedQuery } = props

  useEffect(() => {
    onViewportHeightChange(AI_PAGE_VIEWPORT_HEIGHT)
  }, [onViewportHeightChange])

  const session = useLauncherAiSession({
    seedQuery,
    onBack
  })

  return (
    <LauncherAiPageChrome
      chrome={AI_PAGE_CHROME}
      inputRef={inputRef}
      onBack={onBack}
      onInputKeyDown={session.handleInputKeyDown}
      onPrimaryAction={session.runPrimaryAction}
      primaryActionDisabled={session.primaryActionDisabled}
      query={session.query}
      setQuery={session.setQuery}
    >
      {session.threadId ? (
        <LauncherAiConversation
          clearError={session.conversation.clearVisibleError}
          displayMessages={session.conversation.displayMessages}
          error={session.conversation.visibleError}
          isLoading={session.conversation.isLoading}
          onApprovalDecision={session.handleApprovalDecision}
          pendingApproval={session.conversation.pendingApproval}
          todos={session.conversation.todos}
          toolResults={session.conversation.toolResults}
        />
      ) : (
        <LauncherAiEmptyState error={session.conversation.visibleError} />
      )}
    </LauncherAiPageChrome>
  )
}
