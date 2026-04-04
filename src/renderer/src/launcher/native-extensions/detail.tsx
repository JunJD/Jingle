import { cjk } from "@streamdown/cjk"
import { code } from "@streamdown/code"
import { math } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"
import { LoaderCircle } from "lucide-react"
import { Children, isValidElement, useMemo, useState, type ReactNode } from "react"
import { Streamdown } from "streamdown"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { collectActions } from "./actions"
import { NativeSurfaceBackButton, NativeSurfaceChrome } from "./chrome"
import { NativeActionOverlay } from "./ui"

const streamdownPlugins = { cjk, code, math, mermaid }

type DetailMarkerRole = "detail-metadata" | "detail-metadata-label" | "detail-metadata-tag-list"

interface DetailMarkerComponent<P = object> extends React.FC<P> {
  __detailRole: DetailMarkerRole
}

function createDetailMarkerComponent<P = object>(role: DetailMarkerRole): DetailMarkerComponent<P> {
  const Component = (() => null) as unknown as DetailMarkerComponent<P>
  Component.__detailRole = role
  return Component
}

const DetailMetadataMarker = createDetailMarkerComponent<{ children?: ReactNode }>(
  "detail-metadata"
)
const DetailMetadataLabelMarker = createDetailMarkerComponent<{
  text: string
  title: string
}>("detail-metadata-label")
const DetailMetadataTagListMarker = createDetailMarkerComponent<{
  tags: string[]
  title: string
}>("detail-metadata-tag-list")

interface DetailMetadataEntry {
  text: string
  title: string
}

function extractDetailMarkerRole(node: ReactNode): DetailMarkerRole | null {
  if (!isValidElement(node)) {
    return null
  }

  const marker = node.type as DetailMarkerComponent
  return marker.__detailRole ?? null
}

function collectMetadataEntries(node: ReactNode): DetailMetadataEntry[] {
  const entries: DetailMetadataEntry[] = []

  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) {
      continue
    }

    const role = extractDetailMarkerRole(child)
    if (role === "detail-metadata") {
      entries.push(...collectMetadataEntries((child.props as { children?: ReactNode }).children))
      continue
    }

    if (role === "detail-metadata-label") {
      const props = child.props as { text: string; title: string }
      entries.push({
        text: props.text,
        title: props.title
      })
      continue
    }

    if (role === "detail-metadata-tag-list") {
      const props = child.props as { tags: string[]; title: string }
      entries.push({
        text: props.tags.join(", "),
        title: props.title
      })
    }
  }

  return entries
}

function DetailRoot(props: {
  actions?: React.ReactElement | null
  isLoading?: boolean
  markdown?: string
  metadata?: ReactNode
  navigationTitle?: string
}): React.JSX.Element {
  const { actions, isLoading = false, markdown, metadata, navigationTitle } = props
  const [showActions, setShowActions] = useState(false)
  const actionItems = useMemo(
    () =>
      actions
        ? collectActions(actions, {
            nextId: (() => {
              let counter = 0
              return () => `detail-action-${counter++}`
            })()
          })
        : [],
    [actions]
  )
  const primaryAction = actionItems[0] ?? null
  const metadataEntries = useMemo(() => collectMetadataEntries(metadata), [metadata])

  return (
    <div className="relative h-full">
      <NativeSurfaceChrome
        footer={
          <>
            <div className="truncate text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
              {navigationTitle ?? "Detail"}
            </div>

            <div className="flex items-center gap-2">
              {actionItems.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setShowActions(true)}
                  onMouseDown={(event) => event.preventDefault()}
                  className="launcher-action-link flex items-center gap-2 rounded-[10px] px-3 py-1 text-[13px] font-medium text-foreground"
                >
                  <span>Actions</span>
                  <span className="launcher-shortcut text-[11px] text-muted-foreground">⌘K</span>
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  if (primaryAction) {
                    void Promise.resolve(primaryAction.onAction())
                  }
                }}
                onMouseDown={(event) => event.preventDefault()}
                disabled={!primaryAction}
                className="launcher-action-link flex items-center gap-2 rounded-[10px] px-3 py-1 text-[13px] font-medium text-foreground disabled:opacity-40"
              >
                <span>{primaryAction?.title ?? "Open"}</span>
                <span className="launcher-shortcut text-[11px] text-muted-foreground">↵</span>
              </button>
            </div>
          </>
        }
        headerLeading={<NativeSurfaceBackButton />}
        surface="native-detail"
        title={navigationTitle}
      >
        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="flex h-full items-center justify-center gap-3 text-[13px] text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              <span>Loading...</span>
            </div>
          ) : (
            <div
              className={cn(
                "grid h-full min-h-full gap-6 px-6 py-5",
                metadataEntries.length > 0 ? "grid-cols-[minmax(0,1fr)_280px]" : "grid-cols-1"
              )}
            >
              <div className="min-w-0">
                {markdown ? (
                  <div className="native-detail-markdown text-[14px] leading-7 text-foreground">
                    <Streamdown parseIncompleteMarkdown={false} plugins={streamdownPlugins}>
                      {markdown}
                    </Streamdown>
                  </div>
                ) : (
                  <div className="text-[13px] text-muted-foreground">No details available.</div>
                )}
              </div>

              {metadataEntries.length > 0 ? (
                <div className="space-y-3 rounded-2xl border border-border/80 bg-background-elevated/70 p-4">
                  <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Metadata
                  </div>
                  <div className="space-y-3">
                    {metadataEntries.map((entry) => (
                      <div key={`${entry.title}:${entry.text}`} className="space-y-1">
                        <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                          {entry.title}
                        </div>
                        <div className="break-words text-[13px] text-foreground">{entry.text}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </ScrollArea>
      </NativeSurfaceChrome>

      {showActions && actionItems.length > 1 ? (
        <NativeActionOverlay actions={actionItems} onClose={() => setShowActions(false)} />
      ) : null}
    </div>
  )
}

export const Detail = Object.assign(DetailRoot, {
  Metadata: Object.assign(DetailMetadataMarker, {
    Label: DetailMetadataLabelMarker,
    TagList: DetailMetadataTagListMarker
  })
})
