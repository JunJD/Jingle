"use client"

import { Button } from "./ui/button"
import { HoverCard, HoverCardContent, HoverCardPortal, HoverCardTrigger } from "./ui/hover-card"
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

export type AttachmentMediaCategory =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "source"
  | "unknown"

export interface AttachmentData {
  id: string
  label: string
  mediaCategory: AttachmentMediaCategory
  mediaType?: string
  url?: string
}

export type AttachmentVariant = "grid" | "inline" | "list"

const mediaCategoryIcons: Record<AttachmentMediaCategory, typeof ImageIcon> = {
  audio: Music2Icon,
  document: FileTextIcon,
  image: ImageIcon,
  source: GlobeIcon,
  unknown: PaperclipIcon,
  video: VideoIcon
}

function AttachmentImage({
  label,
  isGrid,
  url
}: {
  label: string
  isGrid: boolean
  url: string
}): React.JSX.Element {
  return isGrid ? (
    <img alt={label} className="size-full object-cover" height={96} src={url} width={96} />
  ) : (
    <img alt={label} className="size-full rounded object-cover" height={20} src={url} width={20} />
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
  return (
    <div className={cn("space-y-[var(--jingle-space-1)] px-[var(--jingle-space-0-5)]", className)}>
      <h4 className="[font-size:var(--jingle-font-body)] font-semibold leading-none text-foreground">
        {data.label}
      </h4>
      {showMediaType && data.mediaType ? (
        <p className="font-mono [font-size:var(--jingle-font-meta)] text-muted-foreground">
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
          "jingle-attachments flex items-start",
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

  const contextValue = useMemo<AttachmentContextValue>(
    () => ({ data, onRemove, variant }),
    [data, onRemove, variant]
  )

  return (
    <AttachmentContext.Provider value={contextValue}>
      <div
        className={cn(
          "group relative",
          variant === "grid" &&
            "size-[var(--jingle-chat-attachment-image-size)] overflow-hidden rounded-lg",
          variant === "inline" && [
            "flex h-[var(--jingle-control-h-md)] select-none items-center gap-[var(--jingle-space-1-5)]",
            "rounded-md border border-border px-[var(--jingle-space-1-5)]",
            "[font-size:var(--jingle-font-body)] font-medium transition-all",
            "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50"
          ],
          variant === "list" && [
            "flex w-full items-center gap-[var(--jingle-gap-md)] rounded-lg border p-[var(--jingle-space-3)]",
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

export type AttachmentPreviewProps = HTMLAttributes<HTMLSpanElement> & {
  fallbackIcon?: ReactNode
}

export const AttachmentPreview = ({
  fallbackIcon,
  className,
  ...props
}: AttachmentPreviewProps) => {
  const { data, variant } = useAttachmentContext()

  const iconSize = variant === "inline" ? "size-3" : "size-4"
  let preview: ReactNode
  if (data.mediaCategory === "image" && data.url) {
    preview = <AttachmentImage label={data.label} isGrid={variant === "grid"} url={data.url} />
  } else if (data.mediaCategory === "video" && data.url) {
    preview = (
      <video aria-label={data.label} className="size-full object-cover" muted src={data.url} />
    )
  } else if (fallbackIcon) {
    preview = fallbackIcon
  } else {
    const Icon = mediaCategoryIcons[data.mediaCategory]
    preview = <Icon className={cn(iconSize, "text-muted-foreground")} />
  }

  return (
    <span
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
    </span>
  )
}

// ============================================================================
// AttachmentInfo - Name and type display
// ============================================================================

export type AttachmentInfoProps = HTMLAttributes<HTMLSpanElement> & {
  showMediaType?: boolean
}

export const AttachmentInfo = ({
  showMediaType = false,
  className,
  ...props
}: AttachmentInfoProps) => {
  const { data, variant } = useAttachmentContext()

  if (variant === "grid") {
    return null
  }

  return (
    <span className={cn("min-w-0 flex-1", className)} {...props}>
      <span className="block truncate">{data.label}</span>
      {showMediaType && data.mediaType && (
        <span className="block truncate [font-size:var(--jingle-font-meta)] text-muted-foreground">
          {data.mediaType}
        </span>
      )}
    </span>
  )
}

// ============================================================================
// AttachmentRemove - Remove button
// ============================================================================

export type AttachmentRemoveProps = Omit<
  ComponentProps<typeof Button>,
  "aria-label" | "onClick" | "onMouseDown" | "type"
> & {
  label: string
}

export const AttachmentRemove = ({
  label,
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
      {...props}
      aria-label={label}
      className={cn(
        variant === "grid" && [
          "absolute top-2 right-2 size-6 rounded-full p-0",
          "bg-background/80 backdrop-blur-sm",
          "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100",
          "hover:bg-background",
          "[&>svg]:size-3"
        ],
        variant === "inline" && [
          "size-5 rounded p-0",
          "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100",
          "[&>svg]:size-2.5"
        ],
        variant === "list" && ["size-8 shrink-0 rounded p-0", "[&>svg]:size-4"],
        className
      )}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      type="button"
      variant="ghost"
    >
      {children ?? <XIcon />}
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
  const Icon = mediaCategoryIcons[data.mediaCategory]

  return (
    <div
      className={cn("attachment-hover-preview space-y-[var(--jingle-space-3)]", className)}
      {...props}
    >
      {data.mediaCategory === "image" && data.url ? (
        <div className="flex max-h-[var(--jingle-attachment-hover-preview-h)] w-[var(--jingle-attachment-hover-preview-w)] items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-muted/30 p-[var(--jingle-space-2)]">
          <img
            alt={data.label}
            className={cn(
              "max-h-[var(--jingle-attachment-hover-image-max-h)] max-w-full rounded-md object-contain",
              imageClassName
            )}
            height={384}
            src={data.url}
            width={320}
          />
        </div>
      ) : (
        <div className="flex items-center gap-[var(--jingle-gap-md)] rounded-lg border border-border/70 bg-muted/30 px-[var(--jingle-space-3)] py-[var(--jingle-space-3)]">
          <div className="flex h-[var(--jingle-attachment-hover-icon-size)] w-[var(--jingle-attachment-hover-icon-size)] shrink-0 items-center justify-center rounded-md bg-background">
            {fallbackIcon ?? (
              <Icon className="size-[var(--jingle-icon-action)] text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <AttachmentMetadata data={data} showMediaType={showMediaType} />
          </div>
        </div>
      )}

      {data.mediaCategory === "image" ? (
        <AttachmentMetadata data={data} showMediaType={showMediaType} />
      ) : null}
    </div>
  )
}
