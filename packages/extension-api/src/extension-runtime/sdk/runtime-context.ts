import type { ReactNode } from "react"
import type {
  ExtensionHostRequest,
  ExtensionHostResponse,
  ExtensionRuntimeError,
  ExtensionRuntimeErrorDetails,
  ExtensionRuntimeJsonObject,
  ExtensionRuntimeJsonValue,
  ExtensionRuntimeLaunchContext,
  ExtensionRuntimeLaunchProps
} from "../../shared/extension-runtime-protocol"
import {
  normalizeExtensionRuntimeErrorDetails,
  normalizeExtensionRuntimeJsonFact,
  normalizeExtensionRuntimeLaunchProps,
  normalizeExtensionRuntimeNavigationHostRequest
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

export interface ExtensionRuntimeHostContextValue extends ExtensionRuntimeSdkContextValue {
  reportFatalError: (error: unknown) => void
}

export class ExtensionRuntimeRequestError extends Error {
  readonly code: string
  readonly details: ExtensionRuntimeErrorDetails | undefined

  constructor(error: ExtensionRuntimeError) {
    const details = tryNormalizeRuntimeRequestErrorDetails(error.details)
    const invalidStorageRecovery = error.code === "storage_legacy_unowned" && !details
    super(
      invalidStorageRecovery
        ? "Extension runtime returned invalid storage recovery details."
        : error.message
    )
    this.code = invalidStorageRecovery ? "runtime_response_invalid" : error.code
    this.details = details
    this.name = "ExtensionRuntimeRequestError"
  }
}

function tryNormalizeRuntimeRequestErrorDetails(
  details: unknown
): ExtensionRuntimeErrorDetails | undefined {
  if (details === undefined) {
    return undefined
  }
  try {
    return normalizeExtensionRuntimeErrorDetails(details)
  } catch {
    return undefined
  }
}

export function throwExtensionRuntimeRequestError(error: ExtensionRuntimeError): never {
  throw new ExtensionRuntimeRequestError(error)
}

export type RuntimeToastActionHandler = () => Promise<void> | void

export interface RuntimeToastActionRegistration {
  id: string
}

export async function sendExtensionRuntimeHostRequest(
  request: ExtensionRuntimeHostRequestInput,
  options: {
    createRequestId: () => string
    send: (request: ExtensionHostRequest) => Promise<ExtensionHostResponse>
  }
): Promise<ExtensionHostResponse> {
  const normalizedRequest = finalizeExtensionRuntimeHostRequest(request, options.createRequestId())
  return options.send(normalizedRequest)
}

function finalizeExtensionRuntimeHostRequest(
  request: ExtensionRuntimeHostRequestInput,
  requestId: string
): ExtensionHostRequest {
  if (!request || typeof request !== "object") {
    throw new TypeError("extension runtime host request must be an object")
  }

  const descriptors = Object.getOwnPropertyDescriptors(request)
  if (Object.prototype.hasOwnProperty.call(descriptors, "id")) {
    throw new TypeError("extension runtime host request id is owned by the runtime")
  }
  const capabilityDescriptor = descriptors.capability
  if (
    !capabilityDescriptor?.enumerable ||
    !("value" in capabilityDescriptor) ||
    typeof capabilityDescriptor.value !== "string"
  ) {
    throw new TypeError("extension runtime host request capability must be a data property")
  }

  const requestWithId = Object.create(Object.getPrototypeOf(request), {
    ...descriptors,
    id: {
      configurable: false,
      enumerable: true,
      value: requestId,
      writable: false
    }
  }) as ExtensionHostRequest

  return capabilityDescriptor.value === "navigation"
    ? normalizeExtensionRuntimeNavigationHostRequest(requestWithId)
    : requestWithId
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
  arguments?: ExtensionRuntimeJsonObject
  commandName?: string
  context?: ExtensionRuntimeJsonObject
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

const RUNTIME_SDK_GLOBAL_STATE_KEY = Symbol.for("jingle.extensionRuntimeSdk.context")

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

type RuntimeSdkAsyncContextStorageFor<TValue> = {
  getStore: () => TValue | undefined
  run: <TResult>(value: TValue, callback: () => TResult) => TResult
}

export function getActiveRuntimeSdkContextValue(): ExtensionRuntimeSdkContextValue | null {
  const globalState = getRuntimeSdkGlobalState()
  const asyncContextValue = globalState.asyncContextStorage?.getStore()
  if (asyncContextValue) {
    return asyncContextValue
  }

  return globalState.activeContextValue
}

export function setActiveRuntimeSdkContextValue(
  value: ExtensionRuntimeSdkContextValue | null
): void {
  getRuntimeSdkGlobalState().activeContextValue = value
}

export function getRuntimeSdkGlobalState(): RuntimeSdkGlobalState {
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

function getRuntimeSdkAsyncContextStorage(): RuntimeSdkAsyncContextStorage | null {
  const globalState = getRuntimeSdkGlobalState()
  if (globalState.asyncContextStorage !== undefined) {
    return globalState.asyncContextStorage
  }

  globalState.asyncContextStorage = createRuntimeSdkAsyncContextStorage()
  return globalState.asyncContextStorage
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
        throwExtensionRuntimeRequestError(response.error)
      }
    },
    openCommand: async (address, options) => {
      const normalized = normalizeNavigationOpenCommandInput(address, options)
      const response = await requestHost({
        capability: "navigation",
        method: "open-command",
        payload: {
          commandName: normalized.address.commandName,
          extensionName: normalized.address.extensionName,
          ...(normalized.options?.launchProps
            ? { launchProps: normalized.options.launchProps }
            : {}),
          ...(normalized.options?.showLauncher !== undefined
            ? { showLauncher: normalized.options.showLauncher }
            : {})
        }
      })
      if (!response.ok) {
        throwExtensionRuntimeRequestError(response.error)
      }
    },
    pop: params.onPop ?? (() => {}),
    push: params.onPush ?? (() => {})
  }
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
  return normalizeConnectionSecretValue(context.extensionPreferences[name])
}

function normalizeConnectionSecretValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export async function closeMainWindow(_options?: CloseMainWindowOptions): Promise<void> {
  void _options
  await getActiveExtensionRuntimeSdk().navigation.hideLauncher()
}

export async function launchCommand(options: LaunchCommandOptions): Promise<void> {
  const normalizedOptions = normalizeLaunchCommandOptions(options)
  const context = getActiveExtensionRuntimeSdk()
  const commandName = normalizedOptions.commandName ?? normalizedOptions.name
  if (!commandName) {
    throw new Error("launchCommand requires a command name.")
  }

  await context.navigation.openCommand(
    {
      commandName,
      extensionName: normalizedOptions.extensionName ?? context.extensionName
    },
    {
      launchProps: {
        ...(normalizedOptions.arguments ? { arguments: normalizedOptions.arguments } : {}),
        ...(normalizedOptions.context ? { launchContext: normalizedOptions.context } : {}),
        ...(normalizedOptions.fallbackText !== undefined
          ? { fallbackText: normalizedOptions.fallbackText }
          : {})
      },
      showLauncher: normalizedOptions.type === LaunchType.UserInitiated
    }
  )
}

function normalizeNavigationOpenCommandInput(
  address: ExtensionRuntimeCommandAddress,
  options: ExtensionRuntimeCommandOpenOptions | undefined
): {
  address: ExtensionRuntimeCommandAddress
  options?: ExtensionRuntimeCommandOpenOptions
} {
  const path = "extension runtime navigation openCommand"
  const input = readJsonObject(
    normalizeExtensionRuntimeJsonFact(
      {
        address,
        ...(options === undefined ? {} : { options })
      },
      path
    ),
    path
  )
  assertExactJsonKeys(input, path, ["address", "options"])
  const normalizedAddress = readJsonObject(input.address, `${path}.address`)
  assertExactJsonKeys(normalizedAddress, `${path}.address`, [
    "commandName",
    "extensionName",
    "kind"
  ])
  const commandName = readRequiredString(
    normalizedAddress.commandName,
    `${path}.address.commandName`
  )
  const extensionName = readRequiredString(
    normalizedAddress.extensionName,
    `${path}.address.extensionName`
  )
  if (normalizedAddress.kind !== undefined && normalizedAddress.kind !== "extension-command") {
    throw new TypeError(`${path}.address.kind is invalid`)
  }

  if (!Object.prototype.hasOwnProperty.call(input, "options")) {
    return {
      address: {
        commandName,
        extensionName,
        ...(normalizedAddress.kind ? { kind: normalizedAddress.kind } : {})
      }
    }
  }

  const normalizedOptions = readJsonObject(input.options, `${path}.options`)
  assertExactJsonKeys(normalizedOptions, `${path}.options`, ["launchProps", "showLauncher"])
  const launchProps = Object.prototype.hasOwnProperty.call(normalizedOptions, "launchProps")
    ? normalizeExtensionRuntimeLaunchProps(
        normalizedOptions.launchProps,
        `${path}.options.launchProps`
      )
    : undefined
  if (
    normalizedOptions.showLauncher !== undefined &&
    typeof normalizedOptions.showLauncher !== "boolean"
  ) {
    throw new TypeError(`${path}.options.showLauncher must be a boolean`)
  }

  return {
    address: {
      commandName,
      extensionName,
      ...(normalizedAddress.kind ? { kind: normalizedAddress.kind } : {})
    },
    options: {
      ...(launchProps ? { launchProps } : {}),
      ...(normalizedOptions.showLauncher !== undefined
        ? { showLauncher: normalizedOptions.showLauncher }
        : {})
    }
  }
}

