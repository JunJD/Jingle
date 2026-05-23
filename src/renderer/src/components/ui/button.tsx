import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { CheckIcon, CopyIcon } from "lucide-react"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-[var(--ow-space-1-5)] whitespace-nowrap rounded-[var(--ow-radius-md)] [font-size:var(--ow-font-control)] font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-[var(--ow-icon-action)] shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
        outline: "border border-border bg-background-elevated hover:bg-background-secondary",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-background-secondary",
        link: "text-primary underline-offset-4 hover:underline",
        // Status variants
        nominal: "bg-status-nominal text-background hover:bg-status-nominal/90",
        warning: "bg-status-warning text-background hover:bg-status-warning/90",
        critical: "bg-status-critical text-white hover:bg-status-critical/90",
        info: "bg-status-info text-white hover:bg-status-info/90"
      },
      size: {
        default: "h-[var(--ow-control-h-md)] px-[var(--ow-space-3)] py-[var(--ow-space-1-5)]",
        sm: "h-[var(--ow-control-h-compact)] px-[var(--ow-space-2-5)] [font-size:var(--ow-font-meta)]",
        lg: "h-[var(--ow-control-h-lg)] px-[var(--ow-space-4)]",
        icon: "size-[var(--ow-control-h-md)]",
        "icon-sm": "size-[var(--ow-control-h-compact)]"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  }
)
Button.displayName = "Button"

export interface CopyButtonProps extends Omit<ButtonProps, "children" | "onClick"> {
  copiedLabel?: string
  copyLabel?: string
  iconClassName?: string
  text: string
}

const CopyButton = React.forwardRef<HTMLButtonElement, CopyButtonProps>(
  (
    {
      className,
      copiedLabel = "Copied",
      copyLabel = "Copy",
      iconClassName,
      text,
      type = "button",
      variant = "ghost",
      ...props
    },
    ref
  ) => {
    const [copied, setCopied] = React.useState(false)

    React.useEffect(() => {
      if (!copied) {
        return
      }

      const timeoutId = window.setTimeout(() => {
        setCopied(false)
      }, 1500)

      return () => window.clearTimeout(timeoutId)
    }, [copied])

    const handleClick = React.useCallback(async () => {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    }, [text])

    const label = copied ? copiedLabel : copyLabel

    return (
      <Button
        {...props}
        ref={ref}
        className={className}
        onClick={() => {
          void handleClick()
        }}
        type={type}
        variant={variant}
      >
        {copied ? <CheckIcon className={iconClassName} /> : <CopyIcon className={iconClassName} />}
        <span className="sr-only">{label}</span>
      </Button>
    )
  }
)
CopyButton.displayName = "CopyButton"

// eslint-disable-next-line react-refresh/only-export-components
export { Button, CopyButton, buttonVariants }
