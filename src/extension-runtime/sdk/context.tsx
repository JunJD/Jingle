/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
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
  requestHost: (request: ExtensionRuntimeHostRequestInput) => Promise<ExtensionHostResponse>
}

const extensionRuntimeSdkContext = createContext<ExtensionRuntimeSdkContextValue | null>(null)

export function ExtensionRuntimeSdkProvider(props: {
  children?: ReactNode
  value: ExtensionRuntimeSdkContextValue
}): React.JSX.Element {
  return (
    <extensionRuntimeSdkContext.Provider value={props.value}>
      {props.children}
    </extensionRuntimeSdkContext.Provider>
  )
}

export function useExtensionRuntimeSdk(): ExtensionRuntimeSdkContextValue {
  const context = useContext(extensionRuntimeSdkContext)
  if (!context) {
    throw new Error("useExtensionRuntimeSdk must be used within ExtensionRuntimeSdkProvider")
  }

  return context
}

export function useCommandSeedQuery(): string {
  return useExtensionRuntimeSdk().seedQuery
}

export function useNativeCommandPreferences<TPreferences extends object>(): TPreferences {
  return useExtensionRuntimeSdk().commandPreferences as TPreferences
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
