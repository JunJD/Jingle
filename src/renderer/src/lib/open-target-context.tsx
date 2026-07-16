import {
  createContext,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react"
import type { OpenTarget } from "@shared/open-targets"

const EMPTY_TARGETS: OpenTarget[] = []

function getPrimaryTarget(
  targets: readonly OpenTarget[],
  selectedTargetId: string | null
): OpenTarget | null {
  const selectedTarget = targets.find((target) => target.id === selectedTargetId)
  if (selectedTarget) {
    return selectedTarget
  }

  return (
    targets.find((target) => target.kind === "application") ??
    targets.find((target) => target.kind === "file-manager") ??
    targets[0] ??
    null
  )
}

export interface OpenTargetContextValue {
  folderPath: string | null
  openFile: (filePath: string) => void
  openTarget: (targetId: string, filePath?: string) => void
  primaryTarget: OpenTarget | null
  selectedTargetId: string | null
  setSelectedTargetId: (targetId: string) => void
  targets: readonly OpenTarget[]
}

const OpenTargetContext = createContext<OpenTargetContextValue | null>(null)

export function OpenTargetProvider(props: {
  children: ReactNode
  folderPath: string | null
}): React.JSX.Element {
  const { children, folderPath } = props
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)
  const selectedTargetIdRef = useRef<string | null>(selectedTargetId)
  const [targetState, setTargetState] = useState<{
    folderPath: string
    targets: OpenTarget[]
  } | null>(null)
  const targets = targetState?.folderPath === folderPath ? targetState.targets : EMPTY_TARGETS
  const primaryTarget = useMemo(
    () => getPrimaryTarget(targets, selectedTargetId),
    [selectedTargetId, targets]
  )

  useEffect(() => {
    selectedTargetIdRef.current = selectedTargetId
  }, [selectedTargetId])

  useEffect(() => {
    if (!folderPath) {
      return
    }

    let active = true

    void window.api.openTargets
      .list({ folderPath })
      .then((response) => {
        if (!active) {
          return
        }

        setTargetState({ folderPath, targets: response.targets })
        const currentTargetId = selectedTargetIdRef.current
        const hasCurrentTarget =
          currentTargetId !== null &&
          response.targets.some((target) => target.id === currentTargetId)
        if (!hasCurrentTarget) {
          const nextPrimaryTarget = getPrimaryTarget(response.targets, null)
          if (nextPrimaryTarget) {
            setSelectedTargetId(nextPrimaryTarget.id)
          }
        }
      })
      .catch((error: unknown) => {
        console.error("[OpenTargetProvider] Failed to list open targets.", error)
      })

    return () => {
      active = false
    }
  }, [folderPath])

  const value = useMemo<OpenTargetContextValue>(
    () => ({
      folderPath,
      openFile(filePath) {
        if (!folderPath || !selectedTargetId) {
          return
        }

        void window.api.openTargets.open({ filePath, folderPath, targetId: selectedTargetId })
      },
      openTarget(targetId, filePath) {
        if (!folderPath) {
          return
        }

        void window.api.openTargets.open({ filePath, folderPath, targetId })
      },
      primaryTarget,
      selectedTargetId,
      setSelectedTargetId,
      targets
    }),
    [folderPath, primaryTarget, selectedTargetId, targets]
  )

  return <OpenTargetContext.Provider value={value}>{children}</OpenTargetContext.Provider>
}

export function useOpenTargetContext(): OpenTargetContextValue | null {
  return use(OpenTargetContext)
}

export function useRequiredOpenTargetContext(): OpenTargetContextValue {
  const context = useOpenTargetContext()
  if (!context) {
    throw new Error("An open-target surface must be rendered inside OpenTargetProvider.")
  }

  return context
}
