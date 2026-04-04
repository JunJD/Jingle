import { createContext, useContext, type ReactNode } from "react"

export interface NativeExtensionViewStackValue {
  canPop: boolean
  pop: () => void
  push: (view: ReactNode) => void
  render: (rootView: ReactNode) => ReactNode
}

export const nativeExtensionViewStackContext = createContext<NativeExtensionViewStackValue | null>(
  null
)

export function useNativeExtensionViewStack(): NativeExtensionViewStackValue | null {
  return useContext(nativeExtensionViewStackContext)
}
