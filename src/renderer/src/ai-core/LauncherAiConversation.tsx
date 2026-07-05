import { ExternalLink, FileText, ImageIcon, Loader2, PackageOpen } from "lucide-react"
import { Messages } from "@/components/chat/Messages"
import { ChatJumpToLatestButton } from "@/components/chat/ChatJumpToLatestButton"
import { AgentErrorNotice } from "@/components/chat/AgentErrorNotice"
import { ContextEvidencePanel } from "@/components/chat/ContextEvidencePanel"
import { MemoryReviewPanel } from "@/components/chat/MemoryReviewPanel"
import { useVirtualChatScrollIntent } from "@/components/chat/useVirtualChatScrollIntent"
import { useI18n } from "@/lib/i18n"
import { useThreadSelector } from "@/lib/thread-context"
import { cn } from "@/lib/utils"
import type { EditLastUserMessageAndInvokeInput } from "@/lib/agent-control"
import type { LauncherAiThreadLoadingReason } from "./useLauncherAiThreadNavigation"
import type { ArtifactRecord, FileArtifactRecord } from "@shared/artifacts"
import type { ComposerMessageInput, ComposerMessageRef } from "@shared/message-content"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { VListHandle } from "virtua"

const EMPTY_ARTIFACTS: readonly ArtifactRecord[] = []
const LAUNCHER_AI_AT_BOTTOM_THRESHOLD_PX = 60
type AssistantSelectionRef = Extract<ComposerMessageRef, { type: "assistant-message-selection" }>

type ArtifactImagePreviewState =
  | {
      status: "error"
    }
  | {
      src: string
      status: "ready"
    }
  | {
      status: "loading"
    }

