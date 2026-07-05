"use client"

import { Button } from "./button"
import {
  HoverCard,
  HoverCardContent,
  HoverCardPortal,
  HoverCardTrigger
} from "@radix-ui/react-hover-card"
import { cn } from "@/lib/utils"

import {
  FileTextIcon,
  GlobeIcon,
  ImageIcon,
  Music2Icon,
  PaperclipIcon,
  VideoIcon,
  XIcon
} from "lucide-react"
import type { ComponentProps, HTMLAttributes, ReactNode } from "react"
import { createContext, use, useCallback, useMemo } from "react"

// ============================================================================
// Types
// ============================================================================

export interface FileAttachmentData {
  filename?: string
  id: string
  mediaType?: string
  type: "file"
  url?: string
}

export interface SourceDocumentAttachmentData {
  filename?: string
  id: string
  mediaType?: string
  title?: string
  type: "source-document"
  url?: string
}

export type AttachmentData = FileAttachmentData | SourceDocumentAttachmentData

export type AttachmentMediaCategory =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "source"
  | "unknown"

export type AttachmentVariant = "grid" | "inline" | "list"

const mediaCategoryIcons: Record<AttachmentMediaCategory, typeof ImageIcon> = {
  audio: Music2Icon,
  document: FileTextIcon,
  image: ImageIcon,
  source: GlobeIcon,
  unknown: PaperclipIcon,
  video: VideoIcon
}

// ============================================================================
// Utility Functions
// ============================================================================

const getMediaCategory = (data: AttachmentData): AttachmentMediaCategory => {
  if (data.type === "source-document") {
    return "source"
  }

  const mediaType = data.mediaType ?? ""

  if (mediaType.startsWith("image/")) {
    return "image"
  }
  if (mediaType.startsWith("video/")) {
    return "video"
  }
  if (mediaType.startsWith("audio/")) {
    return "audio"
  }
  if (mediaType.startsWith("application/") || mediaType.startsWith("text/")) {
    return "document"
  }

  return "unknown"
}

const getAttachmentLabel = (data: AttachmentData): string => {
  if (data.type === "source-document") {
    return data.title || data.filename || "Source"
  }

  const category = getMediaCategory(data)
  return data.filename || (category === "image" ? "Image" : "Attachment")
}

function AttachmentImage({
  filename,
  isGrid,
  url
}: {
  filename?: string
  isGrid: boolean
  url: string
}): React.JSX.Element {
  return isGrid ? (
    <img
      alt={filename || "Image"}
      className="size-full object-cover"
      height={96}
      src={url}
      width={96}
    />
  ) : (
    <img
      alt={filename || "Image"}
      className="size-full rounded object-cover"
      height={20}
      src={url}
      width={20}
    />
  )
}

function AttachmentMetadata({
  className,
  data,
  showMediaType = true
}: {
  className?: string
  data: AttachmentData
  showMediaType?: boolean
}): React.JSX.Element {
  const label = getAttachmentLabel(data)

  return (
    <div className={cn("space-y-[var(--ow-space-1)] px-[var(--ow-space-0-5)]", className)}>
      <h4 className="[font-size:var(--ow-font-body)] font-semibold leading-none text-foreground">
        {label}
      </h4>
      {showMediaType && data.mediaType ? (
        <p className="font-mono [font-size:var(--ow-font-meta)] text-muted-foreground">
          {data.mediaType}
        </p>
      ) : null}
    </div>
  )
}

// ============================================================================
// Contexts
// ============================================================================

interface AttachmentsContextValue {
  variant: AttachmentVariant
}

const AttachmentsContext = createContext<AttachmentsContextValue | null>(null)

interface AttachmentContextValue {
  data: AttachmentData
  mediaCategory: AttachmentMediaCategory
  onRemove?: () => void
  variant: AttachmentVariant
}

const AttachmentContext = createContext<AttachmentContextValue | null>(null)

// ============================================================================
// Hooks
// ============================================================================

const useAttachmentsContext = () => use(AttachmentsContext) ?? { variant: "grid" as const }

const useAttachmentContext = () => {
  const ctx = use(AttachmentContext)
  if (!ctx) {
    throw new Error("Attachment components must be used within <Attachment>")
  }
  return ctx
}

// ============================================================================
// Attachments - Container
// ============================================================================

export type AttachmentsProps = HTMLAttributes<HTMLDivElement> & {
  variant?: AttachmentVariant
}

