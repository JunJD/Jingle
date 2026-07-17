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
  type ExtensionRuntimeHostContextValue,
  type ExtensionRuntimeSdkContextValue
} from "./runtime-context"
import {
  handleCommandStorageFailure,
  readCommandStorageValue,
  writeCommandStorageValueAndDiscardLegacy
} from "./command-storage"

const extensionRuntimeSdkContext = createContext<ExtensionRuntimeHostContextValue | null>(null)

export function ExtensionRuntimeSdkProvider(props: {
  children?: ReactNode
  value: ExtensionRuntimeHostContextValue
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

export function useExtensionRuntimeHostContext(): ExtensionRuntimeHostContextValue {
  const context = use(extensionRuntimeSdkContext)
  if (!context) {
    throw new Error("Extension runtime host context is unavailable.")
  }
  return context
}

export function useExtensionRuntimeHostContextOptional(): ExtensionRuntimeHostContextValue | null {
  return use(extensionRuntimeSdkContext)
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
  value: Omit<ExtensionRuntimeHostContextValue, "navigation">
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
  const sdk = useExtensionRuntimeHostContext()
  const { legacyKey } = options
  const [value, setValue] = useState<TValue>(initialValue)
  const durableOperationsRef = useRef<Promise<void>>(Promise.resolve())
  const localWriteVersionRef = useRef(0)
  const valueRef = useRef(initialValue)
  const enqueueDurableOperation = useCallback((operation: () => Promise<void>): Promise<void> => {
    const result = durableOperationsRef.current.then(operation)
    durableOperationsRef.current = result.catch(() => undefined)
    return result
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadVersion = localWriteVersionRef.current

    const loadStorageValue = async (): Promise<TValue | undefined> => {
      const storedValue = await readCommandStorageValue(sdk.requestHost, key)
      if (storedValue !== undefined) {
        return storedValue as TValue
      }

      if (!legacyKey) {
        return undefined
      }

      const legacyValue = await readCommandStorageValue(sdk.requestHost, legacyKey)
      if (legacyValue === undefined) {
        return undefined
      }

      await enqueueDurableOperation(async () => {
        if (cancelled || localWriteVersionRef.current !== loadVersion) {
          return
        }
        await writeCommandStorageValueAndDiscardLegacy(sdk.requestHost, key, legacyKey, legacyValue)
      })

      return legacyValue as TValue
    }

    void loadStorageValue()
      .then((loadedValue) => {
        if (
          cancelled ||
          localWriteVersionRef.current !== loadVersion ||
          loadedValue === undefined
        ) {
          return
        }

        valueRef.current = loadedValue
        setValue(loadedValue)
      })
      .catch((error: unknown) => {
        handleCommandStorageFailure(sdk.reportFatalError, error)
      })

    return () => {
      cancelled = true
    }
  }, [enqueueDurableOperation, key, legacyKey, sdk.reportFatalError, sdk.requestHost])

  const setStoredValue: Dispatch<SetStateAction<TValue>> = (nextValue) => {
    localWriteVersionRef.current += 1
    const resolvedValue =
      typeof nextValue === "function"
        ? (nextValue as (currentValue: TValue) => TValue)(valueRef.current)
        : nextValue
    valueRef.current = resolvedValue
    setValue(resolvedValue)

    void enqueueDurableOperation(() =>
      writeCommandStorageValueAndDiscardLegacy(sdk.requestHost, key, legacyKey, resolvedValue)
    ).catch((error: unknown) => {
      handleCommandStorageFailure(sdk.reportFatalError, error)
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
