import { useMemo } from "react"
import { ArrowUpRight, PackageOpen } from "lucide-react"
import type { ArtifactRecord } from "@shared/artifacts"
import { CodeBlock } from "@/components/ui/code-block"
import type { AppCopy } from "@/lib/i18n/messages"
import { useThreadSelector } from "@/lib/thread-context"
import { cn } from "@/lib/utils"
import { defineToolComponent } from "./registry-core"
import type { ToolRendererCommands } from "./types"
import { ToolContractNotice, ToolDetailSection, ToolDetailStack } from "./shared-components"

type PresentArtifactsArgsProjection =
  | { field: "artifacts"; kind: "invalid" }
  | { kind: "pending" }
  | { itemCount: number; kind: "ready" }

function projectPresentArtifactsArgs(
  args: Record<string, unknown>,
  allowPending: boolean
): PresentArtifactsArgsProjection {
  if (!Array.isArray(args.artifacts) || args.artifacts.length === 0) {
    return allowPending ? { kind: "pending" } : { field: "artifacts", kind: "invalid" }
  }

  const validKinds = new Set(["file", "link", "patch", "summary"])
  const isValid = args.artifacts.every(
    (item) =>
      Boolean(item) &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      "kind" in item &&
      typeof item.kind === "string" &&
      validKinds.has(item.kind)
  )

  return isValid
    ? { itemCount: args.artifacts.length, kind: "ready" }
    : allowPending
      ? { kind: "pending" }
      : { field: "artifacts", kind: "invalid" }
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

function isPresentedArtifactOpenable(artifact: ArtifactRecord): boolean {
  return artifact.source.type !== "inline-text"
}

interface PresentArtifactsViewModel {
  args: PresentArtifactsArgsProjection
  hasJsonResult: boolean
  rawResult: string
  threadId: string
  toolCallId: string
}

export function PresentArtifactsDetail(props: {
  copy: AppCopy
  openArtifact: ToolRendererCommands["openArtifact"]
  viewModel: PresentArtifactsViewModel
}): React.JSX.Element {
  const { copy, openArtifact, viewModel } = props
  const threadArtifacts = useThreadSelector(
    viewModel.threadId,
    (state) => state?.agent.artifacts ?? EMPTY_THREAD_ARTIFACTS
  )
  const resolvedArtifacts = useMemo(() => {
    return threadArtifacts
      .filter((artifact) => artifact.toolCallId === viewModel.toolCallId)
      .toSorted(compareArtifactByKey)
  }, [threadArtifacts, viewModel.toolCallId])

  return (
    <ToolDetailStack>
      {viewModel.args.kind === "invalid" ? (
        <ToolContractNotice copy={copy} field={viewModel.args.field} />
      ) : null}
      {resolvedArtifacts.length > 0 ? (
        <ToolDetailSection label={copy.toolCall.labels.present_artifacts}>
          <div className="grid gap-[var(--jingle-space-1-5)]">
            {resolvedArtifacts.map((artifact) => {
              const canOpen = isPresentedArtifactOpenable(artifact)

              return (
                <button
                  className={cn(
                    "grid gap-[var(--jingle-gap-xs)] rounded-[var(--jingle-radius-panel)] border px-[var(--jingle-space-3)] py-[var(--jingle-space-2)] text-left [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-chat)] transition-colors",
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

                    void openArtifact(artifact.id).catch((error) => {
                      console.error("[PresentArtifactsTool] Failed to open artifact.", error)
                    })
                  }}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-[var(--jingle-gap-md)]">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">{artifact.title}</div>
                      <div className="text-muted-foreground">{artifact.kind}</div>
                    </div>
                    {canOpen ? (
                      <ArrowUpRight className="mt-[var(--jingle-leading-nudge)] size-[var(--jingle-icon-sm)] shrink-0 text-muted-foreground" />
                    ) : null}
                  </div>
                </button>
              )
            })}
          </div>
        </ToolDetailSection>
      ) : null}
      {viewModel.rawResult.trim() ? (
        <ToolDetailSection label={copy.common.rawResult}>
          <CodeBlock
            code={viewModel.rawResult}
            filename={viewModel.hasJsonResult ? "result.json" : "result.txt"}
            language={viewModel.hasJsonResult ? "json" : "text"}
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
  project({ args, rawResult, status, threadId, toolCall }) {
    return {
      args: projectPresentArtifactsArgs(args, status === "arguments_streaming"),
      hasJsonResult: isJsonText(rawResult),
      rawResult,
      threadId,
      toolCallId: toolCall.id
    }
  },
  hasDetail({ viewModel }) {
    return (
      viewModel.args.kind === "invalid" ||
      (viewModel.args.kind === "ready" && viewModel.args.itemCount > 0) ||
      viewModel.rawResult.trim().length > 0
    )
  },
  renderDisplay({ copy, viewModel }) {
    return {
      detail: viewModel.args.kind === "ready" ? `${viewModel.args.itemCount}` : null,
      title: copy.toolCall.labels.present_artifacts
    }
  },
  renderDetail({ commands, copy, viewModel }) {
    return (
      <PresentArtifactsDetail
        copy={copy}
        openArtifact={commands.openArtifact}
        viewModel={viewModel}
      />
    )
  }
})
