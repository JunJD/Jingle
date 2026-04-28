import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
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

// eslint-disable-next-line react-refresh/only-export-components
export { Button, buttonVariants }
