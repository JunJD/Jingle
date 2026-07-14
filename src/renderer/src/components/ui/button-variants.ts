import { cva } from "class-variance-authority"

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-[var(--jingle-space-1-5)] whitespace-nowrap rounded-[var(--jingle-radius-md)] [font-size:var(--jingle-font-control)] font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-[var(--jingle-icon-action)] shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
        outline: "border border-border bg-background-elevated hover:bg-background-secondary",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-background-secondary",
        link: "text-primary underline-offset-4 hover:underline",
        nominal: "bg-status-nominal text-background hover:bg-status-nominal/90",
        warning: "bg-status-warning text-background hover:bg-status-warning/90",
        critical: "bg-status-critical text-white hover:bg-status-critical/90",
        info: "bg-status-info text-white hover:bg-status-info/90"
      },
      size: {
        default: "h-[var(--jingle-control-h-md)] px-[var(--jingle-space-3)] py-[var(--jingle-space-1-5)]",
        sm: "h-[var(--jingle-control-h-compact)] px-[var(--jingle-space-2-5)] [font-size:var(--jingle-font-meta)]",
        lg: "h-[var(--jingle-control-h-lg)] px-[var(--jingle-space-4)]",
        icon: "size-[var(--jingle-control-h-md)]",
        "icon-sm": "size-[var(--jingle-control-h-compact)]"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
)
