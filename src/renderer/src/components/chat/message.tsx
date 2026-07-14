"use client"

import { Button } from "../ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"
import { cjk } from "@streamdown/cjk"
import { code } from "@streamdown/code"
import { math } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"
import type { ComponentProps, HTMLAttributes, MouseEvent as ReactMouseEvent } from "react"
import { memo, useCallback } from "react"
import { Streamdown } from "streamdown"

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: "user" | "assistant"
}

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[var(--ow-message-max-w)] flex-col gap-[var(--ow-message-gap)]",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className
    )}
    {...props}
  />
)

export type MessageContentProps = HTMLAttributes<HTMLDivElement>

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
  <div
    className={cn(
      "is-user:dark flex w-fit min-w-0 max-w-full flex-col gap-[var(--ow-message-gap)] overflow-hidden [font-size:var(--ow-font-body)]",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-[var(--ow-radius-md)] group-[.is-user]:bg-secondary group-[.is-user]:px-[var(--ow-message-bubble-x)] group-[.is-user]:py-[var(--ow-message-bubble-y)] group-[.is-user]:text-foreground",
      "group-[.is-assistant]:text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
)

export type MessageActionsProps = ComponentProps<"div">

export const MessageActions = ({ className, children, ...props }: MessageActionsProps) => (
  <div className={cn("flex items-center gap-[var(--ow-gap-xs)]", className)} {...props}>
    {children}
  </div>
)

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string
  label?: string
}

export const MessageAction = ({
  tooltip,
  children,
  label,
  variant = "ghost",
  size,
  className,
  ...props
}: MessageActionProps) => {
  const button = (
    <Button
      aria-label={label || tooltip}
      className={cn(
        "size-[22px] rounded-[var(--ow-radius-sm)] text-muted-foreground hover:text-foreground [&_svg]:size-[var(--ow-icon-sm)]",
        className
      )}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {children}
    </Button>
  )

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent
            side="top"
            sideOffset={6}
            className="z-50 rounded-[var(--ow-radius-sm)] bg-foreground px-[var(--ow-space-2)] py-[var(--ow-space-1)] [font-size:var(--ow-font-meta)] leading-[var(--ow-line-tight)] text-background shadow-md"
          >
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return button
}

export type MessageResponseProps = ComponentProps<typeof Streamdown>

const streamdownPlugins = { cjk, code, math, mermaid }

type ExternalMarkdownLinkProps = ComponentProps<"a"> & {
  node?: unknown
}

function getExternalMarkdownHref(href: string | undefined): string | undefined {
  if (!href) {
    return undefined
  }

  try {
    const parsedUrl = new URL(href)
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return undefined
    }

    return parsedUrl.toString()
  } catch {
    return undefined
  }
}

function ExternalMarkdownLink(props: ExternalMarkdownLinkProps): React.JSX.Element {
  const { href, node, onClick, ...anchorProps } = props
  const externalHref = getExternalMarkdownHref(href)

  void node

  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>): void => {
      onClick?.(event)

      if (event.defaultPrevented || !externalHref) {
        return
      }

      event.preventDefault()
      void window.electron.openExternal(externalHref).catch((error) => {
        console.error("[MessageResponse] Failed to open external link.", error)
      })
    },
    [externalHref, onClick]
  )

  return (
    <a
      {...anchorProps}
      aria-label={typeof anchorProps.children === "string" ? undefined : externalHref}
      data-streamdown="link"
      href={externalHref}
      onClick={handleClick}
      rel="noreferrer"
      target={undefined}
    />
  )
}

const streamdownComponents = { a: ExternalMarkdownLink } satisfies NonNullable<
  MessageResponseProps["components"]
>

function getStreamdownComponents(
  components: MessageResponseProps["components"]
): MessageResponseProps["components"] {
  if (!components) {
    return streamdownComponents
  }

  return {
    ...components,
    a: ExternalMarkdownLink
  }
}

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn(
        "ow-markdown ow-chat-markdown size-full space-y-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className
      )}
      plugins={streamdownPlugins}
      {...props}
      components={getStreamdownComponents(props.components)}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children && nextProps.isAnimating === prevProps.isAnimating
)

MessageResponse.displayName = "MessageResponse"

export type MessageToolbarProps = ComponentProps<"div">

export const MessageToolbar = ({ className, children, ...props }: MessageToolbarProps) => (
  <div
    className={cn(
      "mt-[var(--ow-space-4)] flex w-full items-center justify-between gap-[var(--ow-gap-lg)]",
      className
    )}
    {...props}
  >
    {children}
  </div>
)
