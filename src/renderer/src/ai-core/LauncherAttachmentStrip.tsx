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
} from "@/components/ui/attachments"
import { useI18n } from "@/lib/i18n"
import type { LauncherAiAttachmentDraft } from "./useAiAttachments"

type LauncherAttachmentStripIntent = "accepted" | "candidate"

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
  intent: LauncherAttachmentStripIntent
  onAccept?: () => void
  onRemove: (attachmentId: string) => void
  removeLabel: string
}): React.JSX.Element {
  const { attachment, clipboardImageLabel, intent, onAccept, onRemove, removeLabel } = props
  const data = toAttachmentData(attachment, clipboardImageLabel)
  const isCandidate = intent === "candidate"
  const handleCandidateKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!isCandidate || !onAccept || (event.key !== "Enter" && event.key !== " ")) {
      return
    }

    event.preventDefault()
    onAccept()
  }
  const fallbackIcon =
    attachment.kind === "file" ? (
      attachment.isDirectory ? (
        <Folder className="size-[var(--jingle-icon-sm)] text-muted-foreground" />
      ) : (
        <FileText className="size-[var(--jingle-icon-sm)] text-muted-foreground" />
      )
    ) : undefined

  return (
    <AttachmentHoverCard>
      <AttachmentHoverCardTrigger asChild>
        <Attachment
          data={data}
          role={isCandidate ? "button" : undefined}
          onClick={isCandidate && onAccept ? () => onAccept() : undefined}
          onKeyDown={handleCandidateKeyDown}
          onRemove={() => onRemove(attachment.id)}
          tabIndex={isCandidate ? 0 : undefined}
          title={attachment.kind === "image" ? clipboardImageLabel : attachment.name}
          className={
            attachment.kind === "image"
              ? isCandidate
                ? "h-[var(--jingle-icon-lg)] w-[var(--jingle-icon-lg)] overflow-hidden rounded-[var(--jingle-radius-md)] border border-dashed border-border/70 bg-muted/45 p-0 opacity-75 shadow-sm ring-1 ring-black/5 hover:opacity-100"
                : "h-[var(--jingle-icon-lg)] w-[var(--jingle-icon-lg)] overflow-hidden rounded-[var(--jingle-radius-md)] border border-white/10 bg-black/[0.035] p-0 shadow-sm ring-1 ring-black/5"
              : isCandidate
                ? "max-w-[var(--launcher-attachment-max-width)] rounded-[var(--jingle-radius-lg)] border border-dashed border-border/80 bg-background/60 px-[var(--jingle-space-2-5)] py-[var(--jingle-space-2)] [font-size:var(--jingle-font-control)] text-muted-foreground shadow-sm ring-1 ring-black/5"
                : "max-w-[var(--launcher-attachment-max-width)] rounded-[var(--jingle-radius-lg)] border border-white/10 bg-black/[0.035] px-[var(--jingle-space-2-5)] py-[var(--jingle-space-2)] [font-size:var(--jingle-font-control)] shadow-sm ring-1 ring-black/5"
          }
        >
          {attachment.kind === "image" ? (
            <>
              <AttachmentPreview
                className={
                  isCandidate
                    ? "h-full w-full rounded-[inherit] bg-transparent grayscale"
                    : "h-full w-full rounded-[inherit] bg-transparent"
                }
              />
              {isCandidate ? (
                <div className="absolute inset-0 flex items-center justify-center bg-background/55 opacity-0 transition-opacity group-hover:opacity-100">
                  <Plus className="size-[var(--jingle-icon-sm)] text-foreground" />
                </div>
              ) : null}
              <AttachmentRemove
                className="absolute right-[var(--jingle-leading-nudge)] top-[var(--jingle-leading-nudge)] size-[var(--jingle-icon-compact)] rounded-full border-0 bg-zinc-500/95 p-0 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:bg-zinc-600 [&>svg]:size-[var(--jingle-icon-close-glyph)]"
                label={removeLabel}
              />
            </>
          ) : (
            <>
              <AttachmentPreview
                fallbackIcon={fallbackIcon}
                className="size-[var(--jingle-control-h-md)] rounded-lg bg-black/[0.04]"
              />
              <AttachmentInfo
                className={
                  isCandidate
                    ? "max-w-[var(--launcher-attachment-name-max-width)] [font-size:var(--jingle-font-control)] font-medium text-muted-foreground"
                    : "max-w-[var(--launcher-attachment-name-max-width)] [font-size:var(--jingle-font-control)] font-medium text-foreground"
                }
              />
              {isCandidate ? (
                <Plus className="size-[var(--jingle-icon-compact)] shrink-0 text-muted-foreground" />
              ) : null}
              <AttachmentRemove
                className="absolute right-[var(--jingle-space-1)] top-[var(--jingle-space-1)] size-[var(--jingle-icon-sm)] rounded-full border-0 bg-zinc-500/95 p-0 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:bg-zinc-600 [&>svg]:size-[var(--jingle-icon-micro)]"
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
  intent?: LauncherAttachmentStripIntent
  onAccept?: () => void
  onRemove: (attachmentId: string) => void
  removeLabel?: string
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const {
    attachments,
    intent = "accepted",
    onAccept,
    onRemove,
    removeLabel = copy.launcher.removeAttachment
  } = props
  const isCandidate = intent === "candidate"

  if (attachments.length === 0) {
    return null
  }

  const visibleAttachments = attachments.slice(0, 3)
  const overflowCount = attachments.length - visibleAttachments.length

  return (
    <div className="flex min-w-0 items-center gap-[var(--jingle-space-1-5)] px-[var(--jingle-space-1)] py-[var(--jingle-space-1)]">
      <Attachments variant="inline" className="min-w-0 flex-nowrap items-center overflow-hidden">
        {visibleAttachments.map((attachment) => (
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
        {overflowCount > 0 ? (
          <div
            className={
              isCandidate
                ? "flex h-[var(--jingle-icon-lg)] w-[var(--jingle-icon-lg)] shrink-0 items-center justify-center rounded-[var(--jingle-radius-md)] border border-dashed border-border/70 bg-muted/45 [font-size:var(--jingle-font-caption)] font-medium text-muted-foreground shadow-sm ring-1 ring-black/5"
                : "flex h-[var(--jingle-icon-lg)] w-[var(--jingle-icon-lg)] shrink-0 items-center justify-center rounded-[var(--jingle-radius-md)] border border-white/10 bg-black/[0.035] [font-size:var(--jingle-font-caption)] font-medium text-muted-foreground shadow-sm ring-1 ring-black/5"
            }
          >
            +{overflowCount}
          </div>
        ) : null}
      </Attachments>
    </div>
  )
}
