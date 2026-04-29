import { useMemo } from "react"
import { ArrowUpRight, PackageOpen } from "lucide-react"
import type { ArtifactRecord } from "@shared/artifacts"
import { getToolCallArtifactKey } from "@shared/artifacts"
import { CodeBlock } from "@/components/ui/code-block"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { useThreadActions, useThreadSelector } from "@/lib/thread-context"
import { cn } from "@/lib/utils"
import { defineToolComponent } from "./registry-core"
import type { ToolComponentProps } from "./types"
import { ToolDetailSection, ToolDetailStack } from "./shared-components"
import { getBasename, joinSummaryParts } from "./shared"

function getArtifactItems(args: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(args.artifacts)
    ? args.artifacts.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : []
}

function isJsonText(value: string): boolean {
  const trimmed = value.trim()

  if (!trimmed) {
    return false
  }

  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function getArtifactItemKind(item: Record<string, unknown>): string {
  return typeof item.kind === "string" ? item.kind : "artifact"
}

function getArtifactItemTitle(item: Record<string, unknown>, index: number): string {
  if (typeof item.title === "string" && item.title.trim().length > 0) {
    return item.title
  }

  if (typeof item.path === "string") {
    return getBasename(item.path)
  }

  if (typeof item.url === "string") {
    return item.url
  }

  return `Artifact ${index + 1}`
}

const EMPTY_THREAD_ARTIFACTS: readonly ArtifactRecord[] = []

export function PresentArtifactsDetail(
  props: Pick<ToolComponentProps, "args" | "copy" | "rawResult" | "toolCall">
): React.JSX.Element {
  const { args, copy, rawResult, toolCall } = props
  const currentThreadId = useHistoryShellStore((state) => state.currentThreadId)
  const threadActions = useThreadActions(currentThreadId)
  const threadArtifacts = useThreadSelector(
    currentThreadId,
    (state) => state?.artifacts ?? EMPTY_THREAD_ARTIFACTS
  )
  const items = getArtifactItems(args)
  const hasJsonResult = isJsonText(rawResult)
  const resolvedArtifacts = useMemo(() => {
    const artifactsByKey = new Map(
      threadArtifacts
        .filter((artifact) => artifact.toolCallId === toolCall.id)
        .map((artifact) => [artifact.artifactKey, artifact] satisfies [string, ArtifactRecord])
    )

    return items.map((item, index) => ({
      artifact: artifactsByKey.get(getToolCallArtifactKey(toolCall.id, index)) ?? null,
      kind: getArtifactItemKind(item),
      title: getArtifactItemTitle(item, index)
    }))
  }, [items, threadArtifacts, toolCall.id])

  return (
    <ToolDetailStack>
      {resolvedArtifacts.length > 0 ? (
        <ToolDetailSection label={copy.toolCall.labels.present_artifacts}>
          <div className="grid gap-[var(--ow-space-1-5)]">
            {resolvedArtifacts.map(({ artifact, kind, title }, index) => {
              const canOpen = Boolean(artifact && threadActions)

              return (
                <button
                  className={cn(
                    "grid gap-[var(--ow-gap-xs)] rounded-[var(--ow-radius-panel)] border px-[var(--ow-space-3)] py-[var(--ow-space-2)] text-left [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] transition-colors",
                    canOpen
                      ? "border-border/70 bg-background-secondary/60 text-foreground/90 hover:bg-background-secondary hover:text-foreground"
                      : "border-border/50 bg-background-secondary/40 text-foreground/75"
                  )}
                  data-artifact-openable={canOpen ? "true" : "false"}
                  data-artifact-title={title}
                  data-presented-artifact-item=""
                  disabled={!canOpen}
                  key={`${kind}-${title}-${index}`}
                  onClick={() => {
                    if (!artifact || !threadActions) {
                      return
                    }

                    threadActions.openArtifactTab({
                      artifactId: artifact.id,
                      kind: artifact.kind,
                      title: artifact.title
                    })
                  }}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-[var(--ow-gap-md)]">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">{title}</div>
                      <div className="text-muted-foreground">{kind}</div>
                    </div>
                    {canOpen ? (
                      <ArrowUpRight className="mt-[var(--ow-leading-nudge)] size-[var(--ow-icon-sm)] shrink-0 text-muted-foreground" />
                    ) : null}
                  </div>
                  {!canOpen ? (
                    <div className="[font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-muted-foreground">
                      Artifact not available yet
                    </div>
                  ) : null}
                </button>
              )
            })}
          </div>
        </ToolDetailSection>
      ) : null}
      {rawResult.trim() ? (
        <ToolDetailSection label={copy.common.rawResult}>
          <CodeBlock
            code={rawResult}
            filename={hasJsonResult ? "result.json" : "result.txt"}
            language={hasJsonResult ? "json" : "text"}
            maxLines={12}
          />
        </ToolDetailSection>
      ) : null}
    </ToolDetailStack>
  )
}

defineToolComponent({
  icon: PackageOpen,
  name: "present_artifacts",
  renderSummary({ copy, args }) {
    const items = getArtifactItems(args)

    return joinSummaryParts(
      copy.toolCall.labels.present_artifacts,
      items.length > 0 ? `${items.length}` : null
    )
  },
  renderDetail({ copy, args, rawResult, toolCall }) {
    return (
      <PresentArtifactsDetail args={args} copy={copy} rawResult={rawResult} toolCall={toolCall} />
    )
  }
})
