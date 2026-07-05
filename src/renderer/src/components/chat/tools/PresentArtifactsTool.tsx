import { useMemo } from "react"
import { ArrowUpRight, PackageOpen } from "lucide-react"
import type { ArtifactRecord } from "@shared/artifacts"
import { CodeBlock } from "@/components/ui/code-block"
import { useThreadSelector } from "@/lib/thread-context"
import { cn } from "@/lib/utils"
import { defineToolComponent } from "./registry-core"
import type { ToolComponentProps } from "./types"
import { ToolDetailSection, ToolDetailStack } from "./shared-components"

function getArtifactItems(args: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(args.artifacts)
    ? args.artifacts.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : []
}

function compareArtifactByKey(a: ArtifactRecord, b: ArtifactRecord): number {
  return a.artifactKey.localeCompare(b.artifactKey)
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

const EMPTY_THREAD_ARTIFACTS: readonly ArtifactRecord[] = []

function requireToolThreadId(threadId: string | undefined, toolName: string): string {
  if (!threadId) {
    throw new Error(`Tool renderer "${toolName}" requires threadId.`)
  }

  return threadId
}

function isPresentedArtifactOpenable(artifact: ArtifactRecord): boolean {
  return artifact.source.type !== "inline-text"
}

async function openPresentedArtifact(artifact: ArtifactRecord): Promise<void> {
  const resolution = await window.api.artifacts.open(artifact.id)

  if (resolution.type === "copy-link") {
    await navigator.clipboard.writeText(resolution.value)
  }
}

export function PresentArtifactsDetail(
  props: Pick<ToolComponentProps, "copy" | "rawResult" | "threadId" | "toolCall">
): React.JSX.Element {
  const { copy, rawResult, toolCall } = props
  const threadId = requireToolThreadId(props.threadId, toolCall.name)
  const threadArtifacts = useThreadSelector(
    threadId,
    (state) => state?.agent.artifacts ?? EMPTY_THREAD_ARTIFACTS
  )
  const hasJsonResult = isJsonText(rawResult)
  const resolvedArtifacts = useMemo(() => {
    return threadArtifacts
      .filter((artifact) => artifact.toolCallId === toolCall.id)
      .toSorted(compareArtifactByKey)
  }, [threadArtifacts, toolCall.id])

  return (
    <ToolDetailStack>
      {resolvedArtifacts.length > 0 ? (
        <ToolDetailSection label={copy.toolCall.labels.present_artifacts}>
          <div className="grid gap-[var(--ow-space-1-5)]">
            {resolvedArtifacts.map((artifact) => {
              const canOpen = isPresentedArtifactOpenable(artifact)

              return (
                <button
                  className={cn(
                    "grid gap-[var(--ow-gap-xs)] rounded-[var(--ow-radius-panel)] border px-[var(--ow-space-3)] py-[var(--ow-space-2)] text-left [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] transition-colors",
                    canOpen
                      ? "border-border/70 bg-background-secondary/60 text-foreground/90 hover:bg-background-secondary hover:text-foreground"
                      : "border-border/50 bg-background-secondary/40 text-foreground/75"
                  )}
                  data-artifact-openable={canOpen ? "true" : "false"}
                  data-artifact-title={artifact.title}
                  data-presented-artifact-item=""
                  disabled={!canOpen}
                  key={artifact.id}
                  onClick={() => {
                    if (!canOpen) {
                      return
                    }

                    void openPresentedArtifact(artifact)
                  }}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-[var(--ow-gap-md)]">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">{artifact.title}</div>
                      <div className="text-muted-foreground">{artifact.kind}</div>
                    </div>
                    {canOpen ? (
                      <ArrowUpRight className="mt-[var(--ow-leading-nudge)] size-[var(--ow-icon-sm)] shrink-0 text-muted-foreground" />
                    ) : null}
                  </div>
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
  hasDetail({ args, rawResult }) {
    return getArtifactItems(args).length > 0 || rawResult.trim().length > 0
  },
  renderDisplay({ copy, args }) {
    const items = getArtifactItems(args)

    return {
      detail: items.length > 0 ? `${items.length}` : null,
      title: copy.toolCall.labels.present_artifacts
    }
  },
  renderDetail({ copy, rawResult, threadId, toolCall }) {
    return (
      <PresentArtifactsDetail
        copy={copy}
        rawResult={rawResult}
        threadId={threadId}
        toolCall={toolCall}
      />
    )
  }
})
