/* eslint-disable react-refresh/only-export-components */
import {
  createElement,
  createContext,
  useCallback,
  useContext,
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
import type {
  ExtensionHostRequest,
  ExtensionHostResponse,
  ExtensionRuntimeLaunchContext,
  ExtensionRuntimeLaunchProps
} from "../../shared/extension-runtime-protocol"

export type ExtensionRuntimeHostRequestInput = ExtensionHostRequest extends infer TRequest
  ? TRequest extends { id: string }
    ? Omit<TRequest, "id">
    : never
  : never

export interface ExtensionRuntimeSdkContextValue extends ExtensionRuntimeLaunchContext {
  navigation: ExtensionRuntimeNavigation
  requestHost: (request: ExtensionRuntimeHostRequestInput) => Promise<ExtensionHostResponse>
  registerToastAction?: (handler: RuntimeToastActionHandler) => RuntimeToastActionRegistration
}

export type RuntimeToastActionHandler = () => Promise<void> | void

export interface RuntimeToastActionRegistration {
  id: string
}

export interface ExtensionRuntimeCommandAddress {
  commandName: string
  extensionName: string
  kind?: "extension-command"
}

export interface ExtensionRuntimeCommandOpenOptions {
  launchProps?: ExtensionRuntimeLaunchProps
  showLauncher?: boolean
}

export interface LaunchProps<
  TArguments extends { arguments?: Record<string, unknown> } | Record<string, unknown> = Record<
    string,
    unknown
  >
> {
  arguments: TArguments extends { arguments?: infer TLaunchArguments }
    ? TLaunchArguments
    : TArguments
  draftValues?: Record<string, unknown>
  fallbackText?: string
  [key: string]: unknown
  launchContext?: Record<string, unknown>
}

export enum PopToRootType {
  Default = "default",
  Immediate = "immediate",
  Suspended = "suspended"
}

export enum LaunchType {
  Background = "background",
  UserInitiated = "userInitiated"
}

export interface LaunchCommandOptions {
  arguments?: Record<string, unknown>
  commandName?: string
  context?: Record<string, unknown>
  extensionName?: string
  fallbackText?: string
  name?: string
  ownerOrAuthorName?: string
  type: LaunchType
}

export function createExtensionRuntimeLaunchProps(
  context: Pick<ExtensionRuntimeLaunchContext, "launchProps">
): LaunchProps {
  return {
    arguments: context.launchProps?.arguments ?? {},
    ...(context.launchProps?.draftValues ? { draftValues: context.launchProps.draftValues } : {}),
    ...(context.launchProps?.fallbackText !== undefined
      ? { fallbackText: context.launchProps.fallbackText }
      : {}),
    ...(context.launchProps?.launchContext
      ? { launchContext: context.launchProps.launchContext }
      : {})
  }
}

export interface CloseMainWindowOptions {
  clearRootSearch?: boolean
  popToRootType?: PopToRootType
}

export interface ExtensionRuntimeNavigation {
  canPop: boolean
  goHome: () => void
  hideLauncher: () => Promise<void>
  openCommand: (
    address: ExtensionRuntimeCommandAddress,
    options?: ExtensionRuntimeCommandOpenOptions
  ) => Promise<void>
  pop: () => void
  push: (view: ReactNode) => void
}

const extensionRuntimeSdkContext = createContext<ExtensionRuntimeSdkContextValue | null>(null)
// extension-api facade 和 runtime source 可能被不同模块图各加载一份；
// active context 放到 globalThis，避免顶层 SDK 读取落到另一份模块局部状态。
const RUNTIME_SDK_GLOBAL_STATE_KEY = Symbol.for("openwork.extensionRuntimeSdk.context")

type RuntimeSdkGlobal = typeof globalThis & {
  process?: {
    getBuiltinModule?: (id: string) => unknown
  }
}

interface RuntimeSdkGlobalState {
  activeContextValue: ExtensionRuntimeSdkContextValue | null
  asyncContextStorage: RuntimeSdkAsyncContextStorage | null | undefined
}

interface RuntimeSdkAsyncContextStorage {
  getStore: () => ExtensionRuntimeSdkContextValue | undefined
  run: <TResult>(value: ExtensionRuntimeSdkContextValue, callback: () => TResult) => TResult
}

function getActiveRuntimeSdkContextValue(): ExtensionRuntimeSdkContextValue | null {
  const globalState = getRuntimeSdkGlobalState()
  const asyncContextValue = globalState.asyncContextStorage?.getStore()
  if (asyncContextValue) {
    return asyncContextValue
  }

  return globalState.activeContextValue
}

function setActiveRuntimeSdkContextValue(value: ExtensionRuntimeSdkContextValue | null): void {
  getRuntimeSdkGlobalState().activeContextValue = value
}

function getRuntimeSdkAsyncContextStorage(): RuntimeSdkAsyncContextStorage | null {
  const globalState = getRuntimeSdkGlobalState()
  if (globalState.asyncContextStorage !== undefined) {
    return globalState.asyncContextStorage
  }

  globalState.asyncContextStorage = createRuntimeSdkAsyncContextStorage()
  return globalState.asyncContextStorage
}

function getRuntimeSdkGlobalState(): RuntimeSdkGlobalState {
  const runtimeGlobal = globalThis as RuntimeSdkGlobal & Record<symbol, RuntimeSdkGlobalState>
  let globalState = runtimeGlobal[RUNTIME_SDK_GLOBAL_STATE_KEY]
  if (!globalState) {
    globalState = {
      activeContextValue: null,
      asyncContextStorage: undefined
    }
    runtimeGlobal[RUNTIME_SDK_GLOBAL_STATE_KEY] = globalState
  }

  return globalState
}

function createRuntimeSdkAsyncContextStorage(): RuntimeSdkAsyncContextStorage | null {
  const AsyncLocalStorage = resolveAsyncLocalStorageConstructor()
  if (!AsyncLocalStorage) {
    return null
  }

  return new AsyncLocalStorage<ExtensionRuntimeSdkContextValue>()
}

function resolveAsyncLocalStorageConstructor():
  | (new <TValue>() => {
      getStore: () => TValue | undefined
      run: <TResult>(value: TValue, callback: () => TResult) => TResult
    })
  | null {
  const runtimeGlobal = globalThis as RuntimeSdkGlobal
  const getBuiltinModule = runtimeGlobal.process?.getBuiltinModule
  const builtinAsyncHooks =
    getBuiltinModule?.("node:async_hooks") ?? getBuiltinModule?.("async_hooks")
  const builtinAsyncLocalStorage = readAsyncLocalStorageConstructor(builtinAsyncHooks)
  if (builtinAsyncLocalStorage) {
    return builtinAsyncLocalStorage
  }

  const commonJsRequire = getCommonJsRequire()
  const requiredAsyncHooks =
    commonJsRequire?.("node:async_hooks") ?? commonJsRequire?.("async_hooks")
  return readAsyncLocalStorageConstructor(requiredAsyncHooks)
}

function readAsyncLocalStorageConstructor(
  value: unknown
): (new <TValue>() => RuntimeSdkAsyncContextStorageFor<TValue>) | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const constructor = (value as { AsyncLocalStorage?: unknown }).AsyncLocalStorage
  return typeof constructor === "function"
    ? (constructor as new <TValue>() => RuntimeSdkAsyncContextStorageFor<TValue>)
    : null
}

