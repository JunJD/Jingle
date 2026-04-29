import type { ReactNode } from "react"

export function SettingsRow(props: {
  children: ReactNode
  description: string
  icon: ReactNode
  title: string
  withBorder?: boolean
}): React.JSX.Element {
  const { children, description, icon, title, withBorder = true } = props

  return (
    <div
      className={`grid gap-[var(--ow-settings-row-gap)] px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)] md:grid-cols-[var(--ow-settings-label-column-w)_minmax(0,1fr)] ${
        withBorder ? "border-b border-border/70" : ""
      }`}
    >
      <div className="flex items-start gap-[var(--ow-settings-header-gap)]">
        <div className="mt-0.5 text-muted-foreground">{icon}</div>
        <div className="space-y-[var(--ow-space-1)]">
          <div className="[font-size:var(--ow-font-label)] font-semibold text-foreground">
            {title}
          </div>
          <div className="[font-size:var(--ow-settings-description-size)] leading-[var(--ow-line-body)] text-muted-foreground">
            {description}
          </div>
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export const settingsPageClassName =
  "mx-auto flex w-full max-w-[var(--ow-settings-content-max-width)] flex-col gap-[var(--ow-settings-page-gap)]"

export const settingsPageHeaderClassName = "px-[var(--ow-space-0-5)]"

export const settingsPageTitleClassName =
  "[font-size:var(--ow-settings-title-size)] font-semibold text-foreground"

export const settingsPageDescriptionClassName =
  "mt-[var(--ow-space-1)] max-w-[var(--ow-model-provider-copy-max-width)] [font-size:var(--ow-settings-description-size)] leading-[var(--ow-line-body)] text-muted-foreground"

export const settingsCardClassName =
  "overflow-hidden rounded-[var(--ow-settings-card-radius)] border border-border/80 bg-background-secondary/55 shadow-[var(--ow-settings-card-shadow)]"

export const inputClassName =
  "min-h-[var(--ow-settings-control-h)] w-full rounded-[var(--ow-radius-md)] border border-border bg-background-elevated px-[var(--ow-space-3)] py-[var(--ow-space-1)] [font-size:var(--ow-settings-control-font)] leading-[var(--ow-line-body)] text-foreground outline-none transition focus:border-[var(--ring)]"

export const selectClassName = `${inputClassName} pr-8`

export const secondaryButtonClassName =
  "inline-flex min-h-[var(--ow-settings-control-h)] items-center gap-[var(--ow-space-1-5)] rounded-[var(--ow-radius-md)] border border-border bg-background-elevated px-[var(--ow-space-3)] py-[var(--ow-space-1)] [font-size:var(--ow-settings-control-font)] font-medium text-foreground transition hover:bg-background-secondary disabled:cursor-default disabled:opacity-50"
