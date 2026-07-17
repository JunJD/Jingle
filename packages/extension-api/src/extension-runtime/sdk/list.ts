import {
  createElement,
  useCallback,
  useEffect,
  useRef,
  type ReactElement,
  type ReactNode
} from "react"
import { ExtensionHostElement } from "./host-elements"
import {
  handleCommandStorageFailure,
  readCommandStorageValue,
  writeCommandStorageValue
} from "./command-storage"
import { useExtensionRuntimeHostContextOptional, useRuntimeSurfaceNavigationProps } from "./context"
import { createVisualElement, normalizeVisual, type ColorLike, type IconLike } from "./visual"

const LIST_DROPDOWN_STORE_VALUE_KEY = "list-dropdown"

export interface RuntimeListProps {
  actions?: ReactNode
  children?: ReactNode
  filtering?: boolean | { keepSectionOrder?: boolean }
  isLoading?: boolean
  navigationTitle: string
  onSearchTextChange?: (value: string) => Promise<void> | void
  pagination?: RuntimeListPagination
  searchBarAccessory?: ReactNode
  searchBarPlaceholder?: string
  searchText?: string
  throttle?: boolean
}

export interface RuntimeListPagination {
  hasMore: boolean
  isLoading?: boolean
  onLoadMore: () => Promise<void> | void
}

export interface RuntimeListSectionProps {
  children?: ReactNode
  subtitle?: string
  title?: string
}

export interface RuntimeListItemProps {
  accessories?: IconLike | RuntimeListItemAccessory | RuntimeListItemAccessory[]
  actions?: ReactNode
  children?: ReactNode
  icon?: IconLike | RuntimeListItemIcon
  id?: string
  keywords?: string[]
  subtitle?: string
  title: string
}

export interface RuntimeListItemIcon {
  tooltip?: string
  value: IconLike
}

export interface RuntimeListItemAccessory {
  date?: Date
  icon?: IconLike
  tag?: {
    color?: ColorLike
    value: string
  }
  text?: string
  tooltip?: string
}

export interface RuntimeListEmptyViewProps {
  actions?: ReactNode
  description?: string
  title: string
}

export interface RuntimeListDropdownProps {
  children?: ReactNode
  onChange?: (value: string) => Promise<void> | void
  storeValue?: boolean
  tooltip?: string
  value: string
}

export interface RuntimeListDropdownSectionProps {
  children?: ReactNode
  title?: string
}

export interface RuntimeListDropdownItemProps {
  icon?: IconLike
  title: string
  value: string
}

type RuntimeListComponent = ((props: RuntimeListProps) => ReactElement) & {
  Dropdown: ((props: RuntimeListDropdownProps) => ReactElement) & {
    Item: (props: RuntimeListDropdownItemProps) => ReactElement
    Section: (props: RuntimeListDropdownSectionProps) => ReactElement
  }
  EmptyView: (props: RuntimeListEmptyViewProps) => ReactElement
  Item: (props: RuntimeListItemProps) => ReactElement
  Section: (props: RuntimeListSectionProps) => ReactElement
}

function ListRoot(props: RuntimeListProps): ReactElement {
  const { actions, children, searchBarAccessory, ...hostProps } = props
  const navigationProps = useRuntimeSurfaceNavigationProps()
  return createElement(
    ExtensionHostElement.List,
    {
      ...hostProps,
      ...navigationProps
    },
    actions,
    searchBarAccessory,
    children
  )
}

function ListSection(props: RuntimeListSectionProps): ReactElement {
  const { children, ...hostProps } = props
  return createElement(ExtensionHostElement.ListSection, hostProps, children)
}

function ListItem(props: RuntimeListItemProps): ReactElement {
  const { accessories, actions, children, icon, ...hostProps } = props
  return createElement(
    ExtensionHostElement.ListItem,
    hostProps,
    actions,
    createVisualElement("icon", normalizeListItemIcon(icon)),
    renderListItemAccessories(accessories),
    children
  )
}

function ListEmptyView(props: RuntimeListEmptyViewProps): ReactElement {
  const { actions, ...hostProps } = props
  return createElement(ExtensionHostElement.ListEmptyView, hostProps, actions)
}

