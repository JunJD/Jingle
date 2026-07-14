import { ChevronDown, ExternalLink, Search } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolCodeBlock, ToolDetailStack } from "./shared-components"
import { getQueryArg, truncateMiddle } from "./shared"

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
                  openSearchResult(item.url)
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
  hasDetail({ args, rawResult }) {
    return Boolean(getQueryArg(args) || rawResult)
  },
  renderDisplay({ copy, args }) {
    const query = getQueryArg(args)

    return {
      detail: query ? truncateMiddle(query, 60) : null,
      title: copy.toolCall.labels.web_search
    }
  },
  renderDetail({ args, rawResult, result }) {
    const query = getQueryArg(args)
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
        {query ? (
          <ToolCodeBlock className="text-[var(--jingle-agent-timeline-muted)]">{query}</ToolCodeBlock>
        ) : null}
        {results.length > 0 ? (
          renderSearchResultsList(results)
        ) : !payload && rawResult ? (
          <ToolCodeBlock>{rawResult}</ToolCodeBlock>
        ) : null}
      </ToolDetailStack>
    )
  }
})
