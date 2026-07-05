import * as React from "react"
import { cn } from "@/lib/utils"

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  ref?: React.Ref<HTMLDivElement>
}

function Card({ className, ref, ...props }: CardProps): React.JSX.Element {
  return (
    <div
      ref={ref}
      className={cn("rounded-sm border border-border bg-card text-card-foreground", className)}
      {...props}
    />
  )
}

function CardHeader({ className, ref, ...props }: CardProps): React.JSX.Element {
  return <div ref={ref} className={cn("flex flex-col space-y-1.5 p-4", className)} {...props} />
}

interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  ref?: React.Ref<HTMLHeadingElement>
}

function CardTitle({ children, className, ref, ...props }: CardTitleProps): React.JSX.Element {
  return (
    <h3 ref={ref} className={cn("text-section-header", className)} {...props}>
      {children}
    </h3>
  )
}

interface CardDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {
  ref?: React.Ref<HTMLParagraphElement>
}

function CardDescription({ className, ref, ...props }: CardDescriptionProps): React.JSX.Element {
  return (
    <p
      ref={ref}
      className={cn("[font-size:var(--ow-font-body)] text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardContent({ className, ref, ...props }: CardProps): React.JSX.Element {
  return <div ref={ref} className={cn("p-4 pt-0", className)} {...props} />
}

function CardFooter({ className, ref, ...props }: CardProps): React.JSX.Element {
  return <div ref={ref} className={cn("flex items-center p-4 pt-0", className)} {...props} />
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
