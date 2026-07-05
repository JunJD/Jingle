import { FileText, X } from "lucide-react"
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
      className="launcher-selection-chip flex min-w-0 items-center gap-[var(--ow-gap-sm)] rounded-full border border-emerald-500/45 bg-emerald-500/10 px-[var(--ow-space-2)] py-[var(--ow-space-1)] text-emerald-950 dark:text-emerald-100"
      title={`${sourceLabel}\n\n${context.text}`}
    >
      <FileText className="size-[var(--ow-icon-sm)] shrink-0" />
      <span className="max-w-[var(--launcher-chip-max-width)] truncate [font-size:var(--ow-font-control)] font-medium">
        {sourceLabel}: {context.text}
      </span>
      <button
        type="button"
        onClick={onClear}
        onMouseDown={(event) => event.preventDefault()}
        aria-label="Clear selected text"
        className="flex h-[var(--ow-icon-action)] w-[var(--ow-icon-action)] shrink-0 appearance-none items-center justify-center rounded-full border-0 bg-transparent p-0 text-current opacity-70 transition hover:opacity-100"
      >
        <X className="size-[var(--ow-icon-compact)]" />
      </button>
    </div>
  )
}
