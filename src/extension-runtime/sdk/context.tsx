/* eslint-disable react-refresh/only-export-components */
import {
  createElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactElement,
  type ReactNode,
  type SetStateAction
} from "react"
import type {
  ExtensionHostRequest,
  ExtensionHostResponse,
  ExtensionRuntimeLaunchContext
} from "../../shared/extension-runtime-protocol"

export type ExtensionRuntimeHostRequestInput = ExtensionHostRequest extends infer TRequest
  ? TRequest extends { id: string }
    ? Omit<TRequest, "id">
    : never
  : never

export interface ExtensionRuntimeSdkContextValue extends ExtensionRuntimeLaunchContext {
  navigation: ExtensionRuntimeNavigation
  requestHost: (request: ExtensionRuntimeHostRequestInput) => Promise<ExtensionHostResponse>
}

export interface ExtensionRuntimeCommandAddress {
  commandName: string
  extensionName: string
  kind?: "extension-command"
}

export interface ExtensionRuntimeCommandOpenOptions {
  showLauncher?: boolean
}

export interface ExtensionRuntimeNavigation {
  canPop: boolean
  goHome: () => void
  hideLauncher: () => Promise<void>
  openCommand: (
    address: ExtensionRuntimeCommandAddress,
    options?: ExtensionRuntimeCommandOpenOptions
  ) => void
  pop: () => void
  push: (view: ReactNode) => void
}

const extensionRuntimeSdkContext = createContext<ExtensionRuntimeSdkContextValue | null>(null)
let activeRuntimeSdkContextValue: ExtensionRuntimeSdkContextValue | null = null

export function ExtensionRuntimeSdkProvider(props: {
  children?: ReactNode
  value: ExtensionRuntimeSdkContextValue
}): React.JSX.Element {
  activeRuntimeSdkContextValue = props.value

  useEffect(
    () => () => {
      if (activeRuntimeSdkContextValue === props.value) {
        activeRuntimeSdkContextValue = null
      }
    },
    [props.value]
  )

  return createElement(extensionRuntimeSdkContext.Provider, { value: props.value }, props.children)
}

export function getActiveExtensionRuntimeSdk(): ExtensionRuntimeSdkContextValue {
  if (!activeRuntimeSdkContextValue) {
    throw new Error("Extension runtime SDK is not initialized.")
  }

  return activeRuntimeSdkContextValue
}

export function useExtensionRuntimeSdk(): ExtensionRuntimeSdkContextValue {
  const context = useContext(extensionRuntimeSdkContext)
  if (!context) {
    throw new Error("useExtensionRuntimeSdk must be used within ExtensionRuntimeSdkProvider")
  }

  return context
}

export function useExtensionRuntimeSdkOptional(): ExtensionRuntimeSdkContextValue | null {
  return useContext(extensionRuntimeSdkContext)
}

export function useCommandSeedQuery(): string {
  return useExtensionRuntimeSdk().seedQuery
}

export function useNativeCommandPreferences<TPreferences extends object>(): TPreferences {
  return useExtensionRuntimeSdk().commandPreferences as TPreferences
}

export function useRuntimeNavigationCanPop(): boolean {
  return useExtensionRuntimeSdk().navigation.canPop
}

export function useNativeExtensionNavigation(): ExtensionRuntimeNavigation {
  return useExtensionRuntimeSdk().navigation
}

export function useRuntimeSurfaceNavigationProps(): {
  navigationCanPop: boolean
  onNavigationPop: () => void
} {
  const navigation = useExtensionRuntimeSdkOptional()?.navigation
  return {
    navigationCanPop: navigation?.canPop ?? false,
    onNavigationPop: navigation?.pop ?? (() => {})
  }
}

export function ExtensionRuntimeNavigationProvider(props: {
  children: ReactElement
  value: Omit<ExtensionRuntimeSdkContextValue, "navigation">
}): React.JSX.Element {
  const { children, value } = props
  const [stack, setStack] = useState<ReactNode[]>([])
  const activeView = stack[stack.length - 1] ?? children
  const requestHost = value.requestHost

  const pop = useCallback((): void => {
    setStack((current) => current.slice(0, -1))
  }, [])

  const navigation = useMemo<ExtensionRuntimeNavigation>(
    () => ({
      canPop: stack.length > 0,
      goHome: () => {
        void requestHost({
          capability: "navigation",
          method: "go-home"
        })
      },
      hideLauncher: async () => {
        const response = await requestHost({
          capability: "navigation",
          method: "hide-launcher"
        })
        if (!response.ok) {
          throw new Error(response.error.message)
        }
      },
      openCommand: (address, options) => {
        void requestHost({
          capability: "navigation",
          method: "open-command",
          payload: {
            commandName: address.commandName,
            extensionName: address.extensionName,
            showLauncher: options?.showLauncher
          }
        })
      },
      pop,
      push: (view) => {
        setStack((current) => [...current, view])
      }
    }),
    [pop, requestHost, stack.length]
  )

  return createElement(
    ExtensionRuntimeSdkProvider,
    {
      value: {
        ...value,
        navigation
      }
    },
    activeView
  )
}

export function useExtensionStorageState<TValue>(
  key: string,
  initialValue: TValue
): [TValue, Dispatch<SetStateAction<TValue>>] {
  const { requestHost } = useExtensionRuntimeSdk()
  const [value, setValue] = useState<TValue>(initialValue)
  const localWriteVersionRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    const loadVersion = localWriteVersionRef.current

    void requestHost({
      capability: "storage",
      method: "get",
      payload: {
        key
      }
    }).then((response) => {
      if (
        cancelled ||
        localWriteVersionRef.current !== loadVersion ||
        !response.ok ||
        response.result === undefined
      ) {
        return
      }

      setValue(response.result as TValue)
    })

    return () => {
      cancelled = true
    }
  }, [key, requestHost])

  const setStoredValue: Dispatch<SetStateAction<TValue>> = (nextValue) => {
    setValue((currentValue) => {
      localWriteVersionRef.current += 1
      const resolvedValue =
        typeof nextValue === "function"
          ? (nextValue as (currentValue: TValue) => TValue)(currentValue)
          : nextValue

      void requestHost({
        capability: "storage",
        method: "set",
        payload: {
          key,
          value: resolvedValue
        }
      })

      return resolvedValue
    })
  }

  return [value, setStoredValue]
}
