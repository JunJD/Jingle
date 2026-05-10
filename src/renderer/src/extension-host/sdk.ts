import { useEffect, useMemo, type ComponentType, type ReactNode } from "react"
import {
  createLauncherIntentPresentation,
  type LauncherCommandSearchDefinition,
  type LauncherResultPresentation,
  type LauncherResultPresentationIcon,
  type LauncherResultPresentationTone,
  type LauncherShellConfig
} from "@shared/launcher"
import { createNativeExtensionNavigationBridge } from "@shared/native-extension-boundaries"
import type { NativeExtensionInvokeRequest } from "@shared/native-extensions"
import type { AppCopy } from "@/lib/i18n/messages"
import type {
  LauncherCommandAddress,
  LauncherCommandOpenOptions,
  LauncherNoViewCommandRunContext
} from "@launcher-shell/pages/types"
import {
  useNativeExtensionClipboard as useNativeExtensionClipboardBase,
  useNativeExtensionHost as useNativeExtensionHostBase,
  useNativeExtensionHostOptional as useNativeExtensionHostOptionalBase,
  useNativeExtensionLifecycle as useNativeExtensionLifecycleBase,
  useNativeExtensionNavigation as useNativeExtensionNavigationBase,
  useNativeExtensionSurface as useNativeExtensionSurfaceBase,
  useNativeExtensionThreads as useNativeExtensionThreadsBase,
  type NativeExtensionHostValue
} from "./NativeExtensionHost"
import { useNativeExtensionViewStack } from "./view-stack-context"

export type NativeExtensionSearchDefinition = LauncherCommandSearchDefinition<AppCopy>

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
  default: (context: LauncherNoViewCommandRunContext) => Promise<void> | void
  search?: NativeExtensionSearchDefinition
}

export interface NativeExtensionNavigation {
  canPop: boolean
  goHome: () => void
  hideLauncher: () => Promise<void>
  openCommand: (
    address: LauncherCommandAddress,
    options?: LauncherCommandOpenOptions
  ) => void
  pop: () => void
  push: (view: ReactNode) => void
}

export interface NativeExtensionIntentPresentationInput {
  categoryLabel: string
  icon: LauncherResultPresentationIcon
  listActionLabel?: string
  primaryActionLabel: string
  tone?: LauncherResultPresentationTone
}

export function createNativeExtensionIntentPresentation(
  input: NativeExtensionIntentPresentationInput
): LauncherResultPresentation {
  return createLauncherIntentPresentation(input)
}

export function createNativeExtensionClient<
  TMethods extends Record<string, NativeExtensionClientMethod<unknown, unknown>>
>(extensionName: string, declaredMethods: readonly string[], methods: TMethods) {
  const clientMethodNames = Object.keys(methods)

  if (declaredMethods.length !== clientMethodNames.length) {
    throw new Error(
      `Native extension client "${extensionName}" method count does not match its manifest RPC declaration`
    )
  }

  for (const methodName of clientMethodNames) {
    if (!declaredMethods.includes(methodName)) {
      throw new Error(
        `Native extension client "${extensionName}" implements "${methodName}" but it is not declared in the manifest`
      )
    }
  }

  return Object.fromEntries(
    clientMethodNames.map((methodName) => [
      methodName,
      (payload: unknown) =>
        window.api.nativeExtensions.invoke({
          extensionName,
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

export function useCommandSeedQuery(): string {
  const host = useNativeExtensionHost()
  return host.seedQuery
}

export function useBackgroundRefresh(
  callback: () => void | Promise<void>,
  intervalMs: number | null | undefined
): void {
  useEffect(() => {
    if (!intervalMs || intervalMs <= 0) {
      return
    }

    let cancelled = false
    let pending = false
    const run = (): void => {
      if (pending) {
        return
      }

      pending = true
      void Promise.resolve(callback()).finally(() => {
        pending = false
      })
    }

    const timer = window.setInterval(() => {
      if (!cancelled) {
        run()
      }
    }, intervalMs)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [callback, intervalMs])
}

export const useNativeExtensionHost = useNativeExtensionHostBase
export const useNativeExtensionHostOptional = useNativeExtensionHostOptionalBase
export const useNativeExtensionLifecycle = useNativeExtensionLifecycleBase
export const useNativeExtensionClipboard = useNativeExtensionClipboardBase
export const useNativeExtensionSurface = useNativeExtensionSurfaceBase
export const useNativeExtensionThreads = useNativeExtensionThreadsBase

export function useNativeExtensionNavigation(): NativeExtensionNavigation {
  const host = useNativeExtensionHost()
  const navigation = useNativeExtensionNavigationBase()
  const stack = useNativeExtensionViewStack()

  return useMemo(
    () =>
      createNativeExtensionNavigationBridge({
        commandName: host.commandName,
        extensionName: host.extensionName,
        navigation,
        stack
      }),
    [host.commandName, host.extensionName, navigation, stack]
  )
}

export type { NativeExtensionHostValue }
