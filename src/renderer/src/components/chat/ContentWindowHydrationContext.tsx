import { createContext, use, useEffect, useMemo, type ReactNode } from "react"
import {
  createContentWindowHydrationOwner,
  reportCanonicalContentFailure,
  type ContentWindowHydrationOwner
} from "@/lib/canonical-content-hydration"

const ContentWindowHydrationContext = createContext<ContentWindowHydrationOwner | null>(null)

export function ContentWindowHydrationProvider(props: {
  children: ReactNode
  threadId: string
}): React.JSX.Element {
  const { children, threadId } = props
  const hydration = useMemo(
    () =>
      createContentWindowHydrationOwner({
        inspectCards: (messageIds) =>
          window.api.contentCards.inspectAssistantParts({ messageIds, threadId }),
        onFailure: ({ attempt }) => {
          if (attempt === 1) {
            reportCanonicalContentFailure({
              operation: "resync-content-window",
              summary: "Content window resynchronization failed"
            })
          }
        }
      }),
    [threadId]
  )

  useEffect(() => hydration.start(window), [hydration])

  return (
    <ContentWindowHydrationContext.Provider value={hydration}>
      {children}
    </ContentWindowHydrationContext.Provider>
  )
}

export function useContentWindowHydration(): ContentWindowHydrationOwner {
  const hydration = use(ContentWindowHydrationContext)
  if (!hydration) {
    throw new Error("useContentWindowHydration requires ContentWindowHydrationProvider")
  }
  return hydration
}
