import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import type { VariantProps } from "class-variance-authority"
import { CheckIcon, CopyIcon } from "lucide-react"
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
  copiedLabel?: string
  copyLabel?: string
  iconClassName?: string
  text: string
}

function CopyButton({
  className,
  copiedLabel = "Copied",
  copyLabel = "Copy",
  iconClassName,
  ref,
  text,
  type = "button",
  variant = "ghost",
  ...props
}: CopyButtonProps): React.JSX.Element {
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

export { Button, CopyButton }
