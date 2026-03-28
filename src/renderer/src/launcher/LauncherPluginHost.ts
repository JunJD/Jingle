import { createContext, useContext, useEffect, useEffectEvent, useRef, type RefObject } from "react"
import type { LauncherPluginCapability } from "../../../shared/launcher-plugin"
import type { LauncherShellConfig } from "../../../shared/launcher"
import type { LauncherClipboardState } from "./LauncherClipboardContext"
import type { LauncherInputStatus } from "./launcher-input-status"
import type {
  LauncherPluginEntryAddress,
  LauncherPluginEntryInitialAction,
  LauncherPluginEntryId,
  LauncherPluginId,
  LauncherPluginOpenOptions
} from "./pages/types"

export type LauncherPluginInputElement = HTMLInputElement | HTMLTextAreaElement

export interface LauncherPluginSurface {
  inputRef: RefObject<LauncherPluginInputElement | null>
  inputStatus: LauncherInputStatus
  shellConfig: LauncherShellConfig
  setInputStatus: (status: LauncherInputStatus) => void
  shownSequence: number
  viewportHeight: number
}

export interface LauncherPluginThreadHandle {
  modelId: string
  threadId: string
  workspacePath: string
}

export interface LauncherPluginThreadCreateInput {
  draftInput?: string
  source: string
  title: string
  visibility: string
}

export interface LauncherPluginThreadSubmitInput {
  message: string
  threadId: string
}

export interface LauncherPluginNavigation {
  goHome: () => void
  hideLauncher: () => Promise<void>
  openEntry: (address: LauncherPluginEntryAddress, options?: LauncherPluginOpenOptions) => void
}

export interface LauncherPluginHostValue {
  capabilities: readonly LauncherPluginCapability[]
  clipboard?: Pick<LauncherClipboardState, "clearContext" | "context">
  entryId: LauncherPluginEntryId
  initialAction: LauncherPluginEntryInitialAction
  navigation?: LauncherPluginNavigation
  pluginId: LauncherPluginId
  seedQuery: string
  surface?: LauncherPluginSurface
  threads?: {
    create: (input: LauncherPluginThreadCreateInput) => Promise<LauncherPluginThreadHandle>
    reload: (threadId: string) => Promise<void>
    submit: (input: LauncherPluginThreadSubmitInput) => Promise<void>
  }
}

interface LauncherPluginLifecycleHandlers {
  onEnter?: () => void
  onLauncherShown?: () => void
  onLeave?: () => void
}

export const launcherPluginHostContext = createContext<LauncherPluginHostValue | null>(null)

export function useLauncherPluginHost(): LauncherPluginHostValue {
  const context = useContext(launcherPluginHostContext)

  if (!context) {
    throw new Error("useLauncherPluginHost must be used within LauncherPluginHostProvider")
  }

  return context
}

function requireLauncherPluginCapability<TValue>(
  host: LauncherPluginHostValue,
  capability: LauncherPluginCapability,
  value: TValue | undefined
): TValue {
  if (value) {
    return value
  }

  if (!host.capabilities.includes(capability)) {
    throw new Error(
      `Launcher plugin "${host.pluginId}" tried to use the "${capability}" capability without declaring it`
    )
  }

  throw new Error(
    `Launcher plugin "${host.pluginId}" declares the "${capability}" capability but the host did not provide it`
  )
}

export function useLauncherPluginClipboard(): NonNullable<LauncherPluginHostValue["clipboard"]> {
  const host = useLauncherPluginHost()
  return requireLauncherPluginCapability(host, "clipboard", host.clipboard)
}

export function useLauncherPluginNavigation(): LauncherPluginNavigation {
  const host = useLauncherPluginHost()
  return requireLauncherPluginCapability(host, "navigation", host.navigation)
}

export function useLauncherPluginSurface(): LauncherPluginSurface {
  const host = useLauncherPluginHost()
  return requireLauncherPluginCapability(host, "surface", host.surface)
}

export function useLauncherPluginThreads(): NonNullable<LauncherPluginHostValue["threads"]> {
  const host = useLauncherPluginHost()
  return requireLauncherPluginCapability(host, "threads", host.threads)
}

export function useLauncherPluginLifecycle(handlers: LauncherPluginLifecycleHandlers): void {
  const { onEnter, onLauncherShown, onLeave } = handlers
  const { shownSequence } = useLauncherPluginSurface()
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
