import type { ThinkingEffort } from "@shared/app-types"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function ReasoningEffortPicker(props: {
  allowedValues: readonly ThinkingEffort[]
  onSelect: (effort: ThinkingEffort) => void
  selectedValue: ThinkingEffort | null
}): React.JSX.Element {
  const { allowedValues, onSelect, selectedValue } = props

  return (
    <div
      aria-label="Reasoning effort"
      className="flex min-w-0 flex-wrap gap-[var(--jingle-space-0-5)] px-[var(--jingle-space-2)] pb-[var(--jingle-space-1)]"
      role="radiogroup"
    >
      {allowedValues.map((effort) => (
        <Button
          key={effort}
          type="button"
          aria-checked={selectedValue === effort}
          className={cn(
            "h-6 min-w-0 rounded-[var(--jingle-radius-xs)] px-[var(--jingle-space-1-5)] [font-size:var(--jingle-font-caption)] font-normal",
            selectedValue === effort
              ? "bg-foreground text-background hover:bg-foreground/90"
              : "text-muted-foreground"
          )}
          role="radio"
          size="sm"
          variant={selectedValue === effort ? "default" : "outline"}
          onClick={() => onSelect(effort)}
        >
          {effort}
        </Button>
      ))}
    </div>
  )
}
