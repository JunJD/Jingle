import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from "react"
import type {
  ContentAnnotation,
  CreateContentAnnotationInput,
  UpdateContentAnnotationInput
} from "@shared/content-annotation"
import type { ContentSelectionDraft } from "@shared/content-selection"

interface RevealRegistration {
  reveal: (annotation: ContentAnnotation) => void
}

class CardAnnotationStore {
  private readonly listeners = new Map<string, Set<() => void>>()
  private snapshots = new Map<string, readonly ContentAnnotation[]>()

  getSnapshot = (cardId: string): readonly ContentAnnotation[] =>
    this.snapshots.get(cardId) ?? EMPTY_ANNOTATIONS

  replace(records: readonly ContentAnnotation[]): void {
    const next = new Map<string, ContentAnnotation[]>()
    for (const annotation of records) {
      if (annotation.deletedAt !== null) continue
      next.set(annotation.cardId, [...(next.get(annotation.cardId) ?? []), annotation])
    }
    const changed = new Set([...this.snapshots.keys(), ...next.keys()])
    for (const cardId of changed) {
      const previous = this.snapshots.get(cardId) ?? EMPTY_ANNOTATIONS
      const current = next.get(cardId) ?? EMPTY_ANNOTATIONS
      const equal =
        previous.length === current.length &&
        previous.every(
          (annotation, index) =>
            annotation.id === current[index]?.id && annotation.revision === current[index]?.revision
        )
      if (equal) {
        changed.delete(cardId)
        if (previous === EMPTY_ANNOTATIONS) next.delete(cardId)
        else next.set(cardId, previous as ContentAnnotation[])
      }
    }
    this.snapshots = next
    for (const cardId of changed) {
      for (const listener of this.listeners.get(cardId) ?? []) listener()
    }
  }

  subscribe = (cardId: string, listener: () => void): (() => void) => {
    const listeners = this.listeners.get(cardId) ?? new Set<() => void>()
    listeners.add(listener)
    this.listeners.set(cardId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.listeners.delete(cardId)
    }
  }
}

const EMPTY_ANNOTATIONS: readonly ContentAnnotation[] = []

interface ContentAnnotationsContextValue {
  cardStore: CardAnnotationStore
  create: (
    selection: ContentSelectionDraft,
    body: string,
    intent: "comment" | "suggestion"
  ) => Promise<void>
  remove: (annotation: ContentAnnotation) => Promise<void>
  reveal: (annotation: ContentAnnotation) => void
  registerReveal: (cardId: string, registration: RevealRegistration) => () => void
  threadId: string
  update: (input: UpdateContentAnnotationInput) => Promise<void>
}

const ContentAnnotationsContext = createContext<ContentAnnotationsContextValue | null>(null)
const ContentAnnotationRecordsContext = createContext<readonly ContentAnnotation[] | null>(null)
const ContentAnnotationsSidebarContext = createContext<{
  setOpen: (open: boolean) => void
  open: boolean
} | null>(null)

