import { PackageOpen } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolCodeBlock, ToolDetailSection, ToolDetailStack } from "./shared-components"
import { getBasename, joinSummaryParts } from "./shared"

function getArtifactItems(args: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(args.artifacts)
    ? args.artifacts.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : []
}

defineToolComponent({
  icon: PackageOpen,
  name: "present_artifacts",
  renderSummary({ copy, args, status }) {
    const items = getArtifactItems(args)
    const statusLabel =
      status === "running"
        ? copy.common.running
        : status === "approval"
          ? copy.common.approval
          : null

    return joinSummaryParts(
      copy.toolCall.labels.present_artifacts,
      items.length > 0 ? `${items.length}` : null,
      statusLabel
    )
  },
  renderDetail({ copy, args, rawResult }) {
    const items = getArtifactItems(args)

    return (
      <ToolDetailStack>
        {items.length > 0 ? (
          <ToolDetailSection label={copy.toolCall.labels.present_artifacts}>
            <div className="grid gap-1.5">
              {items.map((item, index) => {
                const kind = typeof item.kind === "string" ? item.kind : "artifact"
                const title =
                  typeof item.title === "string" && item.title.trim().length > 0
                    ? item.title
                    : typeof item.path === "string"
                      ? getBasename(item.path)
                      : typeof item.url === "string"
                        ? item.url
                        : `Artifact ${index + 1}`

                return (
                  <div
                    key={`${kind}-${title}-${index}`}
                    className="rounded-[12px] bg-background-secondary/60 px-3 py-2 text-[12px] leading-5 text-foreground/85"
                  >
                    <div className="font-medium">{title}</div>
                    <div className="text-muted-foreground">{kind}</div>
                  </div>
                )
              })}
            </div>
          </ToolDetailSection>
        ) : null}
        {rawResult.trim() ? (
          <ToolDetailSection label={copy.common.rawResult}>
            <ToolCodeBlock>{rawResult}</ToolCodeBlock>
          </ToolDetailSection>
        ) : null}
      </ToolDetailStack>
    )
  }
})
