import { FileImage, FileText, Folder, X } from "lucide-react"
import type { ClipboardContext } from "../../../../shared/clipboard"
import { useI18n } from "@/lib/i18n"

function getClipboardLabel(
  context: Extract<ClipboardContext, { kind: "files" | "image" }>,
  copy: ReturnType<typeof useI18n>["copy"]
): string {
  if (context.kind === "image") {
    return copy.launcher.clipboardImage
  }

  if (context.files.length === 1) {
    return context.files[0]?.name ?? copy.launcher.clipboardFiles(1)
  }

  return copy.launcher.clipboardFiles(context.files.length)
}

function getClipboardIcon(
  context: Extract<ClipboardContext, { kind: "files" | "image" }>
): React.JSX.Element {
  if (context.kind === "image") {
    return <FileImage className="size-3.5 shrink-0" />
  }

  if (context.files.length === 1 && context.files[0]?.isDirectory) {
    return <Folder className="size-3.5 shrink-0" />
  }

  return <FileText className="size-3.5 shrink-0" />
}

export function ClipboardChip(props: {
  context: ClipboardContext
  onClear: () => void
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const { context, onClear } = props

  if (context.kind !== "files" && context.kind !== "image") {
    return null
  }

  return (
    <div
      className="launcher-clipboard-chip flex min-w-0 items-center gap-2 rounded-full px-3 py-1.5"
      title={getClipboardLabel(context, copy)}
    >
      {getClipboardIcon(context)}
      <span className="max-w-[220px] truncate text-[12px] font-medium">
        {getClipboardLabel(context, copy)}
      </span>
      <button
        type="button"
        onClick={onClear}
        onMouseDown={(event) => event.preventDefault()}
        aria-label={copy.launcher.clearClipboardContext}
        className="flex h-4 w-4 shrink-0 appearance-none items-center justify-center rounded-full border-0 bg-transparent p-0 transition hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}