function formatArtifactSize(bytes: number | null): string | null {
  if (bytes === null) {
    return null
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function getArtifactExtension(artifact: ArtifactRecord): string | null {
  if (artifact.source.type !== "managed-file-path") {
    return null
  }

  const fileName = artifact.source.uri.split(/[\\/]/).at(-1) ?? ""
  const extension = fileName.includes(".") ? fileName.split(".").at(-1) : null
  return extension ? extension.toUpperCase() : null
}

function isImageArtifact(artifact: ArtifactRecord): artifact is FileArtifactRecord {
  if (artifact.kind !== "file" || artifact.source.type !== "managed-file-path") {
    return false
  }

  if (artifact.mimeType?.startsWith("image/")) {
    return true
  }

  return /\.(avif|gif|jpe?g|png|webp)$/i.test(artifact.source.uri)
}

function compareArtifactsByCreatedAt(a: ArtifactRecord, b: ArtifactRecord): number {
  return b.createdAt.getTime() - a.createdAt.getTime()
}

function getArtifactMeta(artifact: ArtifactRecord): string {
  return (
    artifact.subtitle ??
    artifact.previewText ??
    formatArtifactSize(artifact.sizeBytes) ??
    artifact.mimeType ??
    getArtifactExtension(artifact) ??
    artifact.kind
  )
}

function isLauncherArtifactOpenable(artifact: ArtifactRecord): boolean {
  return artifact.source.type !== "inline-text"
}

async function openLauncherArtifact(artifact: ArtifactRecord): Promise<void> {
  const resolution = await window.api.artifacts.open(artifact.id)

  if (resolution.type === "copy-link") {
    await navigator.clipboard.writeText(resolution.value)
  }
}

function LauncherArtifactTypeIcon(props: { artifact: ArtifactRecord }): React.JSX.Element {
  const { artifact } = props

  if (artifact.kind === "link") {
    return <ExternalLink className="size-[var(--ow-icon-sm)] text-muted-foreground" />
  }

  if (artifact.kind === "file") {
    return <FileText className="size-[var(--ow-icon-sm)] text-muted-foreground" />
  }

  return <PackageOpen className="size-[var(--ow-icon-sm)] text-muted-foreground" />
}

function LauncherAiPresenceMark(): React.JSX.Element {
  return (
    <div className="launcher-ai-presence" aria-hidden="true">
      <div className="launcher-ai-presence__halo" />
      <svg
        className="launcher-ai-presence__mark"
        viewBox="0 0 100 100"
        role="img"
        focusable="false"
      >
        <path
          className="launcher-ai-presence__capsule"
          d="M24 50c0-10 8-18 18-18h20c10 0 18 8 18 18s-8 18-18 18H42c-10 0-18-8-18-18Z"
        />
        <circle className="launcher-ai-presence__lens" cx="35" cy="50" r="7" />
        <path className="launcher-ai-presence__lens-handle" d="M42 57l8 8" />
        <path className="launcher-ai-presence__mouth" d="M52 50h12" />
        <circle className="launcher-ai-presence__eye" cx="71" cy="50" r="7" />
        <path className="launcher-ai-presence__signal" d="M61 25c8-5 18-3 25 5" />
      </svg>
    </div>
  )
}

function LauncherArtifactImagePreview(props: { artifact: FileArtifactRecord }): React.JSX.Element {
  const { artifact } = props
  const [preview, setPreview] = useState<ArtifactImagePreviewState>({ status: "loading" })

  useEffect(() => {
    let isCancelled = false

    async function loadPreview(): Promise<void> {
      const result = await window.api.artifacts.readBinaryFile(artifact.id)
      if (isCancelled) {
        return
      }

      if (!result.success || !result.content) {
        setPreview({ status: "error" })
        return
      }

      setPreview({
        src: `data:${artifact.mimeType ?? "image/png"};base64,${result.content}`,
        status: "ready"
      })
    }

    void loadPreview().catch(() => {
      if (!isCancelled) {
        setPreview({ status: "error" })
      }
    })

    return () => {
      isCancelled = true
    }
  }, [artifact.id, artifact.mimeType])

  if (preview.status === "ready") {
    return (
      <img
        alt={artifact.title}
        className="h-full w-full object-cover"
        draggable={false}
        src={preview.src}
      />
    )
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-background-secondary">
      {preview.status === "loading" ? (
        <Loader2 className="size-[var(--ow-icon-md)] animate-spin text-muted-foreground" />
      ) : (
        <ImageIcon className="size-[var(--ow-icon-lg)] text-muted-foreground" />
      )}
    </div>
  )
}

function LauncherArtifactCard(props: { artifact: ArtifactRecord }): React.JSX.Element {
  const { artifact } = props
  const isImage = isImageArtifact(artifact)
  const isOpenable = isLauncherArtifactOpenable(artifact)
  const meta = getArtifactMeta(artifact)
  const className = cn(
    "group flex min-w-0 flex-col overflow-hidden rounded-[var(--ow-radius-panel)] border border-border/70 bg-background-secondary/60 text-left transition-colors",
    isOpenable ? "hover:border-border hover:bg-background-secondary" : "cursor-default",
    isImage ? "sm:col-span-1" : "px-[var(--ow-space-3)] py-[var(--ow-space-2)]"
  )
  const content = (
    <>
      {isImage ? (
        <div className="aspect-[4/3] w-full overflow-hidden bg-background-secondary">
          <LauncherArtifactImagePreview
            key={`${artifact.id}:${artifact.updatedAt.toISOString()}`}
            artifact={artifact}
          />
        </div>
      ) : null}

      <div
        className={cn(
          "flex min-w-0 items-start gap-[var(--ow-gap-md)]",
          isImage ? "px-[var(--ow-space-3)] py-[var(--ow-space-2)]" : null
        )}
      >
        {!isImage ? (
          <div className="flex size-[var(--ow-icon-lg)] shrink-0 items-center justify-center rounded-[var(--ow-radius-md)] bg-background">
            <LauncherArtifactTypeIcon artifact={artifact} />
          </div>
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="truncate [font-size:var(--ow-font-body)] font-medium leading-[var(--ow-line-control)] text-foreground">
            {artifact.title}
          </div>
          <div className="mt-[var(--ow-leading-nudge)] truncate [font-size:var(--ow-font-meta)] leading-[var(--ow-line-control-sm)] text-muted-foreground">
            {meta}
          </div>
        </div>
      </div>
    </>
  )

  if (!isOpenable) {
    return (
      <div
        className={className}
        data-launcher-artifact-card=""
        data-launcher-artifact-kind={artifact.kind}
        data-launcher-artifact-openable="false"
        data-launcher-artifact-title={artifact.title}
      >
        {content}
      </div>
    )
  }

  return (
    <button
      className={className}
      data-launcher-artifact-card=""
      data-launcher-artifact-kind={artifact.kind}
      data-launcher-artifact-openable="true"
      data-launcher-artifact-title={artifact.title}
      onClick={() => void openLauncherArtifact(artifact)}
      type="button"
    >
      {content}
    </button>
  )
}

function LauncherArtifactsPanel(props: {
  artifacts: readonly ArtifactRecord[]
}): React.JSX.Element | null {
  const { artifacts } = props
  const { copy } = useI18n()
  const visibleArtifacts = useMemo(
    () =>
      artifacts
        .filter((artifact) => artifact.status === "ready")
        .toSorted(compareArtifactsByCreatedAt)
        .slice(0, 6),
    [artifacts]
  )

  if (visibleArtifacts.length === 0) {
    return null
  }

  return (
    <section className="flex min-w-0 flex-col gap-[var(--ow-space-2)]" data-launcher-artifacts="">
      <div className="flex items-center justify-between gap-[var(--ow-gap-md)]">
        <div className="[font-size:var(--ow-font-meta)] font-medium uppercase tracking-normal text-muted-foreground">
          {copy.toolCall.labels.present_artifacts}
        </div>
        <div className="[font-size:var(--ow-font-meta)] text-muted-foreground">
          {visibleArtifacts.length}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-[var(--ow-space-2)] sm:grid-cols-2">
        {visibleArtifacts.map((artifact) => (
          <LauncherArtifactCard artifact={artifact} key={artifact.id} />
        ))}
      </div>
    </section>
  )
}

const LauncherAiFooter = memo(function LauncherAiFooter(props: {
  clearError: () => void
  error: string | null
  isLoading: boolean
  threadId: string
}): React.JSX.Element {
  const { clearError, error, isLoading, threadId } = props
  const artifacts = useThreadSelector(
    threadId,
    (state) => state?.agent.artifacts ?? EMPTY_ARTIFACTS
  )

  return (
    <div className="flex w-full min-w-0 flex-col gap-[var(--launcher-ai-turn-gap)]">
      <LauncherArtifactsPanel artifacts={artifacts} />

      {!isLoading && <ContextEvidencePanel threadId={threadId} />}

      {!isLoading && <MemoryReviewPanel threadId={threadId} />}

      {error && !isLoading && <AgentErrorNotice error={error} onDismiss={clearError} />}
    </div>
  )
})

export function LauncherAiEmptyState(props: { error?: string | null }): React.JSX.Element {
  const { copy } = useI18n()
  const { error } = props

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden px-[var(--launcher-ai-content-x)]">
      <div className="relative flex w-full max-w-[var(--launcher-ai-empty-max-width)] flex-col items-center text-center">
        <LauncherAiPresenceMark />
        <div className="text-section-header mb-[var(--ow-space-2-5)]">
          {copy.launcher.aiEmptyEyebrow}
        </div>
        <h1 className="[font-size:var(--launcher-ai-empty-title)] font-semibold tracking-normal text-foreground sm:[font-size:var(--launcher-ai-empty-title-wide)]">
          {copy.launcher.aiHeroTitle}
        </h1>
        <p className="mt-[var(--ow-space-3)] max-w-[var(--launcher-ai-empty-copy-max-width)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-muted-foreground">
          {copy.launcher.aiHeroDescription}
        </p>
        {error ? <AgentErrorNotice className="mt-[var(--ow-space-6)]" error={error} /> : null}
      </div>
    </div>
  )
}

export function LauncherAiThreadLoadingState(props: {
  reason: LauncherAiThreadLoadingReason | null
}): React.JSX.Element {
  const { copy } = useI18n()
  const label =
    props.reason === "restoring" ? copy.launcher.restoringThread : copy.launcher.openingThread

  return (
    <div className="relative flex flex-1 items-center justify-center px-[var(--launcher-ai-content-x)] text-muted-foreground">
      <div className="flex items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-body)]">
        <Loader2 className="size-[var(--ow-icon-md)] animate-spin" />
        <span>{label}</span>
      </div>
    </div>
  )
}

export function LauncherAiConversation(props: {
  clearError: () => void
  error: string | null
  isHydrating: boolean
  isLoading: boolean
  loadingReason: LauncherAiThreadLoadingReason | null
  onBranch?: (messageId?: string) => Promise<void>
  onAddAssistantSelectionRef?: (ref: AssistantSelectionRef) => void
  onEditLastUserMessage?: (input: EditLastUserMessageAndInvokeInput) => Promise<boolean> | boolean
  onRetry: (input: ComposerMessageInput) => Promise<void> | void
  threadId: string
}): React.JSX.Element {
  const {
    clearError,
    error,
    isHydrating,
    isLoading,
    loadingReason,
    onBranch,
    onAddAssistantSelectionRef,
    onEditLastUserMessage,
    onRetry,
    threadId
  } = props

  return (
    <LauncherAiConversationViewport
      clearError={clearError}
      error={error}
      isHydrating={isHydrating}
      isLoading={isLoading}
      loadingReason={loadingReason}
      onBranch={onBranch}
      onAddAssistantSelectionRef={onAddAssistantSelectionRef}
      onEditLastUserMessage={onEditLastUserMessage}
      onRetry={onRetry}
      threadId={threadId}
    />
  )
}

const LauncherAiConversationViewport = memo(function LauncherAiConversationViewport(props: {
  clearError: () => void
  error: string | null
  isHydrating: boolean
  isLoading: boolean
  loadingReason: LauncherAiThreadLoadingReason | null
  onBranch?: (messageId?: string) => Promise<void>
  onAddAssistantSelectionRef?: (ref: AssistantSelectionRef) => void
  onEditLastUserMessage?: (input: EditLastUserMessageAndInvokeInput) => Promise<boolean> | boolean
  onRetry: (input: ComposerMessageInput) => Promise<void> | void
  threadId: string
}): React.JSX.Element {
  const { copy } = useI18n()
  const {
    clearError,
    error,
    isHydrating,
    isLoading,
    loadingReason,
    onBranch,
    onAddAssistantSelectionRef,
    onEditLastUserMessage,
    onRetry,
    threadId
  } = props
  const virtualizerRef = useRef<VListHandle>(null)
  const hasVisibleTurns = useThreadSelector(
    threadId,
    (state) => (state?.view.messageProjection.turns.length ?? 0) > 0
  )
  const displayRowCount = useThreadSelector(
    threadId,
    (state) => state?.view.messageProjection.displayRows.length ?? 0
  )
  const canFork = useThreadSelector(threadId, (state) => state?.agent.forkState.canFork ?? true)
  const chatVirtualItemCount = hasVisibleTurns || isLoading || error ? displayRowCount : 0
  const {
    forceScrollToLatest,
    handleScroll,
    handleScrollEnd,
    isAtBottom,
    isScrolling,
    jumpToLatestOffsetPx,
    markUserScrollIntent,
    scrollToLatest,
    showJumpToLatest
  } = useVirtualChatScrollIntent({
    atBottomThresholdPx: LAUNCHER_AI_AT_BOTTOM_THRESHOLD_PX,
    resetKey: threadId,
    totalCount: chatVirtualItemCount,
    virtualizerRef
  })
  const renderFooter = useCallback(
    () => (
      <LauncherAiFooter
        clearError={clearError}
        error={error}
        isLoading={isLoading}
        threadId={threadId}
      />
    ),
    [clearError, error, isLoading, threadId]
  )

  if (!hasVisibleTurns && isHydrating && !error) {
    return <LauncherAiThreadLoadingState reason={loadingReason} />
  }

  if (!hasVisibleTurns && !isLoading && !error) {
    return <LauncherAiEmptyState />
  }

  return (
    <div className="relative min-h-0 flex-1">
      <Messages
        contentClassName="mx-auto w-full min-w-0 max-w-[var(--launcher-ai-content-max-width)] px-[var(--launcher-ai-content-x)]"
        contentInsetY="var(--launcher-ai-content-y)"
        isAtBottom={isAtBottom}
        isLoading={isLoading}
        isScrolling={isScrolling}
        onBranch={canFork ? onBranch : undefined}
        onAddAssistantSelectionRef={onAddAssistantSelectionRef}
        onEditLastUserMessage={onEditLastUserMessage}
        onRetry={onRetry}
        renderFooter={renderFooter}
        onScroll={handleScroll}
        onScrollEnd={handleScrollEnd}
        onScrollToLatest={scrollToLatest}
        onUserScrollIntent={markUserScrollIntent}
        threadId={threadId}
        virtualizerRef={virtualizerRef}
      />
      {showJumpToLatest ? (
        <div
          className="pointer-events-none absolute inset-x-0 z-30 flex justify-center px-[var(--launcher-ai-composer-page-x)]"
          style={{
            bottom: jumpToLatestOffsetPx
          }}
        >
          <ChatJumpToLatestButton
            className="pointer-events-auto"
            isLoading={isLoading}
            label={copy.launcher.jumpToLatest}
            onClick={forceScrollToLatest}
          />
        </div>
      ) : null}
    </div>
  )
})
