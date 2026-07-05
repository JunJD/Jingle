import { useMemo, useRef, type ReactNode } from "react"
import {
  AssistantSelectionReferenceNavigationContext,
  type AssistantSelectionReferenceNavigationHandler,
  type AssistantSelectionReferenceNavigationStore
} from "./assistant-selection-reference-navigation-context"

export function AssistantSelectionReferenceNavigationProvider(props: {
  children: ReactNode
}): React.JSX.Element {
  const { children } = props
  const handlerRef = useRef<AssistantSelectionReferenceNavigationHandler | null>(null)
  const listenersRef = useRef(new Set<() => void>())

  const store = useMemo<AssistantSelectionReferenceNavigationStore>(() => {
    const emitChange = (): void => {
      for (const listener of listenersRef.current) {
        listener()
      }
    }

    return {
      getSnapshot: () => handlerRef.current,
      register: (handler) => {
        handlerRef.current = handler
        emitChange()

        return () => {
          if (handlerRef.current !== handler) {
            return
          }

          handlerRef.current = null
          emitChange()
        }
      },
      subscribe: (listener) => {
        listenersRef.current.add(listener)
        return () => {
          listenersRef.current.delete(listener)
        }
      }
    }
  }, [])

  return (
    <AssistantSelectionReferenceNavigationContext.Provider value={store}>
      {children}
    </AssistantSelectionReferenceNavigationContext.Provider>
  )
}
