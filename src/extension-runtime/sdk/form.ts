import { createElement, type ReactElement, type ReactNode } from "react"
import { ExtensionHostElement } from "./host-elements"
import { useRuntimeSurfaceNavigationProps } from "./context"

export interface RuntimeFormProps {
  actions?: ReactNode
  children?: ReactNode
  navigationTitle?: string
}

export interface RuntimeFormFieldProps {
  description?: string
  id?: string
  title: string
}

export interface RuntimeFormTextFieldProps extends RuntimeFormFieldProps {
  onChange: (value: string) => Promise<void> | void
  placeholder?: string
  value: string
}

export interface RuntimeFormTextAreaProps extends RuntimeFormFieldProps {
  onChange: (value: string) => Promise<void> | void
  placeholder?: string
  value: string
}

export interface RuntimeFormCheckboxProps extends RuntimeFormFieldProps {
  label?: string
  onChange: (value: boolean) => Promise<void> | void
  value: boolean
}

export interface RuntimeFormDropdownProps extends RuntimeFormFieldProps {
  children?: ReactNode
  onChange: (value: string) => Promise<void> | void
  value: string
}

export interface RuntimeFormDropdownItemProps {
  title: string
  value: string
}

type RuntimeFormComponent = ((props: RuntimeFormProps) => ReactElement) & {
  Checkbox: (props: RuntimeFormCheckboxProps) => ReactElement
  Dropdown: ((props: RuntimeFormDropdownProps) => ReactElement) & {
    Item: (props: RuntimeFormDropdownItemProps) => ReactElement
  }
  Separator: () => ReactElement
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

function FormDropdown(props: RuntimeFormDropdownProps): ReactElement {
  const { children, ...hostProps } = props
  return createElement(ExtensionHostElement.FormDropdown, hostProps, children)
}

function FormDropdownItem(props: RuntimeFormDropdownItemProps): ReactElement {
  return createElement(ExtensionHostElement.FormDropdownItem, props)
}

function FormSeparator(): ReactElement {
  return createElement(ExtensionHostElement.FormSeparator)
}

export const Form: RuntimeFormComponent = Object.assign(FormRoot, {
  Checkbox: FormCheckbox,
  Dropdown: Object.assign(FormDropdown, {
    Item: FormDropdownItem
  }),
  Separator: FormSeparator,
  TextArea: FormTextArea,
  TextField: FormTextField
})
