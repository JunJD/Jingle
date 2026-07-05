"use client"

import { Button } from "../ui/button"
import { ButtonGroup, ButtonGroupText } from "../ui/button-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"
import { cjk } from "@streamdown/cjk"
import { code } from "@streamdown/code"
import { math } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import type { ComponentProps, HTMLAttributes, MouseEvent as ReactMouseEvent } from "react"
import { createContext, memo, use, useCallback, useMemo, useState } from "react"
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

interface MessageBranchContextType {
  currentBranch: number
  totalBranches: number
  goToPrevious: () => void
  goToNext: () => void
}

const MessageBranchContext = createContext<MessageBranchContextType | null>(null)

const useMessageBranch = () => {
  const context = use(MessageBranchContext)

  if (!context) {
    throw new Error("MessageBranch components must be used within MessageBranch")
  }

  return context
}

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
  branchCount: number
  currentBranch?: number
  defaultBranch?: number
  onBranchChange?: (branchIndex: number) => void
}

export const MessageBranch = ({
  branchCount,
  currentBranch: controlledBranch,
  defaultBranch = 0,
  onBranchChange,
  className,
  ...props
}: MessageBranchProps) => {
  const [uncontrolledBranch, setUncontrolledBranch] = useState(defaultBranch)
  const currentBranch = controlledBranch ?? uncontrolledBranch

  const handleBranchChange = useCallback(
    (newBranch: number) => {
      if (controlledBranch === undefined) {
        setUncontrolledBranch(newBranch)
      }
      onBranchChange?.(newBranch)
    },
    [controlledBranch, onBranchChange]
  )

  const goToPrevious = useCallback(() => {
    const newBranch = currentBranch > 0 ? currentBranch - 1 : branchCount - 1
    handleBranchChange(newBranch)
  }, [branchCount, currentBranch, handleBranchChange])

  const goToNext = useCallback(() => {
    const newBranch = currentBranch < branchCount - 1 ? currentBranch + 1 : 0
    handleBranchChange(newBranch)
  }, [branchCount, currentBranch, handleBranchChange])

  const contextValue = useMemo<MessageBranchContextType>(
    () => ({
      currentBranch,
      goToNext,
      goToPrevious,
      totalBranches: branchCount
    }),
    [branchCount, currentBranch, goToNext, goToPrevious]
  )

  return (
    <MessageBranchContext.Provider value={contextValue}>
      <div
        className={cn("grid w-full gap-[var(--ow-gap-sm)] [&>div]:pb-0", className)}
        {...props}
      />
    </MessageBranchContext.Provider>
  )
}

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>

export const MessageBranchContent = ({ children, ...props }: MessageBranchContentProps) => {
  const { currentBranch } = useMessageBranch()
  const childrenArray = useMemo(() => (Array.isArray(children) ? children : [children]), [children])
  const branch = childrenArray[currentBranch] ?? null

  if (!branch) {
    return null
  }

  return (
    <div className="grid gap-[var(--ow-gap-sm)] overflow-hidden [&>div]:pb-0" {...props}>
      {branch}
    </div>
  )
}

export type MessageBranchSelectorProps = ComponentProps<typeof ButtonGroup>

export const MessageBranchSelector = ({ className, ...props }: MessageBranchSelectorProps) => {
  const { totalBranches } = useMessageBranch()

  // Don't render if there's only one branch
  if (totalBranches <= 1) {
    return null
  }

  return (
    <ButtonGroup
      className={cn(
        "[&>*:not(:first-child)]:rounded-l-md [&>*:not(:last-child)]:rounded-r-md",
        className
      )}
      orientation="horizontal"
      {...props}
    />
  )
}

export type MessageBranchPreviousProps = ComponentProps<typeof Button>

export const MessageBranchPrevious = ({ children, ...props }: MessageBranchPreviousProps) => {
  const { goToPrevious, totalBranches } = useMessageBranch()

  return (
    <Button
      aria-label="Previous branch"
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronLeftIcon size={14} />}
    </Button>
  )
}

export type MessageBranchNextProps = ComponentProps<typeof Button>

export const MessageBranchNext = ({ children, ...props }: MessageBranchNextProps) => {
  const { goToNext, totalBranches } = useMessageBranch()

  return (
    <Button
      aria-label="Next branch"
      disabled={totalBranches <= 1}
      onClick={goToNext}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronRightIcon size={14} />}
    </Button>
  )
}

export type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>

export const MessageBranchPage = ({ className, ...props }: MessageBranchPageProps) => {
  const { currentBranch, totalBranches } = useMessageBranch()

  return (
    <ButtonGroupText
      className={cn("border-none bg-transparent text-muted-foreground shadow-none", className)}
      {...props}
    >
      {currentBranch + 1} / {totalBranches}
    </ButtonGroupText>
  )
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
