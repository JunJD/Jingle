import { createElement, type ReactElement, type ReactNode } from "react"
import { ExtensionHostElement } from "./host-elements"
import { useRuntimeSurfaceNavigationProps } from "./context"
import { createVisualElement, type IconLike } from "./visual"

type RuntimeFormFieldChangeHandler<TValue> = {
  bivarianceHack(value: TValue): Promise<void> | void
}["bivarianceHack"]

export interface RuntimeFormProps {
  actions?: ReactNode
  children?: ReactNode
  isLoading?: boolean
  navigationTitle?: string
}

export interface RuntimeFormFieldProps {
  description?: string
  error?: string
  id?: string
  info?: string
  title?: string
}

export interface RuntimeFormTextFieldProps extends RuntimeFormFieldProps {
  autoFocus?: boolean
  onChange: RuntimeFormFieldChangeHandler<string>
  placeholder?: string
  storeValue?: boolean
  value: string
}

export interface RuntimeFormTextAreaProps extends RuntimeFormFieldProps {
  autoFocus?: boolean
  enableMarkdown?: boolean
  onChange: RuntimeFormFieldChangeHandler<string>
  placeholder?: string
  storeValue?: boolean
  value: string
}

export interface RuntimeFormCheckboxProps extends RuntimeFormFieldProps {
  label?: string
  onChange: RuntimeFormFieldChangeHandler<boolean>
  storeValue?: boolean
  value: boolean
}

export interface RuntimeFormDatePickerProps extends RuntimeFormFieldProps {
  autoFocus?: boolean
  onChange: RuntimeFormFieldChangeHandler<unknown>
  placeholder?: string
  storeValue?: boolean
  value: Date | null | string
}

export interface RuntimeFormDropdownProps extends RuntimeFormFieldProps {
  autoFocus?: boolean
  children?: ReactNode
  isLoading?: boolean
  onChange: RuntimeFormFieldChangeHandler<string>
  onSearchTextChange?: (value: string) => Promise<void> | void
  storeValue?: boolean
  value?: string
}

export interface RuntimeFormDropdownItemProps {
  icon?: IconLike
  title: string
  value: string
}

export interface RuntimeFormTagPickerProps extends RuntimeFormFieldProps {
  autoFocus?: boolean
  children?: ReactNode
  onChange: RuntimeFormFieldChangeHandler<string[]>
  placeholder?: string
  storeValue?: boolean
  value?: string[]
}

export interface RuntimeFormTagPickerItemProps {
  icon?: IconLike
  title: string
  value: string
}

export interface RuntimeFormMessageProps {
  id?: string
  text: string
  tone?: "critical" | "info"
}

export interface RuntimeFormDescriptionProps {
  id?: string
  text: string
}

type RuntimeFormComponent = ((props: RuntimeFormProps) => ReactElement) & {
  Checkbox: (props: RuntimeFormCheckboxProps) => ReactElement
  DatePicker: ((props: RuntimeFormDatePickerProps) => ReactElement) & {
    isFullDay: (date: Date | null | string | undefined) => boolean
  }
  Dropdown: ((props: RuntimeFormDropdownProps) => ReactElement) & {
    Item: (props: RuntimeFormDropdownItemProps) => ReactElement
  }
  Description: (props: RuntimeFormDescriptionProps) => ReactElement
  Message: (props: RuntimeFormMessageProps) => ReactElement
  Separator: () => ReactElement
  TagPicker: ((props: RuntimeFormTagPickerProps) => ReactElement) & {
    Item: (props: RuntimeFormTagPickerItemProps) => ReactElement
  }
  TextArea: (props: RuntimeFormTextAreaProps) => ReactElement
  TextField: (props: RuntimeFormTextFieldProps) => ReactElement
}

function FormRoot(props: RuntimeFormProps): ReactElement {
  const { actions, children, ...hostProps } = props
  const navigationProps = useRuntimeSurfaceNavigationProps()

  return createElement(
    ExtensionHostElement.Form,
    {
      ...hostProps,
      ...navigationProps
    },
    actions,
    children
  )
}

function FormTextField(props: RuntimeFormTextFieldProps): ReactElement {
  return createElement(ExtensionHostElement.FormTextField, props)
}

function FormTextArea(props: RuntimeFormTextAreaProps): ReactElement {
  return createElement(ExtensionHostElement.FormTextArea, props)
}

function FormCheckbox(props: RuntimeFormCheckboxProps): ReactElement {
  return createElement(ExtensionHostElement.FormCheckbox, props)
}

function FormDatePickerRoot(props: RuntimeFormDatePickerProps): ReactElement {
  return createElement(ExtensionHostElement.FormDatePicker, props)
}

function isFullDayDatePickerValue(date: Date | null | string | undefined): boolean {
  if (!(date instanceof Date)) {
    return typeof date === "string" && !date.includes("T")
  }

  return (
    date.getHours() === 0 &&
    date.getMinutes() === 0 &&
    date.getSeconds() === 0 &&
    date.getMilliseconds() === 0
  )
}

function FormDropdown(props: RuntimeFormDropdownProps): ReactElement {
  const { children, ...hostProps } = props
  return createElement(ExtensionHostElement.FormDropdown, hostProps, children)
}

function FormDropdownItem(props: RuntimeFormDropdownItemProps): ReactElement {
  const { icon, ...hostProps } = props
  return createElement(
    ExtensionHostElement.FormDropdownItem,
    hostProps,
    createVisualElement("icon", icon)
  )
}

function FormTagPicker(props: RuntimeFormTagPickerProps): ReactElement {
  const { children, ...hostProps } = props
  return createElement(ExtensionHostElement.FormTagPicker, hostProps, children)
}

function FormTagPickerItem(props: RuntimeFormTagPickerItemProps): ReactElement {
  const { icon, ...hostProps } = props
  return createElement(
    ExtensionHostElement.FormTagPickerItem,
    hostProps,
    createVisualElement("icon", icon)
  )
}

function FormMessage(props: RuntimeFormMessageProps): ReactElement {
  return createElement(ExtensionHostElement.FormMessage, props)
}

function FormDescription(props: RuntimeFormDescriptionProps): ReactElement {
  return createElement(ExtensionHostElement.FormMessage, {
    ...props,
    tone: "info"
  } satisfies RuntimeFormMessageProps)
}

function FormSeparator(): ReactElement {
  return createElement(ExtensionHostElement.FormSeparator)
}

export const Form: RuntimeFormComponent = Object.assign(FormRoot, {
  Checkbox: FormCheckbox,
  DatePicker: Object.assign(FormDatePickerRoot, {
    isFullDay: isFullDayDatePickerValue
  }),
  Dropdown: Object.assign(FormDropdown, {
    Item: FormDropdownItem
  }),
  Description: FormDescription,
  Message: FormMessage,
  Separator: FormSeparator,
  TagPicker: Object.assign(FormTagPicker, {
    Item: FormTagPickerItem
  }),
  TextArea: FormTextArea,
  TextField: FormTextField
})

export namespace Form {
  export type Value = boolean | Date | null | string | string[] | undefined
  export type Values<TValue = Value> = Record<string, TValue>
  export type ItemProps<TValue = Value> = {
    error?: string
    id: string
    onChange: (value: TValue) => Promise<void> | void
    value: TValue
  }
}
