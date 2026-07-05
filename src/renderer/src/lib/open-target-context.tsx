import { createContext, use, useMemo, useState, type ReactNode } from "react"

interface OpenTargetContextValue {
  folderPath: string | null
  openFile: (filePath: string) => void
  openTarget: (targetId: string, filePath?: string) => void
  selectedTargetId: string | null
  setSelectedTargetId: (targetId: string) => void
}

const OpenTargetContext = createContext<OpenTargetContextValue | null>(null)

export function OpenTargetProvider(props: {
  children: ReactNode
  folderPath: string | null
}): React.JSX.Element {
  const { children, folderPath } = props
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)
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
      selectedTargetId,
      setSelectedTargetId
    }),
    [folderPath, selectedTargetId]
  )

  return <OpenTargetContext.Provider value={value}>{children}</OpenTargetContext.Provider>
}

export function useOpenTargetContext(): OpenTargetContextValue | null {
  return use(OpenTargetContext)
}
