import { FileText, Folder } from "lucide-react"
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
} from "@/components/ui/attachments"
import { useI18n } from "@/lib/i18n"
import type { LauncherAiAttachmentDraft } from "./useAiAttachments"

function toAttachmentData(
  attachment: LauncherAiAttachmentDraft,
  clipboardImageLabel: string
): AttachmentData {
  if (attachment.kind === "image") {
    return {
      filename: clipboardImageLabel,
      id: attachment.id,
      mediaType: "image/png",
      type: "file",
      url: attachment.previewDataUrl
    }
  }

  return {
    filename: attachment.name,
    id: attachment.id,
    type: "file"
  }
}

function LauncherAttachmentItem(props: {
  attachment: LauncherAiAttachmentDraft
  clipboardImageLabel: string
  onRemove: (attachmentId: string) => void
  removeLabel: string
}): React.JSX.Element {
  const { attachment, clipboardImageLabel, onRemove, removeLabel } = props
  const data = toAttachmentData(attachment, clipboardImageLabel)
  const fallbackIcon =
    attachment.kind === "file" ? (
      attachment.isDirectory ? (
        <Folder className="size-[var(--ow-icon-sm)] text-muted-foreground" />
      ) : (
        <FileText className="size-[var(--ow-icon-sm)] text-muted-foreground" />
      )
    ) : undefined

  return (
    <AttachmentHoverCard>
      <AttachmentHoverCardTrigger asChild>
        <Attachment
          data={data}
          onRemove={() => onRemove(attachment.id)}
          className={
            attachment.kind === "image"
              ? "h-[var(--ow-icon-lg)] w-[var(--ow-icon-lg)] overflow-hidden rounded-[var(--ow-radius-md)] border border-white/10 bg-black/[0.035] p-0 shadow-sm ring-1 ring-black/5"
              : "max-w-[var(--launcher-attachment-max-width)] rounded-[var(--ow-radius-lg)] border border-white/10 bg-black/[0.035] px-[var(--ow-space-2-5)] py-[var(--ow-space-2)] [font-size:var(--ow-font-control)] shadow-sm ring-1 ring-black/5"
          }
        >
          {attachment.kind === "image" ? (
            <>
              <AttachmentPreview className="h-full w-full rounded-[inherit] bg-transparent" />
              <AttachmentRemove
                className="absolute right-[var(--ow-leading-nudge)] top-[var(--ow-leading-nudge)] size-[var(--ow-icon-compact)] rounded-full border-0 bg-zinc-500/95 p-0 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:bg-zinc-600 [&>svg]:size-[var(--ow-icon-close-glyph)]"
                label={removeLabel}
              />
            </>
          ) : (
            <>
              <AttachmentPreview
                fallbackIcon={fallbackIcon}
                className="size-[var(--ow-control-h-md)] rounded-lg bg-black/[0.04]"
              />
              <AttachmentInfo className="max-w-[var(--launcher-attachment-name-max-width)] [font-size:var(--ow-font-control)] font-medium text-foreground" />
              <AttachmentRemove
                className="absolute right-[var(--ow-space-1)] top-[var(--ow-space-1)] size-[var(--ow-icon-sm)] rounded-full border-0 bg-zinc-500/95 p-0 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:bg-zinc-600 [&>svg]:size-[var(--ow-icon-micro)]"
                label={removeLabel}
              />
            </>
          )}
        </Attachment>
      </AttachmentHoverCardTrigger>
      <AttachmentHoverCardContent>
        <AttachmentHoverPreview data={data} fallbackIcon={fallbackIcon} showMediaType={false} />
      </AttachmentHoverCardContent>
    </AttachmentHoverCard>
  )
}

export function LauncherAttachmentStrip(props: {
  attachments: LauncherAiAttachmentDraft[]
  onRemove: (attachmentId: string) => void
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const { attachments, onRemove } = props

  if (attachments.length === 0) {
    return null
  }

  const visibleAttachments = attachments.slice(0, 3)
  const overflowCount = attachments.length - visibleAttachments.length

  return (
    <div className="flex min-w-0 items-center gap-[var(--ow-space-1-5)] px-[var(--ow-space-1)] py-[var(--ow-space-1)]">
      <Attachments variant="inline" className="min-w-0 flex-nowrap items-center overflow-hidden">
        {visibleAttachments.map((attachment) => (
          <LauncherAttachmentItem
            key={attachment.id}
            attachment={attachment}
            clipboardImageLabel={copy.launcher.clipboardImage}
            onRemove={onRemove}
            removeLabel={copy.launcher.removeAttachment}
          />
        ))}
        {overflowCount > 0 ? (
          <div className="flex h-[var(--ow-icon-lg)] w-[var(--ow-icon-lg)] shrink-0 items-center justify-center rounded-[var(--ow-radius-md)] border border-white/10 bg-black/[0.035] [font-size:var(--ow-font-caption)] font-medium text-muted-foreground shadow-sm ring-1 ring-black/5">
            +{overflowCount}
          </div>
        ) : null}
      </Attachments>
    </div>
  )
}
