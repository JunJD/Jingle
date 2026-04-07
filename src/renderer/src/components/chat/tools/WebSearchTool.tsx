import { ChevronDown, ExternalLink, Search } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolCodeBlock, ToolDetailStack } from "./shared-components"
import { getPatternArg, joinSummaryParts, truncateMiddle } from "./shared"

interface SearchResultItem {
  snippet?: string
  title?: string
  url?: string
}

interface SearchResultPayload {
  results?: SearchResultItem[]
}

function getSearchPayload(value: unknown): SearchResultPayload | null {
  if (value && typeof value === "object") {
    return value as SearchResultPayload
  }

  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null
  }

  try {
    const parsed = JSON.parse(trimmed)
    return parsed && typeof parsed === "object" ? (parsed as SearchResultPayload) : null
  } catch {
    return null
  }
}

function openSearchResult(url: string): void {
  void window.electron.openExternal(url).catch((error) => {
    console.error("[WebSearchTool] Failed to open external link.", error)
  })
}

function renderSearchResultsList(
  items: Array<Required<Pick<SearchResultItem, "title" | "url">> & SearchResultItem>
): React.JSX.Element {
  return (
    <div className="grid gap-2">
      {items.slice(0, 5).map((item, index) => (
        <details
          key={`${item.url}-${index}`}
          className="group rounded-lg border border-border/60 bg-background/40"
        >
          <summary className="flex cursor-pointer list-none items-start gap-3 p-3 [&::-webkit-details-marker]:hidden">
            <div className="grid min-w-0 flex-1 gap-1">
              <div className="text-[12px] font-medium leading-5 text-foreground">{item.title}</div>
              <div className="break-all font-mono text-[11px] leading-4 text-muted-foreground">
                {item.url}
              </div>
            </div>
            <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>

          <div className="grid gap-2 border-t border-border/50 px-3 py-2.5">
            {item.snippet ? (
              <div className="whitespace-pre-wrap break-words text-[12px] leading-5 text-foreground/80">
                {item.snippet}
              </div>
            ) : null}

            <div>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-[11px] font-medium leading-4 text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => {
                  openSearchResult(item.url)
                }}
              >
                <ExternalLink className="size-3.5" />
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
  renderSummary({ copy, args, status }) {
    const query = getPatternArg(args)
    const statusLabel =
      status === "running"
        ? copy.common.running
        : status === "approval"
          ? copy.common.approval
          : null

    return joinSummaryParts(
      copy.toolCall.labels.web_search,
      query ? truncateMiddle(query, 60) : null,
      statusLabel
    )
  },
  renderDetail({ args, rawResult, result }) {
    const query = getPatternArg(args)
    const payload = getSearchPayload(result) ?? getSearchPayload(rawResult)
    const results = Array.isArray(payload?.results)
      ? payload.results.filter(
          (item): item is Required<Pick<SearchResultItem, "title" | "url">> & SearchResultItem =>
            Boolean(item?.title) && Boolean(item?.url)
        )
      : []

    if (!query && !rawResult) {
      return null
    }

    return (
      <ToolDetailStack>
        {query ? <ToolCodeBlock>{query}</ToolCodeBlock> : null}
        {results.length > 0 ? (
          renderSearchResultsList(results)
        ) : !payload && rawResult ? (
          <ToolCodeBlock>{rawResult}</ToolCodeBlock>
        ) : null}
      </ToolDetailStack>
    )
  }
})