type RuntimeSdkAsyncContextStorageFor<TValue> = {
  getStore: () => TValue | undefined
  run: <TResult>(value: TValue, callback: () => TResult) => TResult
}

function getCommonJsRequire(): ((id: string) => unknown) | null {
  try {
    const commonJsRequire = (0, eval)("require") as unknown
    return typeof commonJsRequire === "function"
      ? (commonJsRequire as (id: string) => unknown)
      : null
  } catch {
    return null
  }
}

export function createExtensionRuntimeNavigation(params: {
  canPop?: boolean
  onPop?: () => void
  onPush?: (view: ReactNode) => void
  requestHost: (request: ExtensionRuntimeHostRequestInput) => Promise<ExtensionHostResponse>
}): ExtensionRuntimeNavigation {
  const { requestHost } = params

  return {
    canPop: params.canPop ?? false,
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
    openCommand: async (address, options) => {
      const response = await requestHost({
        capability: "navigation",
        method: "open-command",
        payload: {
          commandName: address.commandName,
          extensionName: address.extensionName,
          launchProps: options?.launchProps,
          showLauncher: options?.showLauncher
        }
      })
      if (!response.ok) {
        throw new Error(response.error.message)
      }
    },
    pop: params.onPop ?? (() => {}),
    push: params.onPush ?? (() => {})
  }
}

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