function ListDropdown(props: RuntimeListDropdownProps): ReactElement {
  const { children, onChange, storeValue, value, ...hostProps } = props
  const sdk = useExtensionRuntimeHostContextOptional()
  const hasLoadedRef = useRef(false)
  const onChangeRef = useRef(onChange)
  const pendingUserValueRef = useRef<string | undefined>(undefined)
  const valueRef = useRef(value)

  useEffect(() => {
    onChangeRef.current = onChange
    valueRef.current = value
  }, [onChange, value])

  const persistStoredValue = useCallback(
    (nextValue: string): void => {
      if (!sdk) {
        return
      }

      void writeCommandStorageValue(
        sdk.requestHost,
        LIST_DROPDOWN_STORE_VALUE_KEY,
        nextValue
      ).catch((error: unknown) => {
        handleCommandStorageFailure(sdk.reportFatalError, error)
      })
    },
    [sdk]
  )

  useEffect(() => {
    if (!storeValue || !sdk) {
      hasLoadedRef.current = false
      pendingUserValueRef.current = undefined
      return
    }

    let cancelled = false

    void readCommandStorageValue(sdk.requestHost, LIST_DROPDOWN_STORE_VALUE_KEY)
      .then((storedValue) => {
        if (cancelled) {
          return
        }

        hasLoadedRef.current = true
        const pendingUserValue = pendingUserValueRef.current
        if (pendingUserValue !== undefined) {
          pendingUserValueRef.current = undefined
          persistStoredValue(pendingUserValue)
          return
        }

        if (typeof storedValue !== "string") {
          return
        }

        if (storedValue !== valueRef.current) {
          void onChangeRef.current?.(storedValue)
        }
      })
      .catch((error: unknown) => {
        if (!handleCommandStorageFailure(sdk.reportFatalError, error)) {
          return
        }
        if (!cancelled) {
          hasLoadedRef.current = true
          const pendingUserValue = pendingUserValueRef.current
          if (pendingUserValue !== undefined) {
            pendingUserValueRef.current = undefined
            persistStoredValue(pendingUserValue)
          }
        }
      })

    return () => {
      cancelled = true
    }
  }, [persistStoredValue, sdk, storeValue])

  const handleChange = useCallback(
    (nextValue: string) => {
      valueRef.current = nextValue
      if (storeValue && sdk) {
        if (hasLoadedRef.current) {
          persistStoredValue(nextValue)
        } else {
          pendingUserValueRef.current = nextValue
        }
      }

      return onChange?.(nextValue)
    },
    [onChange, persistStoredValue, sdk, storeValue]
  )

  return createElement(
    ExtensionHostElement.ListDropdown,
    {
      ...hostProps,
      onChange: handleChange,
      storeValue,
      value
    },
    children
  )
}

function ListDropdownSection(props: RuntimeListDropdownSectionProps): ReactElement {
  const { children, ...hostProps } = props
  return createElement(ExtensionHostElement.ListDropdownSection, hostProps, children)
}

function ListDropdownItem(props: RuntimeListDropdownItemProps): ReactElement {
  const { icon, ...hostProps } = props
  return createElement(
    ExtensionHostElement.ListDropdownItem,
    hostProps,
    createVisualElement("icon", icon)
  )
}

function normalizeListItemIcon(icon: RuntimeListItemProps["icon"]): IconLike | undefined {
  if (isListItemIcon(icon)) {
    return icon.value
  }

  return icon
}

function renderListItemAccessories(accessories: RuntimeListItemProps["accessories"]): ReactNode {
  if (isListItemAccessoryArray(accessories)) {
    return accessories.map((accessory, index) => renderListItemAccessory(accessory, index))
  }

  if (isListItemAccessory(accessories)) {
    return renderListItemAccessory(accessories, 0)
  }

  return createVisualElement("accessory", accessories)
}

function renderListItemAccessory(
  accessory: RuntimeListItemAccessory,
  index: number
): ReactElement | null {
  const text =
    accessory.text ??
    accessory.tag?.value ??
    (accessory.date instanceof Date && !Number.isNaN(accessory.date.getTime())
      ? accessory.date.toLocaleString()
      : "")

  return createVisualElement(
    "accessory",
    createElement(
      "span",
      {
        title: accessory.tooltip
      },
      normalizeVisual(accessory.icon, "image"),
      text
    ),
    `list-accessory-${index}`
  )
}

function isListItemIcon(value: unknown): value is RuntimeListItemIcon {
  return value !== null && typeof value === "object" && "value" in value
}

function isListItemAccessory(value: unknown): value is RuntimeListItemAccessory {
  return (
    value !== null &&
    typeof value === "object" &&
    ("text" in value || "tag" in value || "date" in value || "icon" in value)
  )
}

function isListItemAccessoryArray(value: unknown): value is RuntimeListItemAccessory[] {
  return Array.isArray(value) && value.every(isListItemAccessory)
}

export const List: RuntimeListComponent = Object.assign(ListRoot, {
  Dropdown: Object.assign(ListDropdown, {
    Item: ListDropdownItem,
    Section: ListDropdownSection
  }),
  EmptyView: ListEmptyView,
  Item: ListItem,
  Section: ListSection
})

export namespace List {
  export namespace Item {
    export type Accessory = RuntimeListItemAccessory
  }
}
