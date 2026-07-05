import {
  createElement,
  createContext,
  use,
  useCallback,
  useEffect,
  useInsertionEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactElement,
  type ReactNode,
  type SetStateAction
} from "react"
import {
  createExtensionRuntimeNavigation,
  getActiveRuntimeSdkContextValue,
  getRuntimeSdkGlobalState,
  setActiveRuntimeSdkContextValue,
  type ExtensionRuntimeNavigation,
  type ExtensionRuntimeSdkContextValue
} from "./runtime-context"

const extensionRuntimeSdkContext = createContext<ExtensionRuntimeSdkContextValue | null>(null)

export function ExtensionRuntimeSdkProvider(props: {
  children?: ReactNode
  value: ExtensionRuntimeSdkContextValue
}): React.JSX.Element {
  setActiveRuntimeSdkContextValue(props.value)

  useInsertionEffect(() => {
    setActiveRuntimeSdkContextValue(props.value)
    return () => {
      if (getRuntimeSdkGlobalState().activeContextValue === props.value) {
        setActiveRuntimeSdkContextValue(null)
      }
    }
  }, [props.value])

  return createElement(extensionRuntimeSdkContext.Provider, { value: props.value }, props.children)
}

export function useExtensionRuntimeSdk(): ExtensionRuntimeSdkContextValue {
  const context = use(extensionRuntimeSdkContext) ?? getActiveRuntimeSdkContextValue()
  if (!context) {
    throw new Error("useExtensionRuntimeSdk must be used within ExtensionRuntimeSdkProvider")
  }

  return context
}

export function useExtensionRuntimeSdkOptional(): ExtensionRuntimeSdkContextValue | null {
  return use(extensionRuntimeSdkContext) ?? getActiveRuntimeSdkContextValue()
}

export function useCommandSeedQuery(): string {
  return useExtensionRuntimeSdk().seedQuery
}

export function useRuntimeAppLocale(): ExtensionRuntimeSdkContextValue["locale"] {
  return useExtensionRuntimeSdk().locale
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

export function useNavigation(): ExtensionRuntimeNavigation {
  return useNativeExtensionNavigation()
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
  children?: ReactElement
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
    () =>
      createExtensionRuntimeNavigation({
        canPop: stack.length > 0,
        onPop: pop,
        onPush: (view) => {
          setStack((current) => [...current, view])
        },
        requestHost
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
  initialValue: TValue,
  options: { legacyKey?: string } = {}
): [TValue, Dispatch<SetStateAction<TValue>>] {
  const { requestHost } = useExtensionRuntimeSdk()
  const { legacyKey } = options
  const [value, setValue] = useState<TValue>(initialValue)
  const localWriteVersionRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    const loadVersion = localWriteVersionRef.current

    const loadStorageValue = async (): Promise<TValue | undefined> => {
      const response = await requestHost({
        capability: "storage",
        method: "get",
        payload: {
          key,
          scope: "command"
        }
      })

      if (!response.ok || response.result !== undefined) {
        return response.ok ? (response.result as TValue | undefined) : undefined
      }

      if (!legacyKey) {
        return undefined
      }

      const legacyResponse = await requestHost({
        capability: "storage",
        method: "get",
        payload: {
          key: legacyKey,
          scope: "command"
        }
      })

      if (!legacyResponse.ok || legacyResponse.result === undefined) {
        return undefined
      }

      await requestHost({
        capability: "storage",
        method: "set",
        payload: {
          key,
          scope: "command",
          value: legacyResponse.result
        }
      })

      return legacyResponse.result as TValue
    }

    void loadStorageValue().then((loadedValue) => {
      if (
        cancelled ||
        localWriteVersionRef.current !== loadVersion ||
        loadedValue === undefined
      ) {
        return
      }

      setValue(loadedValue)
    })

    return () => {
      cancelled = true
    }
  }, [key, legacyKey, requestHost])

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
          scope: "command",
          value: resolvedValue
        }
      })

      return resolvedValue
    })
  }

  return [value, setStoredValue]
}

export function useInterval(
  callback: () => Promise<void> | void,
  intervalMs: number | null | undefined
): void {
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    if (!intervalMs || intervalMs <= 0) {
      return
    }

    let pending = false
    const timer = setInterval(() => {
      if (pending) {
        return
      }

      pending = true
      void Promise.resolve(callbackRef.current()).finally(() => {
        pending = false
      })
    }, intervalMs)

    return () => {
      clearInterval(timer)
    }
  }, [intervalMs])
}
