import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  type ReactNode,
  type RefObject
} from "react"
import type { LauncherShellConfig } from "@shared/launcher"
import type { PermissionModeName } from "@shared/permission-mode"
import type { LauncherClipboardState } from "@launcher-shell/LauncherClipboardContext"
import type { LauncherInputStatus } from "@launcher-shell/launcher-input-status"
import type { LauncherInputElement } from "@launcher-shell/input-element"
import type { ComposerAreaHandle } from "@/composer-area"
import type { Thread } from "@/types"
import type {
  LauncherCommandInitialAction,
  LauncherCommandName,
  LauncherCommandNavigation
} from "@launcher-shell/pages/types"

export interface AiCoreSurface {
  inputRef: RefObject<LauncherInputElement | ComposerAreaHandle | null>
  inputStatus: LauncherInputStatus
  shellConfig: LauncherShellConfig
  setInputStatus: (status: LauncherInputStatus) => void
  shownSequence: number
  viewportHeight: number
}

export interface AiCoreThreadHandle {
  modelId: string
  threadId: string
  workspacePath: string
}

export interface AiCoreThreadCreateInput {
  draftInput?: string
  modelId?: string
  permissionMode?: PermissionModeName
  source: string
  title: string
  visibility: string
}

export interface AiCoreThreadSubmitInput {
  message: string
  threadId: string
}

export interface AiCoreHostValue {
  clipboard: Pick<LauncherClipboardState, "clearContext" | "context">
  commandName: LauncherCommandName
  initialAction: LauncherCommandInitialAction
  navigation: LauncherCommandNavigation
  seedQuery: string
  surface: AiCoreSurface
  threads: {
    activate: (threadId: string) => Promise<void>
    clone: (threadId: string) => Promise<AiCoreThreadHandle>
    cloneUntilMessage: (threadId: string, messageId: string) => Promise<AiCoreThreadHandle>
    create: (input: AiCoreThreadCreateInput) => Promise<AiCoreThreadHandle>
    getActiveThreadId: () => string | null
    list: () => Promise<Thread[]>
    submit: (input: AiCoreThreadSubmitInput) => Promise<void>
  }
}

interface AiCoreLifecycleHandlers {
  onEnter?: () => void
  onLauncherShown?: () => void
  onLeave?: () => void
}

const aiCoreHostContext = createContext<AiCoreHostValue | null>(null)

export function AiCoreHostProvider(props: {
  children: ReactNode
  value: AiCoreHostValue
}): React.JSX.Element {
  const { children, value } = props

  return <aiCoreHostContext.Provider value={value}>{children}</aiCoreHostContext.Provider>
}

export function useAiCoreHost(): AiCoreHostValue {
  const context = useContext(aiCoreHostContext)

  if (!context) {
    throw new Error("useAiCoreHost must be used within AiCoreHostProvider")
  }

  return context
}

export function useAiCoreClipboard(): AiCoreHostValue["clipboard"] {
  return useAiCoreHost().clipboard
}

export function useAiCoreNavigation(): AiCoreHostValue["navigation"] {
  return useAiCoreHost().navigation
}

export function useAiCoreSurface(): AiCoreSurface {
  return useAiCoreHost().surface
}

export function useAiCoreThreads(): AiCoreHostValue["threads"] {
  return useAiCoreHost().threads
}

export function useAiCoreLifecycle(handlers: AiCoreLifecycleHandlers): void {
  const { onEnter, onLauncherShown, onLeave } = handlers
  const { shownSequence } = useAiCoreSurface()
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