export function ContentAnnotationsProvider(props: {
  children: ReactNode
  mountCard?: (cardId: string) => Promise<void> | void
  threadId: string
}): React.JSX.Element {
  const { children, mountCard, threadId } = props
  const [annotations, setAnnotations] = useState<ContentAnnotation[]>([])
  const [cardStore] = useState(() => new CardAnnotationStore())
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const annotationsRef = useRef<ContentAnnotation[]>([])
  const revealersRef = useRef(new Map<string, RevealRegistration>())

  const commit = useCallback(
    (records: ContentAnnotation[]): void => {
      annotationsRef.current = records
      cardStore.replace(records)
      setAnnotations(records)
    },
    [cardStore]
  )

  useEffect(() => {
    let active = true
    void window.api.contentAnnotations.list(threadId).then((records) => {
      if (active) commit(records)
    })
    return () => {
      active = false
    }
  }, [commit, threadId])

  const replace = useCallback(
    (record: ContentAnnotation): void => {
      const current = annotationsRef.current
      const index = current.findIndex((entry) => entry.id === record.id)
      if (index < 0) {
        commit([...current, record])
        return
      }
      const next = [...current]
      next[index] = record
      commit(next)
    },
    [commit]
  )

  const create = useCallback(
    async (
      selection: ContentSelectionDraft,
      body: string,
      intent: "comment" | "suggestion"
    ): Promise<void> => {
      const input: CreateContentAnnotationInput = {
        body,
        id: crypto.randomUUID(),
        intent,
        selection
      }
      replace(await window.api.contentAnnotations.create(input))
      setSidebarOpen(true)
    },
    [replace]
  )

  const update = useCallback(
    async (input: UpdateContentAnnotationInput): Promise<void> => {
      replace(await window.api.contentAnnotations.update(input))
    },
    [replace]
  )

  const remove = useCallback(
    async (annotation: ContentAnnotation): Promise<void> => {
      replace(
        await window.api.contentAnnotations.delete({
          expectedRevision: annotation.revision,
          id: annotation.id
        })
      )
    },
    [replace]
  )

  const registerReveal = useCallback(
    (cardId: string, registration: RevealRegistration): (() => void) => {
      revealersRef.current.set(cardId, registration)
      return () => {
        if (revealersRef.current.get(cardId) === registration) revealersRef.current.delete(cardId)
      }
    },
    []
  )

  const reveal = useCallback(
    (annotation: ContentAnnotation): void => {
      const mounted = revealersRef.current.get(annotation.cardId)
      if (mounted) {
        mounted.reveal(annotation)
        return
      }
      void (async () => {
        await mountCard?.(annotation.cardId)
        let attempts = 0
        const revealWhenMounted = (): void => {
          const registration = revealersRef.current.get(annotation.cardId)
          if (registration) {
            registration.reveal(annotation)
            return
          }
          attempts += 1
          if (attempts < 60) requestAnimationFrame(revealWhenMounted)
        }
        requestAnimationFrame(revealWhenMounted)
      })()
    },
    [mountCard]
  )

  const value = useMemo<ContentAnnotationsContextValue>(
    () => ({ cardStore, create, registerReveal, remove, reveal, threadId, update }),
    [cardStore, create, registerReveal, remove, reveal, threadId, update]
  )
  const sidebarValue = useMemo(
    () => ({ open: sidebarOpen, setOpen: setSidebarOpen }),
    [sidebarOpen]
  )

  return (
    <ContentAnnotationsSidebarContext.Provider value={sidebarValue}>
      <ContentAnnotationRecordsContext.Provider value={annotations}>
        <ContentAnnotationsContext.Provider value={value}>
          {children}
        </ContentAnnotationsContext.Provider>
      </ContentAnnotationRecordsContext.Provider>
    </ContentAnnotationsSidebarContext.Provider>
  )
}

export function useCardAnnotations(cardId: string): readonly ContentAnnotation[] {
  const context = useContentAnnotations()
  return useSyncExternalStore(
    useCallback((listener) => context.cardStore.subscribe(cardId, listener), [cardId, context.cardStore]),
    useCallback(() => context.cardStore.getSnapshot(cardId), [cardId, context.cardStore]),
    () => EMPTY_ANNOTATIONS
  )
}

export function useContentAnnotationRecords(): readonly ContentAnnotation[] {
  const records = use(ContentAnnotationRecordsContext)
  if (!records) throw new Error("useContentAnnotationRecords requires ContentAnnotationsProvider")
  return records
}

export function useContentAnnotationsSidebar(): {
  open: boolean
  setOpen: (open: boolean) => void
} {
  const context = use(ContentAnnotationsSidebarContext)
  if (!context) throw new Error("useContentAnnotationsSidebar requires ContentAnnotationsProvider")
  return context
}

export function useContentAnnotations(): ContentAnnotationsContextValue {
  const context = use(ContentAnnotationsContext)
  if (!context) throw new Error("useContentAnnotations requires ContentAnnotationsProvider")
  return context
}
