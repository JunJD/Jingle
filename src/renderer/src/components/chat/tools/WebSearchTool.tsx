import { ChevronDown, ExternalLink, Search } from "lucide-react"
import {
  parseWebSearchResponseForQuery,
  type WebSearchResponse,
  type WebSearchResult
} from "@shared/web-search"
import { defineToolComponent } from "./registry-core"
import { ToolCodeBlock, ToolContractNotice, ToolDetailStack } from "./shared-components"
import { projectRequiredStringArg, truncateMiddle } from "./shared"
import type { ToolComponentStatus, ToolRendererCommands } from "./types"

type WebSearchResultProjection =
  | { kind: "absent" }
  | { kind: "error"; text: string }
  | { field: "result"; kind: "invalid" }
  | { kind: "ready"; response: WebSearchResponse }

function projectWebSearchResult(input: {
  query: string | null
  rawResult: string
  result: unknown
  status: ToolComponentStatus
}): WebSearchResultProjection {
  if (input.status === "failed") {
    return input.rawResult.trim()
      ? { kind: "error", text: input.rawResult }
      : { field: "result", kind: "invalid" }
  }

  const response = input.query ? parseWebSearchResponseForQuery(input.result, input.query) : null
  if (response) {
    return { kind: "ready", response }
  }

  return input.status === "complete" ? { field: "result", kind: "invalid" } : { kind: "absent" }
}

function renderSearchResultsList(
  items: readonly WebSearchResult[],
  openExternal: ToolRendererCommands["openExternal"]
): React.JSX.Element {
  return (
    <div className="grid gap-[var(--jingle-gap-sm)]">
      {items.slice(0, 5).map((item, index) => (
        <details
          key={`${item.url}-${index}`}
          className="group rounded-[var(--jingle-radius-lg)] border border-border/60 bg-background/40"
        >
          <summary className="flex cursor-pointer list-none items-start gap-[var(--jingle-gap-md)] p-[var(--jingle-space-3)] [&::-webkit-details-marker]:hidden">
            <div className="grid min-w-0 flex-1 gap-[var(--jingle-gap-xs)]">
              <div className="[font-size:var(--jingle-font-body)] font-medium leading-[var(--jingle-line-chat)] text-foreground">
                {item.title}
              </div>
              <div className="break-all font-mono [font-size:var(--jingle-font-meta)] leading-[var(--jingle-line-body)] text-muted-foreground">
                {item.url}
              </div>
            </div>
            <ChevronDown className="mt-[var(--jingle-leading-nudge)] size-[var(--jingle-icon-sm)] shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>

          <div className="grid gap-[var(--jingle-gap-sm)] border-t border-border/50 px-[var(--jingle-space-3)] py-[var(--jingle-space-2-5)]">
            {item.snippet ? (
              <div className="whitespace-pre-wrap break-words [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-chat)] text-foreground/80">
                {item.snippet}
              </div>
            ) : null}

            <div>
              <button
                type="button"
                className="inline-flex items-center gap-[var(--jingle-space-1-5)] [font-size:var(--jingle-font-meta)] font-medium leading-[var(--jingle-line-body)] text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => {
                  void openExternal(item.url).catch((error) => {
                    console.error("[WebSearchTool] Failed to open search result.", error)
                  })
                }}
              >
                <ExternalLink className="size-[var(--jingle-icon-sm)]" />
                Open Source
              </button>
            </div>
          </div>
        </details>
      ))}
    </div>
  )
}

defineToolComponent({
  name: "web_search",
  icon: Search,
  project({ args, rawResult, result, status }) {
    const query = projectRequiredStringArg(args, "query", status === "arguments_streaming")

    return {
      query,
      queryDetail: query.kind === "ready" ? truncateMiddle(query.value, 60) : null,
      result: projectWebSearchResult({
        query: query.kind === "ready" ? query.value : null,
        rawResult,
        result,
        status
      })
    }
  },
  hasDetail({ viewModel }) {
    return viewModel.query.kind === "invalid" || viewModel.result.kind !== "absent"
  },
  renderDisplay({ copy, viewModel }) {
    return {
      detail: viewModel.queryDetail,
      title: copy.toolCall.labels.web_search
    }
  },
  renderDetail({ commands, copy, viewModel }) {
    return (
      <ToolDetailStack>
        {viewModel.query.kind === "invalid" ? (
          <ToolContractNotice copy={copy} field={viewModel.query.field} />
        ) : viewModel.query.kind === "ready" ? (
          <ToolCodeBlock className="text-[var(--jingle-agent-timeline-muted)]">
            {viewModel.query.value}
          </ToolCodeBlock>
        ) : null}
        {viewModel.result.kind === "invalid" ? (
          <ToolContractNotice copy={copy} field={viewModel.result.field} />
        ) : viewModel.result.kind === "error" ? (
          <ToolCodeBlock>{viewModel.result.text}</ToolCodeBlock>
        ) : viewModel.result.kind === "ready" && viewModel.result.response.results.length > 0 ? (
          renderSearchResultsList(viewModel.result.response.results, commands.openExternal)
        ) : null}
      </ToolDetailStack>
    )
  }
})
