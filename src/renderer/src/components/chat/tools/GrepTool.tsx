import { Search } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolDetailStack } from "./shared-components"
import { asGrepMatches, getPatternArg, joinSummaryParts } from "./shared"

defineToolComponent({
  name: "grep",
  icon: Search,
  renderSummary({ copy, args, result, status }) {
    const pattern = getPatternArg(args)
    const matches = asGrepMatches(result)
    const fileCount = new Set(matches.map((match) => match.path)).size

    return joinSummaryParts(
      copy.toolCall.labels.grep,
      pattern,
      status === "running"
        ? copy.common.running
        : status === "approval"
          ? copy.common.approval
          : matches.length > 0
            ? copy.toolCall.matchesInFiles(matches.length, fileCount)
            : null
    )
  },
  renderDetail({ result }) {
    const matches = asGrepMatches(result)

    if (matches.length === 0) {
      return null
    }

    const grouped = matches.reduce<Record<string, typeof matches>>((accumulator, match) => {
      accumulator[match.path] ??= []
      accumulator[match.path].push(match)
      return accumulator
    }, {})

    return (
      <ToolDetailStack>
        {Object.entries(grouped)
          .slice(0, 6)
          .map(([path, pathMatches]) => (
            <div key={path} className="grid gap-1">
              <div className="break-all font-mono text-[12px] leading-5 text-foreground/80">
                {path}
              </div>
              <div className="grid gap-1 pl-4">
                {pathMatches.slice(0, 4).map((match) => (
                  <div
                    key={`${match.path}:${match.line}:${match.text}`}
                    className="grid grid-cols-[auto,minmax(0,1fr)] gap-2 font-mono text-[12px] leading-5 text-foreground/80"
                  >
                    <span className="text-muted-foreground">{match.line ?? "-"}</span>
                    <span className="min-w-0 break-all">{match.text?.trim() || path}</span>
                  </div>
                ))}
                {pathMatches.length > 4 ? (
                  <div className="text-[11px] leading-4 text-muted-foreground">
                    {`+${pathMatches.length - 4}`}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
      </ToolDetailStack>
    )
  }
})
