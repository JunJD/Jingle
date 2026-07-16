import { FileText, X } from "lucide-react"
import { IconButton } from "@/components/ui/icon-button"
import type { LauncherSelectionContext } from "@shared/launcher-selection"

export function SelectionContextChip(props: {
  context: LauncherSelectionContext | null
  onClear: () => void
}): React.JSX.Element | null {
  const { context, onClear } = props

  if (!context) {
    return null
  }

  let sourceLabel = "Selected text"
  if (context.sourceApplicationName) {
    sourceLabel = `Selected in ${context.sourceApplicationName}`
  }

  return (
    <div
      className="launcher-selection-chip flex min-w-0 items-center gap-[var(--jingle-gap-sm)] rounded-full border border-emerald-500/45 bg-emerald-500/10 px-[var(--jingle-space-2)] py-[var(--jingle-space-1)] text-emerald-950 dark:text-emerald-100"
      title={`${sourceLabel}\n\n${context.text}`}
    >
      <FileText className="size-[var(--jingle-icon-sm)] shrink-0" />
      <span className="max-w-[var(--launcher-chip-max-width)] truncate [font-size:var(--jingle-font-control)] font-medium">
        {sourceLabel}: {context.text}
      </span>
      <IconButton
        label="Clear selected text"
        type="button"
        onClick={onClear}
        onMouseDown={(event) => event.preventDefault()}
        variant="ghost"
        className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)] rounded-full border-0 bg-transparent p-0 text-current opacity-70 hover:bg-transparent hover:opacity-100"
      >
        <X className="size-[var(--jingle-icon-compact)]" />
      </IconButton>
    </div>
  )
}