export const Attachments = ({
  variant = "grid",
  className,
  children,
  ...props
}: AttachmentsProps) => {
  const contextValue = useMemo(() => ({ variant }), [variant])

  return (
    <AttachmentsContext.Provider value={contextValue}>
      <div
        className={cn(
          "ow-attachments flex items-start",
          variant === "list" ? "flex-col gap-2" : "flex-wrap gap-2",
          variant === "grid" && "ml-auto w-fit",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </AttachmentsContext.Provider>
  )
}

// ============================================================================
// Attachment - Item
// ============================================================================

export type AttachmentProps = HTMLAttributes<HTMLDivElement> & {
  data: AttachmentData
  onRemove?: () => void
}

export const Attachment = ({ data, onRemove, className, children, ...props }: AttachmentProps) => {
  const { variant } = useAttachmentsContext()
  const mediaCategory = getMediaCategory(data)

  const contextValue = useMemo<AttachmentContextValue>(
    () => ({ data, mediaCategory, onRemove, variant }),
    [data, mediaCategory, onRemove, variant]
  )

  return (
    <AttachmentContext.Provider value={contextValue}>
      <div
        className={cn(
          "group relative",
          variant === "grid" &&
            "size-[var(--ow-chat-attachment-image-size)] overflow-hidden rounded-lg",
          variant === "inline" && [
            "flex h-[var(--ow-control-h-md)] cursor-pointer select-none items-center gap-[var(--ow-space-1-5)]",
            "rounded-md border border-border px-[var(--ow-space-1-5)]",
            "[font-size:var(--ow-font-body)] font-medium transition-all",
            "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50"
          ],
          variant === "list" && [
            "flex w-full items-center gap-[var(--ow-gap-md)] rounded-lg border p-[var(--ow-space-3)]",
            "hover:bg-accent/50"
          ],
          className
        )}
        {...props}
      >
        {children}
      </div>
    </AttachmentContext.Provider>
  )
}

// ============================================================================
// AttachmentPreview - Media preview
// ============================================================================

export type AttachmentPreviewProps = HTMLAttributes<HTMLDivElement> & {
  fallbackIcon?: ReactNode
}

export const AttachmentPreview = ({
  fallbackIcon,
  className,
  ...props
}: AttachmentPreviewProps) => {
  const { data, mediaCategory, variant } = useAttachmentContext()

  const iconSize = variant === "inline" ? "size-3" : "size-4"
  let preview: ReactNode
  if (mediaCategory === "image" && data.type === "file" && data.url) {
    preview = <AttachmentImage filename={data.filename} isGrid={variant === "grid"} url={data.url} />
  } else if (mediaCategory === "video" && data.type === "file" && data.url) {
    preview = (
      <video
        aria-label={getAttachmentLabel(data)}
        className="size-full object-cover"
        muted
        src={data.url}
      />
    )
  } else if (fallbackIcon) {
    preview = fallbackIcon
  } else {
    const Icon = mediaCategoryIcons[mediaCategory]
    preview = <Icon className={cn(iconSize, "text-muted-foreground")} />
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden",
        variant === "grid" && "size-full bg-muted",
        variant === "inline" && "size-5 rounded bg-background",
        variant === "list" && "size-12 rounded bg-muted",
        className
      )}
      {...props}
    >
      {preview}
    </div>
  )
}

// ============================================================================
// AttachmentInfo - Name and type display
// ============================================================================

export type AttachmentInfoProps = HTMLAttributes<HTMLDivElement> & {
  showMediaType?: boolean
}

export const AttachmentInfo = ({
  showMediaType = false,
  className,
  ...props
}: AttachmentInfoProps) => {
  const { data, variant } = useAttachmentContext()
  const label = getAttachmentLabel(data)

  if (variant === "grid") {
    return null
  }

  return (
    <div className={cn("min-w-0 flex-1", className)} {...props}>
      <span className="block truncate">{label}</span>
      {showMediaType && data.mediaType && (
        <span className="block truncate [font-size:var(--ow-font-meta)] text-muted-foreground">
          {data.mediaType}
        </span>
      )}
    </div>
  )
}

// ============================================================================
// AttachmentRemove - Remove button
// ============================================================================

export type AttachmentRemoveProps = ComponentProps<typeof Button> & {
  label?: string
}

