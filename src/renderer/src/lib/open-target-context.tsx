import { createContext, use, useEffect, useMemo, useState, type ReactNode } from "react"
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

interface OpenTargetSelection {
  folderPath: string
  targetId: string | null
}

export function resolveOpenTargetSelection(input: {
  folderPath: string | null
  selection: OpenTargetSelection | null
  targets: readonly OpenTarget[]
}): OpenTarget | null {
  const selectedTargetId =
    input.selection?.folderPath === input.folderPath ? input.selection.targetId : null
  return getPrimaryTarget(input.targets, selectedTargetId)
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
  const [selection, setSelection] = useState<OpenTargetSelection | null>(null)
  const [targetState, setTargetState] = useState<{
    folderPath: string
    targets: OpenTarget[]
  } | null>(null)
  const targets = targetState?.folderPath === folderPath ? targetState.targets : EMPTY_TARGETS
  const primaryTarget = useMemo(
    () => resolveOpenTargetSelection({ folderPath, selection, targets }),
    [folderPath, selection, targets]
  )
  const selectedTargetId = primaryTarget?.id ?? null

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
        setSelection((currentSelection) => ({
          folderPath,
          targetId:
            resolveOpenTargetSelection({
              folderPath,
              selection: currentSelection,
              targets: response.targets
            })?.id ?? null
        }))
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
        if (!folderPath || !primaryTarget) {
          return
        }

        void window.api.openTargets.open({ filePath, folderPath, targetId: primaryTarget.id })
      },
      openTarget(targetId, filePath) {
        if (!folderPath || !targets.some((target) => target.id === targetId)) {
          return
        }

        void window.api.openTargets.open({ filePath, folderPath, targetId })
      },
      primaryTarget,
      selectedTargetId,
      setSelectedTargetId(targetId) {
        if (!folderPath || !targets.some((target) => target.id === targetId)) {
          return
        }
        setSelection({ folderPath, targetId })
      },
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
