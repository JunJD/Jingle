import { ChevronRight } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

export interface InlineActivityReferenceItem {
  detail?: string
  key: string
  meta?: string
  title: string
}

export function InlineActivityReferences(props: {
  defaultOpen?: boolean
  items: InlineActivityReferenceItem[]
  title: string
}): React.JSX.Element | null {
  const { defaultOpen = false, items, title } = props

  if (items.length === 0) {
    return null
  }

  return (
    <Collapsible
      className="jingle-inline-activity-references border-t border-border/60 pt-[var(--jingle-space-3)] text-[var(--jingle-agent-timeline-muted)]"
      defaultOpen={defaultOpen}
    >
      <CollapsibleTrigger className="group flex min-w-0 items-center gap-[var(--jingle-gap-sm)] text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight className="jingle-agent-tool-chevron size-[var(--jingle-icon-sm)] shrink-0 group-data-[state=open]:rotate-90" />
        <span className="min-w-0 truncate [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-chat)]">
          {title}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden">
        <div className="mt-[var(--jingle-space-2)] grid gap-[var(--jingle-space-2)] pl-[calc(var(--jingle-icon-sm)+var(--jingle-gap-sm))]">
          {items.map((item) => (
            <div key={item.key} className="min-w-0">
              <div
                className={cn(
                  "min-w-0 [overflow-wrap:anywhere] [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-chat)] text-foreground",
                  item.meta && "font-mono"
                )}
              >
                {item.title}
              </div>
              {item.meta ? (
                <div className="min-w-0 [overflow-wrap:anywhere] [font-size:var(--jingle-font-meta)] leading-[var(--jingle-line-body)] text-[var(--jingle-reasoning-content-fg)]">
                  {item.meta}
                </div>
              ) : null}
              {item.detail ? (
                <div className="min-w-0 [overflow-wrap:anywhere] [font-size:var(--jingle-font-meta)] leading-[var(--jingle-line-body)] text-[var(--jingle-reasoning-content-fg)]">
                  {item.detail}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
