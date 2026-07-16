import {
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes
} from "react"
import { Eye, EyeOff } from "lucide-react"
import { cn } from "@/lib/utils"

export function SettingsRow(props: {
  children: ReactNode
  description: string
  icon: ReactNode
  title: string
  titleId?: string
  withBorder?: boolean
}): React.JSX.Element {
  const { children, description, icon, title, titleId, withBorder = true } = props

  return (
    <div
      className={`grid gap-[var(--jingle-settings-row-gap)] px-[var(--jingle-settings-card-x)] py-[var(--jingle-settings-card-y)] md:grid-cols-[var(--jingle-settings-label-column-w)_minmax(0,1fr)] ${
        withBorder ? "border-b border-border/70" : ""
      }`}
    >
      <div className="flex items-start gap-[var(--jingle-settings-header-gap)]">
        <div className="mt-0.5 text-muted-foreground">{icon}</div>
        <div className="space-y-[var(--jingle-space-1)]">
          <div
            id={titleId}
            className="[font-size:var(--jingle-font-label)] font-semibold text-foreground"
          >
            {title}
          </div>
          <div className="[font-size:var(--jingle-settings-description-size)] leading-[var(--jingle-line-body)] text-muted-foreground">
            {description}
          </div>
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export const settingsPageClassName =
  "mx-auto flex w-full max-w-[var(--jingle-settings-content-max-width)] flex-col gap-[var(--jingle-settings-page-gap)]"

export const settingsPageHeaderClassName = "px-[var(--jingle-space-0-5)]"

export const settingsPageTitleClassName =
  "[font-size:var(--jingle-settings-title-size)] font-semibold text-foreground"

export const settingsPageDescriptionClassName =
  "mt-[var(--jingle-space-1)] max-w-[var(--jingle-model-provider-copy-max-width)] [font-size:var(--jingle-settings-description-size)] leading-[var(--jingle-line-body)] text-muted-foreground"

export const settingsCardClassName =
  "overflow-hidden rounded-[var(--jingle-settings-card-radius)] border border-border/80 bg-background-elevated"

export const settingsInsetCardClassName =
  "rounded-[var(--jingle-settings-card-radius)] border border-border/70 bg-background px-[var(--jingle-settings-card-x)] py-[var(--jingle-settings-card-y)]"

export const settingsFieldLabelClassName =
  "[font-size:var(--jingle-font-body)] font-medium text-muted-foreground"

export const settingsFieldDescriptionClassName =
  "[font-size:var(--jingle-font-meta)] leading-[var(--jingle-line-body)] text-muted-foreground"

export const inputClassName =
  "min-h-[var(--jingle-settings-control-h)] w-full rounded-[var(--jingle-radius-md)] border border-border bg-background-elevated px-[var(--jingle-space-3)] py-[var(--jingle-space-1)] [font-size:var(--jingle-settings-control-font)] leading-[var(--jingle-line-body)] text-foreground outline-none transition focus:border-[var(--ring)]"

export const selectClassName = `${inputClassName} pr-8`

export const secondaryButtonClassName =
  "inline-flex min-h-[var(--jingle-settings-control-h)] items-center gap-[var(--jingle-space-1-5)] rounded-[var(--jingle-radius-md)] border border-border bg-background-elevated px-[var(--jingle-space-3)] py-[var(--jingle-space-1)] [font-size:var(--jingle-settings-control-font)] font-medium text-foreground transition hover:bg-background-secondary disabled:cursor-default disabled:opacity-50"

type SettingsFieldProps = {
  children: ReactNode
  description?: string
  htmlFor?: string
  label: string
  required?: boolean
}

export function SettingsField(props: SettingsFieldProps): React.JSX.Element {
  const { children, description, htmlFor, label, required = false } = props

  return (
    <div className="grid gap-[var(--jingle-space-1-5)]">
      {htmlFor ? (
        <label className="flex items-center gap-[var(--jingle-gap-sm)]" htmlFor={htmlFor}>
          <span className={settingsFieldLabelClassName}>{label}</span>
          {required ? (
            <span className="[font-size:var(--jingle-font-meta)] text-muted-foreground">*</span>
          ) : null}
        </label>
      ) : (
        <div className="flex items-center gap-[var(--jingle-gap-sm)]">
          <span className={settingsFieldLabelClassName}>{label}</span>
          {required ? (
            <span className="[font-size:var(--jingle-font-meta)] text-muted-foreground">*</span>
          ) : null}
        </div>
      )}
      {description ? (
        <span className={settingsFieldDescriptionClassName}>{description}</span>
      ) : null}
      {children}
    </div>
  )
}

type SettingsTextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
  className?: string
}

export function SettingsTextInput(props: SettingsTextInputProps): React.JSX.Element {
  const { className, ...inputProps } = props

  return <input className={cn(inputClassName, className)} {...inputProps} />
}

type SettingsSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> & {
  className?: string
}

export function SettingsSelect(props: SettingsSelectProps): React.JSX.Element {
  const { className, children, ...selectProps } = props

  return (
    <select className={cn(selectClassName, className)} {...selectProps}>
      {children}
    </select>
  )
}

type SettingsPasswordInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "type"
> & {
  className?: string
  hideLabel: string
  showLabel: string
}

export function SettingsPasswordInput(props: SettingsPasswordInputProps): React.JSX.Element {
  const { className, hideLabel, showLabel, ...inputProps } = props
  const [visible, setVisible] = useState(false)

  return (
    <div className={cn("relative", className)}>
      <input
        className={cn(inputClassName, "pr-[var(--jingle-control-icon-inset)]")}
        type={visible ? "text" : "password"}
        {...inputProps}
      />
      <button
        type="button"
        aria-label={visible ? hideLabel : showLabel}
        className="absolute inset-y-0 right-0 inline-flex w-[var(--jingle-control-icon-inset)] items-center justify-center rounded-r-[var(--jingle-radius-md)] text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? (
          <EyeOff className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />
        ) : (
          <Eye className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />
        )}
      </button>
    </div>
  )
}

type SettingsSwitchProps = {
  checked: boolean
  disabled?: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}

export function SettingsSwitch(props: SettingsSwitchProps): React.JSX.Element {
  const { checked, disabled = false, label, onCheckedChange } = props

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cn(
        "inline-flex h-[var(--jingle-settings-switch-h)] w-[var(--jingle-settings-switch-w)] items-center rounded-full border p-[var(--jingle-settings-switch-pad)] transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50",
        checked ? "border-[var(--ring)] bg-[var(--ring)]" : "border-border bg-background-elevated"
      )}
      onClick={() => onCheckedChange(!checked)}
    >
      <span
        className={cn(
          "block h-[var(--jingle-settings-switch-thumb)] w-[var(--jingle-settings-switch-thumb)] rounded-full bg-background shadow-sm transition-transform",
          checked ? "translate-x-[var(--jingle-settings-switch-travel)]" : "translate-x-0"
        )}
      />
    </button>
  )
}
