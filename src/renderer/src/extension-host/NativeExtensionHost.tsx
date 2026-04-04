import { createContext, useContext, useEffect, useEffectEvent, useRef, type ReactNode, type RefObject } from "react"
import type { LauncherPluginCapability } from "@shared/launcher-plugin"
import type { LauncherShellConfig } from "@shared/launcher"
import type { LauncherClipboardState } from "@launcher-shell/LauncherClipboardContext"
import type { LauncherInputStatus } from "@launcher-shell/launcher-input-status"
import type {
  LauncherCommandInitialAction,
  LauncherCommandName,
  LauncherCommandNavigation,
  LauncherExtensionName
} from "@launcher-shell/pages/types"

export type NativeExtensionInputElement = HTMLInputElement | HTMLTextAreaElement

export interface NativeExtensionSurface {
  inputRef: RefObject<NativeExtensionInputElement | null>
  inputStatus: LauncherInputStatus
  shellConfig: LauncherShellConfig
  setInputStatus: (status: LauncherInputStatus) => void
  shownSequence: number
  viewportHeight: number
}

export interface NativeExtensionThreadHandle {
  modelId: string
  threadId: string
  workspacePath: string
}

export interface NativeExtensionThreadCreateInput {
  draftInput?: string
  source: string
  title: string
  visibility: string
}

export interface NativeExtensionThreadSubmitInput {
  message: string
  threadId: string
}

export interface NativeExtensionHostValue {
  capabilities: readonly LauncherPluginCapability[]
  clipboard?: Pick<LauncherClipboardState, "clearContext" | "context">
  commandName: LauncherCommandName
  commandPreferences: Record<string, unknown>
  extensionName: LauncherExtensionName
  initialAction: LauncherCommandInitialAction
  navigation?: LauncherCommandNavigation
  seedQuery: string
  surface?: NativeExtensionSurface
  threads?: {
    create: (input: NativeExtensionThreadCreateInput) => Promise<NativeExtensionThreadHandle>
    reload: (threadId: string) => Promise<void>
    submit: (input: NativeExtensionThreadSubmitInput) => Promise<void>
  }
}

interface NativeExtensionLifecycleHandlers {
  onEnter?: () => void
  onLauncherShown?: () => void
  onLeave?: () => void
}

const nativeExtensionHostContext = createContext<NativeExtensionHostValue | null>(null)

export function NativeExtensionHostProvider(props: {
  children: ReactNode
  value: NativeExtensionHostValue
}): React.JSX.Element {
  const { children, value } = props

  return (
    <nativeExtensionHostContext.Provider value={value}>{children}</nativeExtensionHostContext.Provider>
  )
}

export function useNativeExtensionHost(): NativeExtensionHostValue {
  const context = useContext(nativeExtensionHostContext)

  if (!context) {
    throw new Error("useNativeExtensionHost must be used within NativeExtensionHostProvider")
  }

  return context
}

export function useNativeExtensionHostOptional(): NativeExtensionHostValue | null {
  return useContext(nativeExtensionHostContext)
}

function requireNativeExtensionCapability<TValue>(
  host: NativeExtensionHostValue,
  capability: LauncherPluginCapability,
  value: TValue | undefined
): TValue {
  if (value) {
    return value
  }

  if (!host.capabilities.includes(capability)) {
    throw new Error(
      `Native extension "${host.extensionName}" tried to use the "${capability}" capability without declaring it`
    )
  }

  throw new Error(
    `Native extension "${host.extensionName}" declares the "${capability}" capability but the host did not provide it`
  )
}

export function useNativeExtensionClipboard(): NonNullable<NativeExtensionHostValue["clipboard"]> {
  const host = useNativeExtensionHost()
  return requireNativeExtensionCapability(host, "clipboard", host.clipboard)
}

export function useNativeExtensionNavigation(): LauncherCommandNavigation {
  const host = useNativeExtensionHost()
  return requireNativeExtensionCapability(host, "navigation", host.navigation)
}

export function useNativeExtensionSurface(): NativeExtensionSurface {
  const host = useNativeExtensionHost()
  return requireNativeExtensionCapability(host, "surface", host.surface)
}

export function useNativeExtensionThreads(): NonNullable<NativeExtensionHostValue["threads"]> {
  const host = useNativeExtensionHost()
  return requireNativeExtensionCapability(host, "threads", host.threads)
}

export function useNativeExtensionLifecycle(handlers: NativeExtensionLifecycleHandlers): void {
  const { onEnter, onLauncherShown, onLeave } = handlers
  const { shownSequence } = useNativeExtensionSurface()
  const lastShownSequenceRef = useRef(shownSequence)
  const runOnEnter = useEffectEvent(() => {
    onEnter?.()
  })
  const runOnLauncherShown = useEffectEvent(() => {
    onLauncherShown?.()
  })
  const runOnLeave = useEffectEvent(() => {
    onLeave?.()
  })

  useEffect(() => {
    runOnEnter()

    return () => {
      runOnLeave()
    }
  }, [])

  useEffect(() => {
    if (shownSequence === lastShownSequenceRef.current) {
      return
    }

    lastShownSequenceRef.current = shownSequence
    runOnLauncherShown()
  }, [shownSequence])
}
