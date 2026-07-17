import { createElement, useEffect, useRef, type ReactElement, type ReactNode } from "react"
import { ExtensionHostElement } from "./host-elements"
import {
  handleCommandStorageFailure,
  readCommandStorageValue,
  writeCommandStorageValue
} from "./command-storage"
import { useExtensionRuntimeHostContextOptional, useRuntimeSurfaceNavigationProps } from "./context"
import { createVisualElement, type IconLike } from "./visual"

type RuntimeFormFieldChangeHandler<TValue> = {
  bivarianceHack(value: TValue): Promise<void> | void
}["bivarianceHack"]

type RuntimeStoredFormValue = boolean | Date | null | string | string[] | undefined
export type RuntimeFormDatePickerType = "date" | "datetime"
const NO_PENDING_FORM_VALUE = Symbol("no-pending-form-value")

function getStoredFormValueKey(id: string): string {
  return `form-field:${id}`
}

function isEmptyFormValue(value: RuntimeStoredFormValue): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  )
}

function useStoredFormValue<TValue extends RuntimeStoredFormValue>(params: {
  id?: string
  onChange: RuntimeFormFieldChangeHandler<TValue>
  storeValue?: boolean
  value: TValue
}): void {
  const { id, onChange, storeValue, value } = params
  const sdk = useExtensionRuntimeHostContextOptional()
  const onChangeRef = useRef(onChange)
  const valueRef = useRef(value)
  const hasLoadedRef = useRef(false)
  const hasHydratedRef = useRef(false)
  const loadValueVersionRef = useRef(0)
  const pendingUserValueRef = useRef<TValue | typeof NO_PENDING_FORM_VALUE>(NO_PENDING_FORM_VALUE)
  const valueVersionRef = useRef(0)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    valueRef.current = value
    valueVersionRef.current += 1
  }, [value])

  useEffect(() => {
    if (!storeValue || !id || !sdk) {
      hasLoadedRef.current = false
      hasHydratedRef.current = false
      pendingUserValueRef.current = NO_PENDING_FORM_VALUE
      return
    }

    let cancelled = false
    loadValueVersionRef.current = valueVersionRef.current

    void readCommandStorageValue(sdk.requestHost, getStoredFormValueKey(id))
      .then((storedValue) => {
        if (cancelled) {
          return
        }

        hasLoadedRef.current = true
        const pendingUserValue = pendingUserValueRef.current
        if (pendingUserValue !== NO_PENDING_FORM_VALUE) {
          pendingUserValueRef.current = NO_PENDING_FORM_VALUE
          void writeCommandStorageValue(
            sdk.requestHost,
            getStoredFormValueKey(id),
            pendingUserValue
          ).catch((error: unknown) => {
            handleCommandStorageFailure(sdk.reportFatalError, error)
          })
          return
        }

        if (storedValue === undefined || !isEmptyFormValue(valueRef.current)) {
          return
        }

        hasHydratedRef.current = true
        void onChangeRef.current(storedValue as TValue)
      })
      .catch((error: unknown) => {
        if (!handleCommandStorageFailure(sdk.reportFatalError, error)) {
          return
        }
        if (!cancelled) {
          hasLoadedRef.current = true
          const pendingUserValue = pendingUserValueRef.current
          if (pendingUserValue !== NO_PENDING_FORM_VALUE) {
            pendingUserValueRef.current = NO_PENDING_FORM_VALUE
            void writeCommandStorageValue(
              sdk.requestHost,
              getStoredFormValueKey(id),
              pendingUserValue
            ).catch((writeError: unknown) => {
              handleCommandStorageFailure(sdk.reportFatalError, writeError)
            })
          }
        }
      })

    return () => {
      cancelled = true
    }
  }, [id, sdk, storeValue])

  useEffect(() => {
    if (!storeValue || !id || !sdk) {
      return
    }

    if (!hasLoadedRef.current) {
      if (valueVersionRef.current !== loadValueVersionRef.current) {
        pendingUserValueRef.current = value
      }
      return
    }

    if (hasHydratedRef.current) {
      hasHydratedRef.current = false
      return
    }

    void writeCommandStorageValue(sdk.requestHost, getStoredFormValueKey(id), value).catch(
      (error: unknown) => {
        handleCommandStorageFailure(sdk.reportFatalError, error)
      }
    )
  }, [id, sdk, storeValue, value])
}

export interface RuntimeFormProps {
  actions?: ReactNode
  children?: ReactNode
  isLoading?: boolean
  navigationTitle: string
}

export interface RuntimeFormFieldProps {
  description?: string
  error?: string
  id?: string
  info?: string
  title: string
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
  label: string
  onChange: RuntimeFormFieldChangeHandler<boolean>
  storeValue?: boolean
  value?: boolean
}

export interface RuntimeFormDatePickerProps extends RuntimeFormFieldProps {
  autoFocus?: boolean
  onChange: RuntimeFormFieldChangeHandler<unknown>
  placeholder?: string
  storeValue?: boolean
  type?: RuntimeFormDatePickerType
  value: Date | null | string
}

export interface RuntimeFormDropdownProps extends RuntimeFormFieldProps {
  autoFocus?: boolean
  children?: ReactNode
  defaultValue?: string
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
    Type: {
      Date: RuntimeFormDatePickerType
      DateTime: RuntimeFormDatePickerType
    }
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
  useStoredFormValue({
    id: props.id,
    onChange: props.onChange,
    storeValue: props.storeValue,
    value: props.value
  })

  return createElement(ExtensionHostElement.FormTextField, props)
}

function FormTextArea(props: RuntimeFormTextAreaProps): ReactElement {
  useStoredFormValue({
    id: props.id,
    onChange: props.onChange,
    storeValue: props.storeValue,
    value: props.value
  })

  return createElement(ExtensionHostElement.FormTextArea, props)
}

function FormCheckbox(props: RuntimeFormCheckboxProps): ReactElement {
  useStoredFormValue({
    id: props.id,
    onChange: props.onChange,
    storeValue: props.storeValue,
    value: props.value
  })

  return createElement(ExtensionHostElement.FormCheckbox, props)
}

function FormDatePickerRoot(props: RuntimeFormDatePickerProps): ReactElement {
  useStoredFormValue({
    id: props.id,
    onChange: props.onChange,
    storeValue: props.storeValue,
    value: props.value
  })

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
  useStoredFormValue({
    id: props.id,
    onChange: props.onChange,
    storeValue: props.storeValue,
    value: props.value
  })

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
  useStoredFormValue({
    id: props.id,
    onChange: props.onChange,
    storeValue: props.storeValue,
    value: props.value
  })

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
    Type: {
      Date: "date",
      DateTime: "datetime"
    } satisfies RuntimeFormComponent["DatePicker"]["Type"],
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
  export type DatePickerType = RuntimeFormDatePickerType
  export type Value = boolean | Date | null | string | string[] | undefined
  export type Values<TValue = Value> = Record<string, TValue>
  export type ItemProps<TValue = Value> = {
    error?: string
    id: string
    onChange: (value: TValue) => Promise<void> | void
    value: TValue
  }
}