export function getActiveExtensionRuntimeSdk(): ExtensionRuntimeSdkContextValue {
  const activeRuntimeSdkContextValue = getActiveRuntimeSdkContextValue()
  if (!activeRuntimeSdkContextValue) {
    throw new Error("Extension runtime SDK is not initialized.")
  }

  return activeRuntimeSdkContextValue
}

export async function runWithExtensionRuntimeSdk<T>(
  value: ExtensionRuntimeSdkContextValue,
  callback: () => Promise<T> | T
): Promise<T> {
  const asyncContextStorage = getRuntimeSdkAsyncContextStorage()
  if (asyncContextStorage) {
    return await asyncContextStorage.run(value, callback)
  }

  const previousValue = getRuntimeSdkGlobalState().activeContextValue
  setActiveRuntimeSdkContextValue(value)

  try {
    return await callback()
  } finally {
    if (getRuntimeSdkGlobalState().activeContextValue === value) {
      setActiveRuntimeSdkContextValue(previousValue)
    }
  }
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

export function useRuntimeAppLocale(): ExtensionRuntimeSdkContextValue["locale"] {
  return useExtensionRuntimeSdk().locale
}

export function useNativeCommandPreferences<TPreferences extends object>(): TPreferences {
  return useExtensionRuntimeSdk().commandPreferences as TPreferences
}

export function getPreferenceValues<TPreferences extends object>(): TPreferences {
  return createDeferredPreferenceValues() as TPreferences
}

function readActivePreferenceValues(): Record<string, unknown> {
  const context = getActiveExtensionRuntimeSdk()
  return {
    ...context.extensionPreferences,
    ...context.commandPreferences
  }
}

function createDeferredPreferenceValues(): object {
  // 扩展模块可能在 import 阶段调用 getPreferenceValues，此时 runtime context
  // 还没建立。始终返回 lazy proxy，避免模块缓存保存某一次运行的 preference 快照。
  return new Proxy(
    {},
    {
      get(_target, property) {
        return readActivePreferenceValues()[property as string]
      },
      getOwnPropertyDescriptor(_target, property) {
        const values = readActivePreferenceValues()
        return property in values
          ? {
              configurable: true,
              enumerable: true,
              value: values[property as string]
            }
          : undefined
      },
      has(_target, property) {
        return property in readActivePreferenceValues()
      },
      ownKeys() {
        return Reflect.ownKeys(readActivePreferenceValues())
      }
    }
  )
}

export function getConnectionSecret(name: string): string {
  const context = getActiveExtensionRuntimeSdk()
  const extensionValue = normalizeConnectionSecretValue(context.extensionPreferences[name])
  if (extensionValue) {
    return extensionValue
  }

  return normalizeConnectionSecretValue(context.commandPreferences[name])
}

function normalizeConnectionSecretValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
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

export async function closeMainWindow(_options?: CloseMainWindowOptions): Promise<void> {
  void _options
  await getActiveExtensionRuntimeSdk().navigation.hideLauncher()
}

export async function launchCommand(options: LaunchCommandOptions): Promise<void> {
  const context = getActiveExtensionRuntimeSdk()
  const commandName = options.commandName ?? options.name
  if (!commandName) {
    throw new Error("launchCommand requires a command name.")
  }

  await context.navigation.openCommand(
    {
      commandName,
      extensionName: options.extensionName ?? context.extensionName
    },
    {
      launchProps: {
        ...(options.arguments ? { arguments: options.arguments } : {}),
        ...(options.context ? { launchContext: options.context } : {}),
        ...(options.fallbackText !== undefined ? { fallbackText: options.fallbackText } : {})
      },
      showLauncher: options.type === LaunchType.UserInitiated
    }
  )
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
        key,
        scope: "command"
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
