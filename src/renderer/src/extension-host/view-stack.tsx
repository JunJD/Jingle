import { useCallback, useMemo, useState, type ReactNode } from "react"
import {
  nativeExtensionViewStackContext,
  type NativeExtensionViewStackValue
} from "./view-stack-context"

export function NativeExtensionViewStackProvider(props: {
  children: ReactNode
}): React.JSX.Element {
  const { children } = props
  const [stack, setStack] = useState<ReactNode[]>([])

  const push = useCallback((view: ReactNode): void => {
    setStack((current) => [...current, view])
  }, [])

  const pop = useCallback((): void => {
    setStack((current) => current.slice(0, -1))
  }, [])

  const value = useMemo<NativeExtensionViewStackValue>(
    () => ({
      canPop: stack.length > 0,
      pop,
      push,
      render: (rootView: ReactNode) => stack[stack.length - 1] ?? rootView
    }),
    [pop, push, stack]
  )

  return (
    <nativeExtensionViewStackContext.Provider value={value}>
      {children}
    </nativeExtensionViewStackContext.Provider>
  )
}
