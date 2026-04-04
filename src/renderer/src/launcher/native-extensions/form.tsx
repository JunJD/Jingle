import { Children, isValidElement, useMemo, useState, type ReactNode } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { collectActions } from "./actions"
import { NativeSurfaceBackButton, NativeSurfaceChrome } from "./chrome"
import { NativeExtensionSelect } from "./select"
import { NativeActionOverlay } from "./ui"

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
    <label className="block space-y-2">
      <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </div>
      {description ? (
        <div className="text-[12px] leading-5 text-muted-foreground">{description}</div>
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
  const [showActions, setShowActions] = useState(false)
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
  const primaryAction = actionItems[0] ?? null

  return (
    <div className="relative h-full">
      <NativeSurfaceChrome
        footer={
          <>
            <div className="truncate text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
              {navigationTitle ?? "Form"}
            </div>

            <div className="flex items-center gap-2">
              {actionItems.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setShowActions(true)}
                  onMouseDown={(event) => event.preventDefault()}
                  className="launcher-action-link flex items-center gap-2 rounded-[10px] px-3 py-1 text-[13px] font-medium text-foreground"
                >
                  <span>Actions</span>
                  <span className="launcher-shortcut text-[11px] text-muted-foreground">⌘K</span>
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  if (primaryAction) {
                    void Promise.resolve(primaryAction.onAction())
                  }
                }}
                onMouseDown={(event) => event.preventDefault()}
                disabled={!primaryAction}
                className="launcher-action-link flex items-center gap-2 rounded-[10px] px-3 py-1 text-[13px] font-medium text-foreground disabled:opacity-40"
              >
                <span>{primaryAction?.title ?? "Submit"}</span>
                <span className="launcher-shortcut text-[11px] text-muted-foreground">↵</span>
              </button>
            </div>
          </>
        }
        headerLeading={<NativeSurfaceBackButton />}
        surface="native-form"
        title={navigationTitle}
      >
        <ScrollArea className="flex-1">
          <div className="space-y-5 px-6 py-5">{children}</div>
        </ScrollArea>
      </NativeSurfaceChrome>

      {showActions && actionItems.length > 1 ? (
        <NativeActionOverlay actions={actionItems} onClose={() => setShowActions(false)} />
      ) : null}
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
        className="flex h-10 w-full rounded-[12px] border border-input bg-background-elevated px-3 text-sm text-foreground outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
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
        className="min-h-36 w-full rounded-[12px] border border-input bg-background-elevated px-3 py-3 text-sm text-foreground outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
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
      <label className="inline-flex items-center gap-3 text-[13px] text-foreground">
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
        className="flex h-10 w-full appearance-none rounded-[12px] border border-input bg-background-elevated pl-3 pr-10 text-sm text-foreground outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
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
