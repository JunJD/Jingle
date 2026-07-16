import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

type DialogOverlayProps = React.ComponentPropsWithRef<typeof DialogPrimitive.Overlay>

function DialogOverlay({ className, ...props }: DialogOverlayProps): React.JSX.Element {
  return (
    <DialogPrimitive.Overlay
      className={cn("jingle-dialog-overlay fixed inset-0 z-50 bg-black/80", className)}
      {...props}
    />
  )
}

type DialogContentProps = React.ComponentPropsWithRef<typeof DialogPrimitive.Content> & {
  closeLabel: string
  showCloseButton?: boolean
}

function DialogContent({
  className,
  children,
  closeLabel,
  showCloseButton = true,
  ...props
}: DialogContentProps): React.JSX.Element {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          "jingle-dialog-content fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg gap-3 border border-border bg-background p-5 shadow-lg sm:rounded-[var(--jingle-radius-dialog)]",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close className="jingle-pressable absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <X className="size-4" />
            <span className="sr-only">{closeLabel}</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

type DialogTitleProps = React.ComponentPropsWithRef<typeof DialogPrimitive.Title>

function DialogTitle({ className, ...props }: DialogTitleProps): React.JSX.Element {
  return (
    <DialogPrimitive.Title
      className={cn(
        "[font-size:var(--jingle-font-title)] font-semibold leading-none tracking-tight",
        className
      )}
      {...props}
    />
  )
}

type DialogDescriptionProps = React.ComponentPropsWithRef<typeof DialogPrimitive.Description>

function DialogDescription({ className, ...props }: DialogDescriptionProps): React.JSX.Element {
  return (
    <DialogPrimitive.Description
      className={cn("[font-size:var(--jingle-font-body)] text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription
}
