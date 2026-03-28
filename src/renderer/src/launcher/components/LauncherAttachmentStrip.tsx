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
import type { LauncherAiAttachmentDraft } from "../hooks/useLauncherAiAttachments"

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
        <Folder className="size-3.5 text-muted-foreground" />
      ) : (
        <FileText className="size-3.5 text-muted-foreground" />
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
              ? "h-6 w-6 overflow-hidden rounded-lg border border-white/10 bg-black/[0.035] p-0 shadow-sm ring-1 ring-black/5"
              : "max-w-[188px] rounded-xl border border-white/10 bg-black/[0.035] px-2.5 py-2 text-[12px] shadow-sm ring-1 ring-black/5"
          }
        >
          {attachment.kind === "image" ? (
            <>
              <AttachmentPreview className="h-full w-full rounded-[inherit] bg-transparent" />
              <AttachmentRemove
                className="absolute right-0.5 top-0.5 size-3 rounded-full border-0 bg-zinc-500/95 p-0 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:bg-zinc-600 [&>svg]:size-[9px]"
                label={removeLabel}
              />
            </>
          ) : (
            <>
              <AttachmentPreview
                fallbackIcon={fallbackIcon}
                className="size-8 rounded-lg bg-black/[0.04]"
              />
              <AttachmentInfo className="max-w-[124px] text-[12px] font-medium text-foreground" />
              <AttachmentRemove
                className="absolute right-1 top-1 size-3.5 rounded-full border-0 bg-zinc-500/95 p-0 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:bg-zinc-600 [&>svg]:size-2"
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
    <div className="flex min-w-0 items-center gap-1.5 px-1 py-1">
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
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/[0.035] text-[10px] font-medium text-muted-foreground shadow-sm ring-1 ring-black/5">
            +{overflowCount}
          </div>
        ) : null}
      </Attachments>
    </div>
  )
}
