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
import {
  createCanonicalHydrationOwner,
  reportCanonicalContentFailure
} from "@/lib/canonical-content-hydration"
import {
  ContentWindowHydrationProvider,
  useContentWindowHydration
} from "./ContentWindowHydrationContext"

interface RevealRegistration {
  reveal: (annotation: ContentAnnotation) => void
}

class CardAnnotationStore {
  private readonly listeners = new Map<string, Set<() => void>>()
  private snapshots = new Map<string, readonly ContentAnnotation[]>()

  constructor(readonly threadId: string) {}

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

export function mergeContentAnnotationRecords(
  current: readonly ContentAnnotation[],
  incoming: readonly ContentAnnotation[]
): readonly ContentAnnotation[] {
  const records = new Map(current.map((annotation) => [annotation.id, annotation]))
  let changed = false
  for (const annotation of incoming) {
    const previous = records.get(annotation.id)
    if (
      !previous ||
      annotation.revision > previous.revision ||
      (annotation.revision === previous.revision && annotation.updatedAt > previous.updatedAt)
    ) {
      records.set(annotation.id, annotation)
      changed = true
    }
  }
  if (!changed) return current
  return [...records.values()].sort(
    (left, right) =>
      left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id)
  )
}

interface ContentAnnotationsContextValue {
  cardStore: CardAnnotationStore
  create: (
    selection: ContentSelectionDraft,
    body: string,
    intent: "comment" | "suggestion"
  ) => Promise<boolean>
  remove: (annotation: ContentAnnotation) => Promise<boolean>
  reveal: (annotation: ContentAnnotation) => void
  registerReveal: (cardId: string, registration: RevealRegistration) => () => void
  threadId: string
  update: (input: UpdateContentAnnotationInput) => Promise<boolean>
}

const ContentAnnotationsContext = createContext<ContentAnnotationsContextValue | null>(null)
const ContentAnnotationRecordsContext = createContext<readonly ContentAnnotation[] | null>(null)
const ContentAnnotationsSidebarContext = createContext<{
  setOpen: (open: boolean) => void
  open: boolean
  syncError: boolean
} | null>(null)

export function ContentAnnotationsProvider(props: {
  children: ReactNode
  mountCard?: (cardId: string) => Promise<void> | void
  threadId: string
}): React.JSX.Element {
  return (
    <ContentWindowHydrationProvider threadId={props.threadId}>
      <ContentAnnotationsStateProvider {...props} />
    </ContentWindowHydrationProvider>
  )
}

function ContentAnnotationsStateProvider(props: {
  children: ReactNode
  mountCard?: (cardId: string) => Promise<void> | void
  threadId: string
}): React.JSX.Element {
  const { children, mountCard, threadId } = props
  const windowHydration = useContentWindowHydration()
  const [annotationSnapshot, setAnnotationSnapshot] = useState<{
    records: readonly ContentAnnotation[]
    threadId: string
  }>(() => ({ records: [], threadId }))
  const annotations =
    annotationSnapshot.threadId === threadId ? annotationSnapshot.records : EMPTY_ANNOTATIONS
  const cardStore = useMemo(() => new CardAnnotationStore(threadId), [threadId])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [syncIssue, setSyncIssue] = useState<{ threadId: string } | null>(null)
  const [mutationIssue, setMutationIssue] = useState<{ threadId: string } | null>(null)
  const syncError = syncIssue?.threadId === threadId || mutationIssue?.threadId === threadId
  const annotationsRef = useRef<{ records: readonly ContentAnnotation[]; threadId: string }>({
    records: [],
    threadId
  })
  const revealersRef = useRef(new Map<string, RevealRegistration>())

  const commit = useCallback(
    (records: readonly ContentAnnotation[]): void => {
      annotationsRef.current = { records, threadId }
      cardStore.replace(records)
      setAnnotationSnapshot({ records, threadId })
    },
    [cardStore, threadId]
  )

  const merge = useCallback(
    (records: readonly ContentAnnotation[]): void => {
      const current =
        annotationsRef.current.threadId === threadId ? annotationsRef.current.records : []
      const next = mergeContentAnnotationRecords(current, records)
      if (next !== current) commit(next)
    },
    [commit, threadId]
  )

  useEffect(() => {
    const attemptController = new AbortController()
    const hydration = createCanonicalHydrationOwner({
      load: () =>
        windowHydration.runAttempt(
          () => window.api.contentAnnotations.list(threadId),
          attemptController.signal
        ),
      onFailure: ({ attempt }) => {
        setSyncIssue({ threadId })
        if (attempt === 1) {
          reportCanonicalContentFailure({
            operation: "hydrate-content-annotations",
            summary: "Content annotation hydration failed"
          })
        }
      },
      onSuccess: (records) => {
        merge(records)
        setSyncIssue((current) => (current?.threadId === threadId ? null : current))
      }
    })
    const requestHydration = (): void => {
      void hydration.request({ resetFailures: true })
    }
    const unsubscribe = window.api.contentAnnotations.onChanged(({ annotation }) => {
      if (annotation.threadId === threadId) merge([annotation])
    })
    const stopSnapshotResync = windowHydration.registerSnapshot("content-annotations", () =>
      hydration.request({ resetFailures: true })
    )
    requestHydration()
    return () => {
      attemptController.abort()
      stopSnapshotResync()
      unsubscribe()
      hydration.dispose()
    }
  }, [merge, threadId, windowHydration])

  const replace = useCallback(
    (record: ContentAnnotation): void => {
      merge([record])
    },
    [merge]
  )

  const create = useCallback(
    async (
      selection: ContentSelectionDraft,
      body: string,
      intent: "comment" | "suggestion"
    ): Promise<boolean> => {
      const input: CreateContentAnnotationInput = {
        body,
        id: crypto.randomUUID(),
        intent,
        selection
      }
      try {
        replace(await window.api.contentAnnotations.create(input))
        setMutationIssue((current) => (current?.threadId === threadId ? null : current))
        setSidebarOpen(true)
        return true
      } catch {
        setMutationIssue({ threadId })
        reportCanonicalContentFailure({
          operation: "create-content-annotation",
          summary: "Content annotation creation failed"
        })
        return false
      }
    },
    [replace, threadId]
  )

  const update = useCallback(
    async (input: UpdateContentAnnotationInput): Promise<boolean> => {
      try {
        replace(await window.api.contentAnnotations.update(input))
        setMutationIssue((current) => (current?.threadId === threadId ? null : current))
        return true
      } catch {
        setMutationIssue({ threadId })
        reportCanonicalContentFailure({
          operation: "update-content-annotation",
          summary: "Content annotation update failed"
        })
        return false
      }
    },
    [replace, threadId]
  )

  const remove = useCallback(
    async (annotation: ContentAnnotation): Promise<boolean> => {
      try {
        replace(
          await window.api.contentAnnotations.delete({
            expectedRevision: annotation.revision,
            id: annotation.id
          })
        )
        setMutationIssue((current) => (current?.threadId === threadId ? null : current))
        return true
      } catch {
        setMutationIssue({ threadId })
        reportCanonicalContentFailure({
          operation: "delete-content-annotation",
          summary: "Content annotation deletion failed"
        })
        return false
      }
    },
    [replace, threadId]
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
    () => ({ open: sidebarOpen, setOpen: setSidebarOpen, syncError }),
    [sidebarOpen, syncError]
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
    useCallback(
      (listener) => context.cardStore.subscribe(cardId, listener),
      [cardId, context.cardStore]
    ),
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
  syncError: boolean
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
