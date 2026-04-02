import type { ComponentType } from "react"
import type { AppLocale } from "../../../../shared/i18n"
import type { LauncherShellConfig } from "../../../../shared/launcher"
import type { NativeExtensionInvokeRequest } from "../../../../shared/native-extensions"
import type { AppCopy } from "@/lib/i18n/messages"
import type {
  LauncherNoViewPluginRunContext,
  LauncherPluginCommandMatch,
  LauncherPluginCommandParams,
  LauncherPluginIntent
} from "../pages/types"
import {
  createBuiltLauncherIntentPresentation,
  useBuiltLauncherPluginClipboard,
  useBuiltLauncherPluginHost,
  useBuiltLauncherPluginLifecycle,
  useBuiltLauncherPluginNavigation,
  useBuiltLauncherPluginSurface,
  useBuiltLauncherPluginThreads,
  type BuiltLauncherIntentPresentationInput
} from "../built-plugins/sdk"

export interface NativeExtensionSearchDefinition {
  buildIntentItems?: (context: {
    copy: AppCopy
    locale: AppLocale
    query: string
  }) => LauncherPluginIntent[]
  resolveCommand?: (params: LauncherPluginCommandParams) => LauncherPluginCommandMatch | null
}

export type NativeExtensionViewport =
  | {
      bodyHeight: number
    }
  | {
      getHeight: (shellConfig: LauncherShellConfig) => number
    }

export interface NativeViewCommandModule {
  default: ComponentType
  search?: NativeExtensionSearchDefinition
  viewport: NativeExtensionViewport
}

export interface NativeNoViewCommandModule {
  default: (context: LauncherNoViewPluginRunContext) => Promise<void> | void
  search?: NativeExtensionSearchDefinition
}

export function createNativeExtensionIntentPresentation(
  input: BuiltLauncherIntentPresentationInput
) {
  return createBuiltLauncherIntentPresentation(input)
}

export function createNativeExtensionClient<
  TMethods extends Record<string, NativeExtensionClientMethod<unknown, unknown>>
>(pluginId: string, declaredMethods: readonly string[], methods: TMethods) {
  const clientMethodNames = Object.keys(methods)

  if (declaredMethods.length !== clientMethodNames.length) {
    throw new Error(
      `Native extension client "${pluginId}" method count does not match its manifest RPC declaration`
    )
  }

  for (const methodName of clientMethodNames) {
    if (!declaredMethods.includes(methodName)) {
      throw new Error(
        `Native extension client "${pluginId}" implements "${methodName}" but it is not declared in the manifest`
      )
    }
  }

  return Object.fromEntries(
    clientMethodNames.map((methodName) => [
      methodName,
      (payload: unknown) =>
        window.api.nativeExtensions.invoke({
          extensionName: pluginId,
          method: methodName,
          payload
        } satisfies NativeExtensionInvokeRequest)
    ])
  ) as NativeExtensionClient<TMethods>
}

export interface NativeExtensionClientMethod<TPayload, TResult> {
  payload?: TPayload
  result?: TResult
}

type NativeExtensionClient<
  TMethods extends Record<string, NativeExtensionClientMethod<unknown, unknown>>
> = {
  [TMethod in keyof TMethods]: (
    payload: NonNullable<TMethods[TMethod]["payload"]>
  ) => Promise<NonNullable<TMethods[TMethod]["result"]>>
}

export function defineNativeExtensionClientMethod<TPayload, TResult>(): NativeExtensionClientMethod<
  TPayload,
  TResult
> {
  return {}
}

export function useNativeCommandPreferences<T extends object>() {
  const host = useNativeExtensionHost()
  return host.commandPreferences as T
}

export const useNativeExtensionHost = useBuiltLauncherPluginHost
export const useNativeExtensionLifecycle = useBuiltLauncherPluginLifecycle
export const useNativeExtensionClipboard = useBuiltLauncherPluginClipboard
export const useNativeExtensionNavigation = useBuiltLauncherPluginNavigation
export const useNativeExtensionSurface = useBuiltLauncherPluginSurface
export const useNativeExtensionThreads = useBuiltLauncherPluginThreads
