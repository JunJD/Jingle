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
} from "@/components/attachments"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
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
    return <Folder className="size-[var(--jingle-icon-sm)] shrink-0" />
  }

  return <FileText className="size-[var(--jingle-icon-sm)] shrink-0" />
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
    <IconButton
      label={copy.launcher.clearClipboardContext}
      type="button"
      onClick={onClear}
      onMouseDown={(event) => event.preventDefault()}
      variant="ghost"
      className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)] rounded-full border-0 bg-transparent p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
    >
      <X className="size-[var(--jingle-icon-compact)]" />
    </IconButton>
  )

  if (context.kind === "text") {
    return (
      <div
        className="launcher-clipboard-chip launcher-clipboard-chip--candidate flex min-w-0 items-center gap-[var(--jingle-gap-sm)] rounded-full border border-dashed border-border/80 bg-background/60 px-[var(--jingle-space-2)] py-[var(--jingle-space-1)]"
        title={context.text}
      >
        <Button
          type="button"
          onClick={onAccept}
          onMouseDown={(event) => event.preventDefault()}
          aria-label={copy.launcher.addClipboardContext}
          variant="ghost"
          className="h-auto min-w-0 flex-1 justify-start gap-[var(--jingle-gap-sm)] rounded-none bg-transparent p-0 text-left text-muted-foreground hover:bg-transparent"
        >
          <FileText className="size-[var(--jingle-icon-sm)] shrink-0" />
          <span className="max-w-[var(--launcher-chip-max-width)] truncate [font-size:var(--jingle-font-control)] font-medium">
            {context.text}
          </span>
          <Plus className="size-[var(--jingle-icon-compact)] shrink-0" />
        </Button>
        {clearButton}
      </div>
    )
  }

  if (context.kind === "image") {
    const imageAttachment = {
      id: "launcher-clipboard-image",
      label: copy.launcher.clipboardImage,
      mediaCategory: "image" as const,
      mediaType: "image/png",
      url: context.image.previewDataUrl
    }
    return (
      <Attachments variant="inline" className="shrink-0">
        <Attachment
          className="launcher-clipboard-chip launcher-clipboard-chip--candidate h-[var(--launcher-action-control-h)] w-[var(--launcher-action-control-h)] overflow-hidden rounded-[var(--jingle-radius-lg)] border border-dashed border-border/70 bg-muted/45 p-0 opacity-75 shadow-sm ring-1 ring-black/5 hover:opacity-100"
          data={imageAttachment}
          onRemove={onClear}
        >
          <AttachmentHoverCard>
            <AttachmentHoverCardTrigger asChild>
              <Button
                aria-label={copy.launcher.addClipboardContext}
                className="relative h-full w-full rounded-[inherit] bg-transparent p-0 hover:bg-transparent"
                onClick={onAccept}
                onMouseDown={(event) => event.preventDefault()}
                type="button"
                variant="ghost"
              >
                <AttachmentPreview className="h-full w-full rounded-[inherit] bg-transparent grayscale" />
                <span className="absolute inset-0 flex items-center justify-center bg-background/55 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <Plus className="size-[var(--jingle-icon-sm)] text-foreground" />
                </span>
              </Button>
            </AttachmentHoverCardTrigger>
            <AttachmentHoverCardContent>
              <AttachmentHoverPreview data={imageAttachment} showMediaType={false} />
            </AttachmentHoverCardContent>
          </AttachmentHoverCard>
          <AttachmentRemove
            className="absolute right-[var(--jingle-leading-nudge)] top-[var(--jingle-leading-nudge)] size-[var(--jingle-icon-action)] rounded-full border-0 bg-black/42 p-0 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:bg-black/55 [&>svg]:size-[var(--jingle-icon-xs)]"
            label={copy.launcher.clearClipboardContext}
          />
        </Attachment>
      </Attachments>
    )
  }

  return (
    <div
      className="launcher-clipboard-chip launcher-clipboard-chip--candidate flex min-w-0 items-center gap-[var(--jingle-gap-sm)] rounded-full border border-dashed border-border/80 bg-background/60 px-[var(--jingle-space-2)] py-[var(--jingle-space-1)]"
      title={getClipboardLabel(context, copy)}
    >
      <Button
        type="button"
        onClick={onAccept}
        onMouseDown={(event) => event.preventDefault()}
        aria-label={copy.launcher.addClipboardContext}
        variant="ghost"
        className="h-auto min-w-0 flex-1 justify-start gap-[var(--jingle-gap-sm)] rounded-none bg-transparent p-0 text-left hover:bg-transparent"
      >
        {getClipboardIcon(context)}
        <span className="max-w-[var(--launcher-chip-max-width)] truncate [font-size:var(--jingle-font-control)] font-medium">
          {getClipboardLabel(context, copy)}
        </span>
        <Plus className="size-[var(--jingle-icon-compact)] shrink-0 text-muted-foreground" />
      </Button>
      {clearButton}
    </div>
  )
}
