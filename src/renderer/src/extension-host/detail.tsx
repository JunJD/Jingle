import { cjk } from "@streamdown/cjk"
import { code } from "@streamdown/code"
import { math } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"
import { LoaderCircle } from "lucide-react"
import { Children, isValidElement, useMemo, type ReactNode } from "react"
import { Streamdown } from "streamdown"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { collectActions } from "./actions"
import { NativeSurfaceChrome } from "./chrome"
import { useNativeSurfaceController } from "./surface-action-controller"

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
  const surfaceController = useNativeSurfaceController({
    actions: actionItems,
    footerLabel: navigationTitle ?? "Detail",
    primaryActionFallbackTitle: "Open"
  })
  const metadataEntries = useMemo(() => collectMetadataEntries(metadata), [metadata])

  return (
    <div className="relative h-full">
      <NativeSurfaceChrome
        footer={surfaceController.footer}
        headerLeading={surfaceController.headerLeading}
        surface="native-detail"
        title={navigationTitle}
      >
        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="flex h-full items-center justify-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-body)] text-muted-foreground">
              <LoaderCircle className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)] animate-spin" />
              <span>Loading...</span>
            </div>
          ) : (
            <div
              className={cn(
                "grid h-full min-h-full gap-[var(--ow-gap-lg)] px-[var(--ow-space-5)] py-[var(--ow-space-4)]",
                metadataEntries.length > 0 ? "grid-cols-[minmax(0,1fr)_280px]" : "grid-cols-1"
              )}
            >
              <div className="min-w-0">
                {markdown ? (
                  <div className="native-detail-markdown [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-foreground">
                    <Streamdown parseIncompleteMarkdown={false} plugins={streamdownPlugins}>
                      {markdown}
                    </Streamdown>
                  </div>
                ) : (
                  <div className="[font-size:var(--ow-font-body)] text-muted-foreground">
                    No details available.
                  </div>
                )}
              </div>

              {metadataEntries.length > 0 ? (
                <div className="space-y-[var(--ow-space-3)] rounded-[var(--ow-radius-panel)] border border-border/80 bg-background-elevated/70 p-[var(--ow-space-3)]">
                  <div className="[font-size:var(--ow-font-meta)] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    Metadata
                  </div>
                  <div className="space-y-[var(--ow-space-3)]">
                    {metadataEntries.map((entry) => (
                      <div
                        key={`${entry.title}:${entry.text}`}
                        className="space-y-[var(--ow-space-1)]"
                      >
                        <div className="[font-size:var(--ow-font-caption)] uppercase tracking-[0.08em] text-muted-foreground">
                          {entry.title}
                        </div>
                        <div className="break-words [font-size:var(--ow-font-body)] text-foreground">
                          {entry.text}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </ScrollArea>
      </NativeSurfaceChrome>

      {surfaceController.actionLayer}
    </div>
  )
}

export const Detail = Object.assign(DetailRoot, {
  Metadata: Object.assign(DetailMetadataMarker, {
    Label: DetailMetadataLabelMarker,
    TagList: DetailMetadataTagListMarker
  })
})
