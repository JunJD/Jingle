import { useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { InlinePatchArtifactRecord } from "@shared/artifacts"
import { parsePatch } from "./patch-parser"

interface PatchArtifactPreviewProps {
  artifact: InlinePatchArtifactRecord
}

export function PatchArtifactPreview(props: PatchArtifactPreviewProps): React.JSX.Element {
  const { artifact } = props
  const parsedPatch = useMemo(() => parsePatch(artifact.payload.text), [artifact.payload.text])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="border-b border-border bg-background px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">
            {parsedPatch.files} {parsedPatch.files === 1 ? "file" : "files"}
          </Badge>
          <Badge variant="nominal">+{parsedPatch.additions}</Badge>
          <Badge variant="critical">-{parsedPatch.deletions}</Badge>
          <Badge variant="outline">
            {parsedPatch.hunks} {parsedPatch.hunks === 1 ? "hunk" : "hunks"}
          </Badge>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="overflow-x-auto px-4 py-4">
          <div className="min-w-[760px] overflow-hidden rounded-[18px] border border-border/80 bg-background-elevated/70 font-mono text-[12px] leading-6">
            {parsedPatch.rows.map((row, index) => (
              <div
                className={cn(
                  "grid grid-cols-[72px_72px_minmax(0,1fr)] border-b border-border/50",
                  row.kind === "meta" && "bg-background-secondary/60 text-muted-foreground",
                  row.kind === "hunk" && "bg-status-info/10 text-status-info",
                  row.kind === "add" && "bg-status-nominal/10 text-foreground",
                  row.kind === "remove" && "bg-status-critical/10 text-foreground",
                  row.kind === "context" && "bg-background-elevated/40 text-foreground/85",
                  index === parsedPatch.rows.length - 1 && "border-b-0"
                )}
                key={`${row.kind}-${index}-${row.text}`}
              >
                <div className="border-r border-border/50 px-3 py-1 text-right text-muted-foreground">
                  {row.oldLineNumber ?? ""}
                </div>
                <div className="border-r border-border/50 px-3 py-1 text-right text-muted-foreground">
                  {row.newLineNumber ?? ""}
                </div>
                <div className="overflow-x-auto px-3 py-1 whitespace-pre">{row.text || " "}</div>
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
