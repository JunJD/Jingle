import { FileText, Folder, Plus, X } from "lucide-react"
import type { ClipboardContext } from "@shared/clipboard"
import {
  Attachment,
  AttachmentHoverCard,
  AttachmentHoverCardContent,
  AttachmentHoverCardTrigger,
  AttachmentHoverPreview,
  AttachmentPreview,
  AttachmentRemove,
  Attachments
} from "@/components/ui/attachments"
import { useI18n } from "@/lib/i18n"

function getClipboardLabel(
  context: Exclude<ClipboardContext, { kind: "none" }>,
  copy: ReturnType<typeof useI18n>["copy"]
): string {
  if (context.kind === "image") {
    return copy.launcher.clipboardImage
  }

  if (context.kind === "text") {
    return context.text
  }

  if (context.files.length === 1) {
    return context.files[0].name
  }

  return copy.launcher.clipboardFiles(context.files.length)
}

function getClipboardIcon(
  context: Extract<ClipboardContext, { kind: "files" }>
): React.JSX.Element {
  if (context.files.length === 1 && context.files[0]?.isDirectory) {
    return <Folder className="size-[var(--ow-icon-sm)] shrink-0" />
  }

  return <FileText className="size-[var(--ow-icon-sm)] shrink-0" />
}

export function ClipboardChip(props: {
  context: ClipboardContext
  onAccept: () => void
  onClear: () => void
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const { context, onAccept, onClear } = props

  if (context.kind === "none") {
    return null
  }

  const clearButton = (
    <button
      type="button"
      onClick={onClear}
      onMouseDown={(event) => event.preventDefault()}
      aria-label={copy.launcher.clearClipboardContext}
      className="flex h-[var(--ow-icon-action)] w-[var(--ow-icon-action)] shrink-0 appearance-none items-center justify-center rounded-full border-0 bg-transparent p-0 text-muted-foreground transition hover:text-foreground"
    >
      <X className="size-[var(--ow-icon-compact)]" />
    </button>
  )

  if (context.kind === "text") {
    return (
      <div
        className="launcher-clipboard-chip launcher-clipboard-chip--candidate flex min-w-0 items-center gap-[var(--ow-gap-sm)] rounded-full border border-dashed border-border/80 bg-background/60 px-[var(--ow-space-2)] py-[var(--ow-space-1)]"
        title={context.text}
      >
        <button
          type="button"
          onClick={onAccept}
          onMouseDown={(event) => event.preventDefault()}
          aria-label={copy.launcher.addClipboardContext}
          className="flex min-w-0 flex-1 appearance-none items-center gap-[var(--ow-gap-sm)] bg-transparent p-0 text-left text-muted-foreground"
        >
          <FileText className="size-[var(--ow-icon-sm)] shrink-0" />
          <span className="max-w-[var(--launcher-chip-max-width)] truncate [font-size:var(--ow-font-control)] font-medium">
            {context.text}
          </span>
          <Plus className="size-[var(--ow-icon-compact)] shrink-0" />
        </button>
        {clearButton}
      </div>
    )
  }

  if (context.kind === "image") {
    const imageAttachment = {
      filename: copy.launcher.clipboardImage,
      id: "launcher-clipboard-image",
      mediaType: "image/png",
      type: "file" as const,
      url: context.image.previewDataUrl
    }
    const handleImageKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key !== "Enter" && event.key !== " ") {
        return
      }

      event.preventDefault()
      onAccept()
    }

    return (
      <Attachments variant="inline" className="shrink-0">
        <AttachmentHoverCard>
          <AttachmentHoverCardTrigger asChild>
            <Attachment
              data={imageAttachment}
              onClick={onAccept}
              onKeyDown={handleImageKeyDown}
              onMouseDown={(event) => event.preventDefault()}
              onRemove={onClear}
              role="button"
              tabIndex={0}
              title={copy.launcher.clipboardImage}
              className="launcher-clipboard-chip launcher-clipboard-chip--candidate h-[var(--launcher-action-control-h)] w-[var(--launcher-action-control-h)] overflow-hidden rounded-[var(--ow-radius-lg)] border border-dashed border-border/70 bg-muted/45 p-0 opacity-75 shadow-sm ring-1 ring-black/5 hover:opacity-100"
            >
              <div className="relative h-full w-full">
                <AttachmentPreview className="h-full w-full rounded-[inherit] bg-transparent grayscale" />
                <div className="absolute inset-0 flex items-center justify-center bg-background/55 opacity-0 transition-opacity group-hover:opacity-100">
                  <Plus className="size-[var(--ow-icon-sm)] text-foreground" />
                </div>
                <AttachmentRemove
                  label={copy.launcher.clearClipboardContext}
                  className="absolute right-[var(--ow-leading-nudge)] top-[var(--ow-leading-nudge)] size-[var(--ow-icon-action)] rounded-full border-0 bg-black/42 p-0 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/55 [&>svg]:size-[var(--ow-icon-xs)]"
                />
              </div>
            </Attachment>
          </AttachmentHoverCardTrigger>
          <AttachmentHoverCardContent>
            <AttachmentHoverPreview data={imageAttachment} showMediaType={false} />
          </AttachmentHoverCardContent>
        </AttachmentHoverCard>
      </Attachments>
    )
  }

  return (
    <div
      className="launcher-clipboard-chip launcher-clipboard-chip--candidate flex min-w-0 items-center gap-[var(--ow-gap-sm)] rounded-full border border-dashed border-border/80 bg-background/60 px-[var(--ow-space-2)] py-[var(--ow-space-1)]"
      title={getClipboardLabel(context, copy)}
    >
      <button
        type="button"
        onClick={onAccept}
        onMouseDown={(event) => event.preventDefault()}
        aria-label={copy.launcher.addClipboardContext}
        className="flex min-w-0 flex-1 appearance-none items-center gap-[var(--ow-gap-sm)] bg-transparent p-0 text-left"
      >
        {getClipboardIcon(context)}
        <span className="max-w-[var(--launcher-chip-max-width)] truncate [font-size:var(--ow-font-control)] font-medium">
          {getClipboardLabel(context, copy)}
        </span>
        <Plus className="size-[var(--ow-icon-compact)] shrink-0 text-muted-foreground" />
      </button>
      {clearButton}
    </div>
  )
}