export const AttachmentRemove = ({
  label = "Remove",
  className,
  children,
  ...props
}: AttachmentRemoveProps) => {
  const { onRemove, variant } = useAttachmentContext()

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onRemove?.()
    },
    [onRemove]
  )

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  if (!onRemove) {
    return null
  }

  return (
    <Button
      aria-label={label}
      className={cn(
        variant === "grid" && [
          "absolute top-2 right-2 size-6 rounded-full p-0",
          "bg-background/80 backdrop-blur-sm",
          "opacity-0 transition-opacity group-hover:opacity-100",
          "hover:bg-background",
          "[&>svg]:size-3"
        ],
        variant === "inline" && [
          "size-5 rounded p-0",
          "opacity-0 transition-opacity group-hover:opacity-100",
          "[&>svg]:size-2.5"
        ],
        variant === "list" && ["size-8 shrink-0 rounded p-0", "[&>svg]:size-4"],
        className
      )}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <XIcon />}
      <span className="sr-only">{label}</span>
    </Button>
  )
}

// ============================================================================
// AttachmentHoverCard - Hover preview
// ============================================================================

export type AttachmentHoverCardProps = ComponentProps<typeof HoverCard>

export const AttachmentHoverCard = ({
  openDelay = 0,
  closeDelay = 0,
  ...props
}: AttachmentHoverCardProps) => (
  <HoverCard closeDelay={closeDelay} openDelay={openDelay} {...props} />
)

export type AttachmentHoverCardTriggerProps = ComponentProps<typeof HoverCardTrigger>

export const AttachmentHoverCardTrigger = (props: AttachmentHoverCardTriggerProps) => (
  <HoverCardTrigger {...props} />
)

export type AttachmentHoverCardContentProps = ComponentProps<typeof HoverCardContent>

export const AttachmentHoverCardContent = ({
  align = "start",
  sideOffset = 10,
  className,
  ...props
}: AttachmentHoverCardContentProps) => (
  <HoverCardPortal>
    <HoverCardContent
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-auto rounded-xl border border-border/80 bg-popover/95 p-2 shadow-lg backdrop-blur-sm",
        className
      )}
      {...props}
    />
  </HoverCardPortal>
)

export type AttachmentHoverPreviewProps = HTMLAttributes<HTMLDivElement> & {
  data: AttachmentData
  fallbackIcon?: ReactNode
  imageClassName?: string
  showMediaType?: boolean
}

export const AttachmentHoverPreview = ({
  className,
  data,
  fallbackIcon,
  imageClassName,
  showMediaType = true,
  ...props
}: AttachmentHoverPreviewProps) => {
  const mediaCategory = getMediaCategory(data)
  const Icon = mediaCategoryIcons[mediaCategory]

  return (
    <div
      className={cn("attachment-hover-preview space-y-[var(--ow-space-3)]", className)}
      {...props}
    >
      {mediaCategory === "image" && data.type === "file" && data.url ? (
        <div className="flex max-h-[var(--ow-attachment-hover-preview-h)] w-[var(--ow-attachment-hover-preview-w)] items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-muted/30 p-[var(--ow-space-2)]">
          <img
            alt={getAttachmentLabel(data)}
            className={cn(
              "max-h-[var(--ow-attachment-hover-image-max-h)] max-w-full rounded-md object-contain",
              imageClassName
            )}
            height={384}
            src={data.url}
            width={320}
          />
        </div>
      ) : (
        <div className="flex items-center gap-[var(--ow-gap-md)] rounded-lg border border-border/70 bg-muted/30 px-[var(--ow-space-3)] py-[var(--ow-space-3)]">
          <div className="flex h-[var(--ow-attachment-hover-icon-size)] w-[var(--ow-attachment-hover-icon-size)] shrink-0 items-center justify-center rounded-md bg-background">
            {fallbackIcon ?? (
              <Icon className="size-[var(--ow-icon-action)] text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <AttachmentMetadata data={data} showMediaType={showMediaType} />
          </div>
        </div>
      )}

      {mediaCategory === "image" ? (
        <AttachmentMetadata data={data} showMediaType={showMediaType} />
      ) : null}
    </div>
  )
}

// ============================================================================
// AttachmentEmpty - Empty state
// ============================================================================

export type AttachmentEmptyProps = HTMLAttributes<HTMLDivElement>

export const AttachmentEmpty = ({ className, children, ...props }: AttachmentEmptyProps) => (
  <div
    className={cn(
      "flex items-center justify-center p-[var(--ow-space-4)] [font-size:var(--ow-font-body)] text-muted-foreground",
      className
    )}
    {...props}
  >
    {children ?? "No attachments"}
  </div>
)
