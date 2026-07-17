import { FileText, Folder, Plus } from "lucide-react"
import {
  Attachment,
  AttachmentHoverCard,
  AttachmentHoverCardContent,
  AttachmentHoverCardTrigger,
  AttachmentHoverPreview,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  type AttachmentData
} from "@/components/attachments"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { LauncherAiAttachmentDraft } from "./useAiAttachments"

type LauncherAttachmentStripIntent = "accepted" | "candidate"

function toAttachmentData(
  attachment: LauncherAiAttachmentDraft,
  clipboardImageLabel: string
): AttachmentData {
  if (attachment.kind === "image") {
    return {
      id: attachment.id,
      label: attachment.name ?? clipboardImageLabel,
      mediaCategory: "image",
      mediaType: "image/png",
      url: attachment.previewDataUrl
    }
  }

  return {
    id: attachment.id,
    label: attachment.name,
    mediaCategory: "document"
  }
}

function LauncherAttachmentItem(props: {
  attachment: LauncherAiAttachmentDraft
  clipboardImageLabel: string
  intent: LauncherAttachmentStripIntent
  onAccept?: () => void
  onRemove: (attachmentId: string) => void
  removeLabel: string
}): React.JSX.Element {
  const { attachment, clipboardImageLabel, intent, onAccept, onRemove, removeLabel } = props
  const data = toAttachmentData(attachment, clipboardImageLabel)
  const isCandidate = intent === "candidate"
  const fallbackIcon =
    attachment.kind === "file" ? (
      attachment.isDirectory ? (
        <Folder className="size-[var(--jingle-icon-sm)] text-muted-foreground" />
      ) : (
        <FileText className="size-[var(--jingle-icon-sm)] text-muted-foreground" />
      )
    ) : undefined

  const attachmentClassName =
    attachment.kind === "image"
      ? isCandidate
        ? "h-[var(--jingle-icon-lg)] w-[var(--jingle-icon-lg)] overflow-hidden rounded-[var(--jingle-radius-md)] border border-dashed border-border/70 bg-muted/45 p-0 opacity-75 shadow-sm ring-1 ring-black/5 hover:opacity-100"
        : "h-[var(--jingle-icon-lg)] w-[var(--jingle-icon-lg)] overflow-hidden rounded-[var(--jingle-radius-md)] border border-white/10 bg-black/[0.035] p-0 shadow-sm ring-1 ring-black/5"
      : isCandidate
        ? "max-w-[var(--launcher-attachment-max-width)] rounded-[var(--jingle-radius-lg)] border border-dashed border-border/80 bg-background/60 px-[var(--jingle-space-2-5)] py-[var(--jingle-space-2)] [font-size:var(--jingle-font-control)] text-muted-foreground shadow-sm ring-1 ring-black/5"
        : "max-w-[var(--launcher-attachment-max-width)] rounded-[var(--jingle-radius-lg)] border border-white/10 bg-black/[0.035] px-[var(--jingle-space-2-5)] py-[var(--jingle-space-2)] [font-size:var(--jingle-font-control)] shadow-sm ring-1 ring-black/5"
  const itemContent = (
    <>
      <AttachmentPreview
        fallbackIcon={fallbackIcon}
        className={cn(
          attachment.kind === "image"
            ? "h-full w-full rounded-[inherit] bg-transparent"
            : "size-[var(--jingle-control-h-md)] rounded-lg bg-black/[0.04]",
          isCandidate && attachment.kind === "image" && "grayscale"
        )}
      />
      {attachment.kind === "image" ? (
        isCandidate ? (
          <span className="absolute inset-0 flex items-center justify-center bg-background/55 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <Plus className="size-[var(--jingle-icon-sm)] text-foreground" />
          </span>
        ) : null
      ) : (
        <>
          <AttachmentInfo
            className={cn(
              "max-w-[var(--launcher-attachment-name-max-width)] [font-size:var(--jingle-font-control)] font-medium",
              isCandidate ? "text-muted-foreground" : "text-foreground"
            )}
          />
          {isCandidate ? (
            <Plus className="size-[var(--jingle-icon-compact)] shrink-0 text-muted-foreground" />
          ) : null}
        </>
      )}
    </>
  )
  const removeControl = (
    <AttachmentRemove
      className={
        attachment.kind === "image"
          ? "absolute right-[var(--jingle-leading-nudge)] top-[var(--jingle-leading-nudge)] size-[var(--jingle-icon-compact)] rounded-full border-0 bg-zinc-500/95 p-0 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:bg-zinc-600 [&>svg]:size-[var(--jingle-icon-close-glyph)]"
          : "absolute right-[var(--jingle-space-1)] top-[var(--jingle-space-1)] size-[var(--jingle-icon-sm)] rounded-full border-0 bg-zinc-500/95 p-0 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:bg-zinc-600 [&>svg]:size-[var(--jingle-icon-micro)]"
      }
      label={`${removeLabel}: ${data.label}`}
    />
  )

  return (
    <AttachmentHoverCard>
      {isCandidate && onAccept ? (
        <Attachment
          className={attachmentClassName}
          data={data}
          onRemove={() => onRemove(attachment.id)}
          title={data.label}
        >
          <AttachmentHoverCardTrigger asChild>
            <Button
              aria-label={data.label}
              className={cn(
                "relative min-w-0 bg-transparent p-0 text-inherit hover:bg-transparent",
                attachment.kind === "image"
                  ? "h-full w-full rounded-[inherit]"
                  : "h-full flex-1 justify-start gap-[var(--jingle-space-1-5)] rounded-none"
              )}
              onClick={onAccept}
              type="button"
              variant="ghost"
            >
              {itemContent}
            </Button>
          </AttachmentHoverCardTrigger>
          {removeControl}
        </Attachment>
      ) : (
        <AttachmentHoverCardTrigger asChild>
          <Attachment
            className={attachmentClassName}
            data={data}
            onRemove={() => onRemove(attachment.id)}
            title={data.label}
          >
            {itemContent}
            {removeControl}
          </Attachment>
        </AttachmentHoverCardTrigger>
      )}
      <AttachmentHoverCardContent>
        <AttachmentHoverPreview data={data} fallbackIcon={fallbackIcon} showMediaType={false} />
      </AttachmentHoverCardContent>
    </AttachmentHoverCard>
  )
}

type LauncherAttachmentStripProps = {
  attachments: LauncherAiAttachmentDraft[]
  onRemove: (attachmentId: string) => void
  removeLabel?: string
} & (
  | {
      intent: "candidate"
      onAccept: () => void
    }
  | {
      intent?: "accepted"
      onAccept?: never
    }
)

export function LauncherAttachmentStrip(
  props: LauncherAttachmentStripProps
): React.JSX.Element | null {
  const { copy } = useI18n()
  const {
    attachments,
    intent = "accepted",
    onAccept,
    onRemove,
    removeLabel = copy.launcher.removeAttachment
  } = props
  if (attachments.length === 0) {
    return null
  }

  return (
    <div className="flex w-max shrink-0 items-center gap-[var(--jingle-space-1-5)] px-[var(--jingle-space-1)] py-[var(--jingle-space-1)]">
      <Attachments variant="inline" className="flex-nowrap items-center">
        {attachments.map((attachment) => (
          <LauncherAttachmentItem
            key={attachment.id}
            attachment={attachment}
            clipboardImageLabel={copy.launcher.clipboardImage}
            intent={intent}
            onAccept={onAccept}
            onRemove={onRemove}
            removeLabel={removeLabel}
          />
        ))}
      </Attachments>
    </div>
  )
}
