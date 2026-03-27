import { createContext, useContext, useEffect, useEffectEvent, useRef, type RefObject } from "react"
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

export interface LauncherPluginHostValue {
  clipboard: Pick<LauncherClipboardState, "clearContext" | "context">
  entryId: LauncherPluginEntryId
  initialAction: LauncherPluginEntryInitialAction
  navigation: {
    goHome: () => void
    hideLauncher: () => Promise<void>
    openEntry: (address: LauncherPluginEntryAddress, options?: LauncherPluginOpenOptions) => void
  }
  pluginId: LauncherPluginId
  seedQuery: string
  surface: LauncherPluginSurface
  threads: {
    create: (input: LauncherPluginThreadCreateInput) => Promise<LauncherPluginThreadHandle>
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

export function useLauncherPluginLifecycle(handlers: LauncherPluginLifecycleHandlers): void {
  const { onEnter, onLauncherShown, onLeave } = handlers
  const {
    surface: { shownSequence }
  } = useLauncherPluginHost()
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
