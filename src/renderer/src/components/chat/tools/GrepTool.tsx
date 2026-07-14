import { Search } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolDetailStack } from "./shared-components"
import { asGrepMatches, getPatternArg } from "./shared"

defineToolComponent({
  name: "grep",
  icon: Search,
  hasDetail({ result }) {
    return asGrepMatches(result).length > 0
  },
  renderDisplay({ copy, args, result }) {
    const pattern = getPatternArg(args)
    const matches = asGrepMatches(result)
    const fileCount = new Set(matches.map((match) => match.path)).size

    return {
      detail: pattern,
      resultMeta:
        matches.length > 0 ? copy.toolCall.matchesInFiles(matches.length, fileCount) : null,
      title: copy.toolCall.labels.grep
    }
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
            <div key={path} className="grid gap-[var(--jingle-gap-xs)]">
              <div className="break-all font-mono [font-size:var(--jingle-font-code)] leading-[var(--jingle-line-code)] text-foreground/80">
                {path}
              </div>
              <div className="grid gap-[var(--jingle-gap-xs)] pl-[var(--jingle-space-4)]">
                {pathMatches.slice(0, 4).map((match) => (
                  <div
                    key={`${match.path}:${match.line}:${match.text}`}
                    className="grid grid-cols-[auto,minmax(0,1fr)] gap-[var(--jingle-gap-sm)] font-mono [font-size:var(--jingle-font-code)] leading-[var(--jingle-line-code)] text-foreground/80"
                  >
                    <span className="text-muted-foreground">{match.line ?? "-"}</span>
                    <span className="min-w-0 break-all">{match.text?.trim() || path}</span>
                  </div>
                ))}
                {pathMatches.length > 4 ? (
                  <div className="[font-size:var(--jingle-font-meta)] leading-[var(--jingle-line-body)] text-muted-foreground">
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
