import { Children, isValidElement, useMemo, type ReactNode } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { collectActions } from "./actions"
import { NativeSurfaceChrome } from "./chrome"
import { useNativeSurfaceController } from "./surface-action-controller"
import { NativeExtensionSelect } from "./select"

type FormDropdownMarkerRole = "form-dropdown-item"

interface FormDropdownMarkerComponent<P = object> extends React.FC<P> {
  __formDropdownRole: FormDropdownMarkerRole
}

function createFormDropdownMarkerComponent<P = object>(
  role: FormDropdownMarkerRole
): FormDropdownMarkerComponent<P> {
  const Component = (() => null) as unknown as FormDropdownMarkerComponent<P>
  Component.__formDropdownRole = role
  return Component
}

const FormDropdownItemMarker = createFormDropdownMarkerComponent<{
  title: string
  value: string
}>("form-dropdown-item")

function FormField(props: {
  children: ReactNode
  description?: string
  title: string
}): React.JSX.Element {
  const { children, description, title } = props

  return (
    <label className="block space-y-[var(--ow-space-1-5)]">
      <div className="[font-size:var(--ow-font-meta)] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {title}
      </div>
      {description ? (
        <div className="[font-size:var(--ow-font-body)] leading-[var(--ow-line-body)] text-muted-foreground">
          {description}
        </div>
      ) : null}
      {children}
    </label>
  )
}

function FormRoot(props: {
  actions?: React.ReactElement | null
  children?: ReactNode
  navigationTitle?: string
}): React.JSX.Element {
  const { actions, children, navigationTitle } = props
  const actionItems = useMemo(
    () =>
      actions
        ? collectActions(actions, {
            nextId: (() => {
              let counter = 0
              return () => `form-action-${counter++}`
            })()
          })
        : [],
    [actions]
  )
  const surfaceController = useNativeSurfaceController({
    actions: actionItems,
    footerLabel: navigationTitle ?? "Form",
    primaryActionFallbackTitle: "Submit"
  })

  return (
    <div className="relative h-full">
      <NativeSurfaceChrome
        footer={surfaceController.footer}
        headerLeading={surfaceController.headerLeading}
        surface="native-form"
        title={navigationTitle}
      >
        <ScrollArea className="flex-1">
          <div className="space-y-[var(--ow-space-3)] px-[var(--ow-space-4)] py-[var(--ow-space-3)]">
            {children}
          </div>
        </ScrollArea>
      </NativeSurfaceChrome>

      {surfaceController.actionLayer}
    </div>
  )
}

function FormTextField(props: {
  description?: string
  onChange: (value: string) => void
  placeholder?: string
  title: string
  value: string
}): React.JSX.Element {
  const { description, onChange, placeholder, title, value } = props

  return (
    <FormField description={description} title={title}>
      <input
        className="flex h-[var(--ow-control-h-sm)] w-full rounded-[var(--ow-radius-sm)] border border-input bg-background-elevated px-[var(--ow-space-2-5)] [font-size:var(--ow-font-control)] text-foreground outline-none transition placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-ring"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </FormField>
  )
}

function FormTextArea(props: {
  description?: string
  onChange: (value: string) => void
  placeholder?: string
  title: string
  value: string
}): React.JSX.Element {
  const { description, onChange, placeholder, title, value } = props

  return (
    <FormField description={description} title={title}>
      <textarea
        className="min-h-[var(--ow-textarea-min-h)] w-full rounded-[var(--ow-radius-sm)] border border-input bg-background-elevated px-[var(--ow-space-2-5)] py-[var(--ow-space-1-5)] [font-size:var(--ow-font-control)] leading-[var(--ow-line-chat)] text-foreground outline-none transition placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-ring"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </FormField>
  )
}

function FormCheckbox(props: {
  description?: string
  label?: string
  onChange: (value: boolean) => void
  title: string
  value: boolean
}): React.JSX.Element {
  const { description, label, onChange, title, value } = props

  return (
    <FormField description={description} title={title}>
      <label className="inline-flex items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-control)] text-foreground">
        <input
          type="checkbox"
          checked={value}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{label ?? title}</span>
      </label>
    </FormField>
  )
}

function FormDropdown(props: {
  children?: ReactNode
  description?: string
  onChange: (value: string) => void
  title: string
  value: string
}): React.JSX.Element {
  const { children, description, onChange, title, value } = props
  const items = Children.toArray(children)
    .map((child) => {
      if (!isValidElement(child)) {
        return null
      }

      const marker = child.type as FormDropdownMarkerComponent
      if (marker.__formDropdownRole !== "form-dropdown-item") {
        return null
      }

      return child.props as { title: string; value: string }
    })
    .filter((item): item is { title: string; value: string } => item !== null)

  return (
    <FormField description={description} title={title}>
      <NativeExtensionSelect
        className="flex h-[var(--ow-control-h-sm)] w-full appearance-none rounded-[var(--ow-radius-sm)] border border-input bg-background-elevated pl-[var(--ow-space-2-5)] pr-[var(--ow-space-6)] [font-size:var(--ow-font-control)] text-foreground outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
        value={value}
        onChange={onChange}
      >
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.title}
          </option>
        ))}
      </NativeExtensionSelect>
    </FormField>
  )
}

function FormSeparator(): React.JSX.Element {
  return <div className="h-px w-full bg-border/80" />
}

export const Form = Object.assign(FormRoot, {
  Checkbox: FormCheckbox,
  Dropdown: Object.assign(FormDropdown, {
    Item: FormDropdownItemMarker
  }),
  Separator: FormSeparator,
  TextArea: FormTextArea,
  TextField: FormTextField
})