function normalizeLaunchCommandOptions(value: unknown): LaunchCommandOptions {
  const path = "extension runtime launchCommand options"
  const options = readJsonObject(normalizeExtensionRuntimeJsonFact(value, path), path)
  assertExactJsonKeys(options, path, [
    "arguments",
    "commandName",
    "context",
    "extensionName",
    "fallbackText",
    "name",
    "ownerOrAuthorName",
    "type"
  ])
  if (options.type !== LaunchType.Background && options.type !== LaunchType.UserInitiated) {
    throw new TypeError(`${path}.type is invalid`)
  }

  return {
    ...(Object.prototype.hasOwnProperty.call(options, "arguments")
      ? { arguments: readJsonObject(options.arguments, `${path}.arguments`) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(options, "commandName")
      ? { commandName: readRequiredString(options.commandName, `${path}.commandName`) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(options, "context")
      ? { context: readJsonObject(options.context, `${path}.context`) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(options, "extensionName")
      ? { extensionName: readRequiredString(options.extensionName, `${path}.extensionName`) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(options, "fallbackText")
      ? { fallbackText: readString(options.fallbackText, `${path}.fallbackText`) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(options, "name")
      ? { name: readRequiredString(options.name, `${path}.name`) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(options, "ownerOrAuthorName")
      ? {
          ownerOrAuthorName: readRequiredString(
            options.ownerOrAuthorName,
            `${path}.ownerOrAuthorName`
          )
        }
      : {}),
    type: options.type
  }
}

function readJsonObject(
  value: ExtensionRuntimeJsonValue | undefined,
  path: string
): ExtensionRuntimeJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be a plain object`)
  }
  return value as ExtensionRuntimeJsonObject
}

function assertExactJsonKeys(
  value: ExtensionRuntimeJsonObject,
  path: string,
  supportedKeys: readonly string[]
): void {
  const supported = new Set(supportedKeys)
  for (const key of Object.keys(value)) {
    if (!supported.has(key)) {
      throw new TypeError(`${path} contains unsupported property ${JSON.stringify(key)}`)
    }
  }
}

function readRequiredString(value: ExtensionRuntimeJsonValue | undefined, path: string): string {
  const text = readString(value, path)
  if (text.trim().length === 0) {
    throw new TypeError(`${path} must be non-empty`)
  }
  return text
}

function readString(value: ExtensionRuntimeJsonValue | undefined, path: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${path} must be a string`)
  }
  return value
}
