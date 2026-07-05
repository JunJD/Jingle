import { cva } from "class-variance-authority"

export const badgeVariants = cva(
  "inline-flex items-center rounded-sm border px-[var(--ow-space-2)] py-[var(--ow-space-0-5)] [font-size:var(--ow-font-caption)] font-semibold uppercase tracking-wider transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-white",
        outline: "border-border text-foreground",
        nominal: "border-status-nominal/30 bg-status-nominal/15 text-status-nominal",
        warning: "border-status-warning/30 bg-status-warning/15 text-status-warning",
        critical: "border-status-critical/30 bg-status-critical/15 text-status-critical",
        info: "border-status-info/30 bg-status-info/15 text-status-info"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
)
