import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import type { VariantProps } from "class-variance-authority"
import { CheckIcon, CopyIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { buttonVariants } from "./button-variants"
import { Spinner } from "./spinner"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
  loadingLabel?: string
  pressEffect?: "none" | "scale"
  ref?: React.Ref<HTMLButtonElement>
}

function Button({
  className,
  children,
  disabled,
  loading = false,
  loadingLabel,
  pressEffect = "none",
  variant,
  size,
  asChild = false,
  ref,
  ...props
}: ButtonProps): React.JSX.Element {
  const Comp = asChild ? Slot : "button"
  if (asChild) {
    return (
      <Comp
        aria-busy={loading || undefined}
        className={cn(buttonVariants({ variant, size, className }))}
        data-press-effect={pressEffect}
        ref={ref}
        {...props}
      >
        {children}
      </Comp>
    )
  }

  return (
    <Comp
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      data-press-effect={pressEffect}
      disabled={disabled || loading}
      ref={ref}
      {...props}
    >
      <span className={cn("contents", loading && "opacity-0")}>{children}</span>
      {loading ? <Spinner className="absolute" label={loadingLabel} size="sm" /> : null}
    </Comp>
  )
}

export interface CopyButtonProps extends Omit<ButtonProps, "children" | "onClick"> {
  copiedLabel: string
  copyErrorLabel: string
  copyLabel: string
  iconClassName?: string
  text: string
}

function CopyButton({
  className,
  copiedLabel,
  copyErrorLabel,
  copyLabel,
  iconClassName,
  ref,
  text,
  type = "button",
  variant = "ghost",
  ...props
}: CopyButtonProps): React.JSX.Element {
  const [copyState, setCopyState] = React.useState<"copied" | "error" | "idle">("idle")

  React.useEffect(() => {
    if (copyState === "idle") {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setCopyState("idle")
    }, 1500)

    return () => window.clearTimeout(timeoutId)
  }, [copyState])

  const handleClick = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopyState("copied")
    } catch (error) {
      console.error("[CopyButton] Failed to write to the clipboard.", error)
      setCopyState("error")
    }
  }, [text])

  const label =
    copyState === "copied" ? copiedLabel : copyState === "error" ? copyErrorLabel : copyLabel

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
      {copyState === "copied" ? (
        <CheckIcon className={iconClassName} />
      ) : copyState === "error" ? (
        <XIcon className={iconClassName} />
      ) : (
        <CopyIcon className={iconClassName} />
      )}
      <span aria-live="polite" className="sr-only">
        {label}
      </span>
    </Button>
  )
}

export { Button, CopyButton }
