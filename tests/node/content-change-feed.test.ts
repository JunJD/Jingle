import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContents } from "electron"
import {
  assistantContentProjectionFingerprint,
  assistantContentProjectionChangedEventSchema,
  assistantContentPartsResultSchema,
  projectAssistantDiffLines,
  type AssistantContentPartsProjection
} from "../../src/shared/assistant-content-part"
import {
  contentAnnotationChangedEventSchema,
  type ContentAnnotation
} from "../../src/shared/content-annotation"
import { ContentAnnotationsController } from "../../src/main/content-annotations/controller"
import type { ContentAnnotationsService } from "../../src/main/content-annotations/service"
import { ContentCardsController } from "../../src/main/content-cards/controller"
import { assistantContentProjectionEvents } from "../../src/main/content-cards/events"
import type { ContentCardsService } from "../../src/main/content-cards/service"
import type { DiagnosticGraphSink } from "../../src/main/diagnostics/schema"
import { mergeContentAnnotationRecords } from "../../src/renderer/src/components/chat/ContentAnnotationsContext"
import { parseAssistantDiffSelectionRow } from "../../src/renderer/src/components/chat/AssistantSelectionOverlay"
import { shouldRepairContentAnnotationAnchor } from "../../src/renderer/src/components/chat/ContentCardFrame"
import {
  resolveCodeAnnotationAnchorCandidate,
  resolveDiffAnnotationAnchorCandidate
} from "../../src/renderer/src/lib/content-annotation-reveal"
import { projectionForAssistantContentSource } from "../../src/renderer/src/lib/assistant-content-projection-cache"
import {
  createCanonicalHydrationOwner,
  createContentWindowHydrationOwner
} from "../../src/renderer/src/lib/canonical-content-hydration"

class FakeIpcMain {
  readonly handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()

  handle(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void {
    this.handlers.set(channel, handler)
  }
}

class FakeWebContents extends EventEmitter {
  destroyed = false
  readonly mainFrame = {}
  readonly sent: Array<{ channel: string; payload: unknown }> = []

  constructor(readonly id: number) {
    super()
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload })
  }
}

class FakeWindow {
  destroyed = false

  constructor(
    readonly id: number,
    readonly webContents: FakeWebContents
  ) {}

  isDestroyed(): boolean {
    return this.destroyed
  }
}

class FakeFocusTarget {
  readonly listeners = new Set<() => void>()

  addEventListener(_type: "focus", listener: () => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: "focus", listener: () => void): void {
    this.listeners.delete(listener)
  }

  focus(): void {
    for (const listener of this.listeners) listener()
  }
}

const SHA_A = `sha256:${"a".repeat(64)}`
const SHA_B = `sha256:${"b".repeat(64)}`
const FINGERPRINT_A = `fnv1a64:${"a".repeat(16)}`
const FINGERPRINT_B = `fnv1a64:${"b".repeat(16)}`

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  assert.fail("Timed out waiting for asynchronous content synchronization")
}

function annotation(overrides: Partial<ContentAnnotation> = {}): ContentAnnotation {
  return {
    anchor: { kind: "whole-card" },
    anchorResolution: "resolved",
    body: "Review this",
    cardId: "message:message-1:narrative:part%3Apart-1",
    cardRevision: SHA_A,
    contextHash: "context-1",
    createdAt: "2026-07-17T00:00:00.000Z",
    deletedAt: null,
    id: "annotation-1",
    intent: "comment",
    lifecycle: "open",
    quote: "Answer",
    revision: 1,
    threadId: "thread-bound",
    updatedAt: "2026-07-17T00:00:00.000Z",
    ...overrides
  }
}

function senderIdentity(input: {
  launcher: FakeWebContents
  threads: ReadonlyMap<FakeWebContents, string>
}) {
  return {
    getDurableThreadId: (sender: WebContents) =>
      input.threads.get(sender as unknown as FakeWebContents) ?? null,
    isLauncher: (sender: WebContents) => sender === (input.launcher as unknown as WebContents)
  }
}

function windowFixture() {
  const launcher = new FakeWebContents(1)
  const matching = new FakeWebContents(2)
  const other = new FakeWebContents(3)
  const settings = new FakeWebContents(4)
  const windows = [launcher, matching, other, settings].map(
    (webContents, index) => new FakeWindow(index + 1, webContents)
  )
  return {
    identity: senderIdentity({
      launcher,
      threads: new Map([
        [matching, "thread-bound"],
        [other, "thread-other"]
      ])
    }),
    launcher,
    matching,
    other,
    settings,
    windows
  }
}

test("content change codecs reject unknown and malformed wire data", () => {
  assert.equal(
    assistantContentProjectionChangedEventSchema.safeParse({
      kind: "ready",
      messageId: "message-1",
      projectionFingerprint: FINGERPRINT_A,
      revision: SHA_A,
      threadId: "thread-bound"
    }).success,
    true
  )
  assert.equal(
    assistantContentProjectionChangedEventSchema.safeParse({
      kind: "ready",
      messageId: "message-1",
      projectionFingerprint: FINGERPRINT_A,
      revision: "bad",
      threadId: "thread-bound"
    }).success,
    false
  )
  assert.equal(
    assistantContentProjectionChangedEventSchema.safeParse({
      kind: "issue",
      revision: "job:2:3",
      runId: "run-1",
      status: "blocked",
      threadId: "thread-bound"
    }).success,
    true
  )
  assert.equal(
    assistantContentPartsResultSchema.safeParse({
      issue: {
        code: "source-invalid",
        detail: "Assistant content projection rejected noncanonical persisted content.",
        reason: "noncanonical"
      },
      status: "blocked"
    }).success,
    true
  )
  assert.equal(
    assistantContentPartsResultSchema.safeParse({
      issue: {
        code: "retryable-failure",
        detail: "Database unavailable.",
        message: "raw database error",
        reason: "persistence-unavailable"
      },
      status: "failed"
    }).success,
    false
  )
  assert.equal(
    assistantContentPartsResultSchema.safeParse({
      issue: {
        code: "retry-exhausted",
        detail: "Database unavailable.",
        reason: "persistence-unavailable"
      },
      status: "exhausted"
    }).success,
    true
  )
  assert.equal(
    assistantContentPartsResultSchema.safeParse({
      issue: {
        code: "terminal-failure",
        detail: "Projection failed unexpectedly.",
        reason: "unexpected"
      },
      status: "parked"
    }).success,
    true
  )
  assert.equal(
    assistantContentProjectionChangedEventSchema.safeParse({
      kind: "issue",
      revision: "job:2:3",
      runId: "run-1",
      status: "exhausted",
      threadId: "thread-bound"
    }).success,
    true
  )
  assert.equal(
    contentAnnotationChangedEventSchema.safeParse({
      annotation: annotation(),
      unexpected: true
    }).success,
    false
  )
})

test("content changes publish only to Launcher and windows bound to the same thread", () => {
  const cards = windowFixture()
  const cardController = new ContentCardsController(
    {} as ContentCardsService,
    cards.identity,
    () => cards.windows as unknown as BrowserWindow[]
  )
  cardController.register(new FakeIpcMain() as unknown as IpcMain)

  let annotationListener!: (value: ContentAnnotation) => void
  const annotationService = {
    onChanged: (listener: (value: ContentAnnotation) => void) => {
      annotationListener = listener
      return () => undefined
    }
  } as unknown as ContentAnnotationsService
  const annotationController = new ContentAnnotationsController(
    annotationService,
    cards.identity,
    () => cards.windows as unknown as BrowserWindow[]
  )
  annotationController.register(new FakeIpcMain() as unknown as IpcMain)

  const projectionEvent = {
    kind: "ready" as const,
    messageId: "message-1",
    projectionFingerprint: FINGERPRINT_A,
    revision: SHA_A,
    threadId: "thread-bound"
  }
  assistantContentProjectionEvents.publish(projectionEvent)
  assistantContentProjectionEvents.publish({
    kind: "issue",
    revision: "job:1:1",
    runId: "run-1",
    status: "failed",
    threadId: "thread-bound"
  })
  annotationListener(annotation())

  const expectedChannels = [
    "contentCards:changed",
    "contentCards:changed",
    "contentAnnotations:changed"
  ]
  assert.deepEqual(
    cards.launcher.sent.map((event) => event.channel),
    expectedChannels
  )
  assert.deepEqual(
    cards.matching.sent.map((event) => event.channel),
    expectedChannels
  )
  assert.deepEqual(cards.other.sent, [])
  assert.deepEqual(cards.settings.sent, [])
})

test("annotation change delivery failures are observable without changing the durable record", () => {
  const fixture = windowFixture()
  fixture.matching.send = () => {
    throw new Error("closed")
  }
  let annotationListener!: (value: ContentAnnotation) => void
  const diagnostics: Parameters<DiagnosticGraphSink["capture"]>[0][] = []
  const controller = new ContentAnnotationsController(
    {
      onChanged: (listener: (value: ContentAnnotation) => void) => {
        annotationListener = listener
        return () => undefined
      }
    } as unknown as ContentAnnotationsService,
    fixture.identity,
    () => fixture.windows as unknown as BrowserWindow[],
    {
      capture: (event) => {
        diagnostics.push(event)
        return { eventId: "event-1", sequence: 1, sessionId: "session-1" }
      }
    }
  )
  controller.register(new FakeIpcMain() as unknown as IpcMain)

  annotationListener(annotation())
  assert.equal(diagnostics[0]?.eventCode, "content_annotation.change_delivery_failed")
  assert.equal(fixture.launcher.sent.length, 1)
})

test("annotation snapshots merge by durable revision and retain newer tombstones", () => {
  const deleted = annotation({
    deletedAt: "2026-07-17T00:00:02.000Z",
    revision: 2,
    updatedAt: "2026-07-17T00:00:02.000Z"
  })
  const eventFirst = mergeContentAnnotationRecords([], [deleted])
  const staleListLater = mergeContentAnnotationRecords(eventFirst, [annotation()])
  assert.deepEqual(staleListLater, [deleted])

  const second = annotation({
    id: "annotation-2",
    revision: 1,
    updatedAt: "2026-07-17T00:00:01.000Z"
  })
  assert.deepEqual(
    mergeContentAnnotationRecords(staleListLater, [second]).map((record) => record.id),
    ["annotation-2", "annotation-1"]
  )
})

test("resolved annotation anchors migrate when the stable card revision changes", () => {
  const current = annotation({ anchorResolution: "resolved", cardRevision: SHA_A })
  assert.equal(
    shouldRepairContentAnnotationAnchor({
      annotation: current,
      cardRevision: SHA_A,
      resolution: "resolved"
    }),
    false
  )
  assert.equal(
    shouldRepairContentAnnotationAnchor({
      annotation: current,
      cardRevision: SHA_B,
      resolution: "resolved"
    }),
    true
  )
})

test("standard unified diff projection has one typed side and canonical line per row", () => {
  const patch = [
    "--- a/example.ts",
    "+++ b/example.ts",
    "@@ -1,2 +1,4 @@",
    " leading context",
    " context",
    "-const previous = 1",
    "+const inserted = 0",
    "+const target = 1",
    " tail"
  ].join("\n")

  assert.deepEqual(projectAssistantDiffLines(patch), [
    { lineNumber: 1, side: "after", text: "--- a/example.ts" },
    { lineNumber: 2, side: "after", text: "+++ b/example.ts" },
    { lineNumber: 3, side: "after", text: "@@ -1,2 +1,4 @@" },
    { lineNumber: 4, side: "after", text: " leading context" },
    { lineNumber: 5, side: "after", text: " context" },
    { lineNumber: 5, side: "before", text: "-const previous = 1" },
    { lineNumber: 6, side: "after", text: "+const inserted = 0" },
    { lineNumber: 7, side: "after", text: "+const target = 1" },
    { lineNumber: 8, side: "after", text: " tail" }
  ])
  assert.deepEqual(
    resolveDiffAnnotationAnchorCandidate({
      anchor: {
        endLine: 1,
        filePath: null,
        kind: "diff-range",
        patchRevision: SHA_A,
        side: "before",
        startLine: 1
      },
      cardRevision: SHA_B,
      quote: "-const previous = 1",
      source: patch
    }),
    {
      anchor: {
        endLine: 5,
        filePath: null,
        kind: "diff-range",
        patchRevision: SHA_B,
        side: "before",
        startLine: 5
      },
      status: "resolved"
    }
  )
  assert.deepEqual(
    resolveDiffAnnotationAnchorCandidate({
      anchor: {
        endLine: 1,
        filePath: null,
        kind: "diff-range",
        patchRevision: SHA_A,
        side: "after",
        startLine: 1
      },
      cardRevision: SHA_B,
      quote: "+const target = 1",
      source: patch
    }),
    {
      anchor: {
        endLine: 7,
        filePath: null,
        kind: "diff-range",
        patchRevision: SHA_B,
        side: "after",
        startLine: 7
      },
      status: "resolved"
    }
  )
  assert.deepEqual(
    resolveDiffAnnotationAnchorCandidate({
      anchor: {
        endLine: 1,
        filePath: null,
        kind: "diff-range",
        patchRevision: SHA_A,
        side: "before",
        startLine: 1
      },
      cardRevision: SHA_B,
      quote: "+const target = 1",
      source: patch
    }),
    { anchor: null, status: "orphaned" }
  )
})

test("diff selection rows fail closed without the complete typed dataset", () => {
  assert.deepEqual(
    parseAssistantDiffSelectionRow({
      diffLine: "5",
      diffSide: "before",
      diffText: "-const previous = 1"
    }),
    { lineNumber: 5, side: "before", text: "-const previous = 1" }
  )
  assert.deepEqual(
    parseAssistantDiffSelectionRow({
      diffLine: "7",
      diffSide: "after",
      diffText: "+const target = 1"
    }),
    { lineNumber: 7, side: "after", text: "+const target = 1" }
  )

  const legacyRow = { diffLine: undefined, line: "5", lineType: "deletion" }
  assert.equal(parseAssistantDiffSelectionRow(legacyRow), null)
  assert.equal(parseAssistantDiffSelectionRow({ diffLine: "7", diffText: "+target" }), null)
  assert.equal(
    parseAssistantDiffSelectionRow({
      diffLine: "7",
      diffSide: "unknown",
      diffText: "+target"
    }),
    null
  )
  assert.equal(parseAssistantDiffSelectionRow({ diffLine: "7", diffSide: "after" }), null)
})

test("code quote repair requires one unique current match", () => {
  const anchor = {
    blockId: "part:code-1",
    endColumn: 17,
    endLine: 1,
    kind: "code-range" as const,
    startColumn: 1,
    startLine: 1
  }
  assert.deepEqual(
    resolveCodeAnnotationAnchorCandidate({
      anchor,
      quote: "const target = 1",
      source: "const inserted = 0\nconst target = 1\nconst tail = 2"
    }),
    {
      anchor: { ...anchor, endLine: 2, startLine: 2 },
      status: "resolved"
    }
  )
  assert.deepEqual(
    resolveCodeAnnotationAnchorCandidate({
      anchor,
      quote: "target",
      source: "target\ntarget"
    }),
    { anchor: null, status: "ambiguous" }
  )
})

test("canonical hydration retries a transient rejection within the bounded owner", async () => {
  const scheduled: Array<() => void> = []
  const failures: Array<{ attempt: number; willRetry: boolean }> = []
  const hydrated: string[] = []
  let loadCount = 0
  const owner = createCanonicalHydrationOwner({
    load: async () => {
      loadCount += 1
      if (loadCount === 1) throw new Error("transient")
      return "ready"
    },
    onFailure: ({ attempt, willRetry }) => failures.push({ attempt, willRetry }),
    onSuccess: (value) => {
      hydrated.push(value)
    },
    retryDelaysMs: [25],
    scheduleRetry: (callback) => {
      scheduled.push(callback)
      return () => undefined
    }
  })

  owner.request({ resetFailures: true })
  await waitFor(() => scheduled.length === 1)
  assert.deepEqual(failures, [{ attempt: 1, willRetry: true }])
  scheduled.shift()!()
  await waitFor(() => hydrated.length === 1)
  assert.equal(loadCount, 2)
  assert.deepEqual(hydrated, ["ready"])
  owner.dispose()
})

test("focus resync reloads a canonical snapshot after an event was missed", async () => {
  const hydrated: string[] = []
  let canonical = "revision-1"
  const owner = createCanonicalHydrationOwner({
    load: async () => canonical,
    onFailure: () => assert.fail("canonical reload should not fail"),
    onSuccess: (value) => {
      hydrated.push(value)
    }
  })

  owner.request({ resetFailures: true })
  await waitFor(() => hydrated.length === 1)
  canonical = "revision-2"
  owner.request({ resetFailures: true })
  await waitFor(() => hydrated.length === 2)
  assert.deepEqual(hydrated, ["revision-1", "revision-2"])
  owner.dispose()
})

test("one window focus owner batches many cards and refreshes only missed fingerprints", async () => {
  const focusTarget = new FakeFocusTarget()
  const inspectionBatches: string[][] = []
  const refreshed: string[] = []
  let activeRefreshes = 0
  let maxActiveRefreshes = 0
  let snapshotRefreshes = 0
  const owner = createContentWindowHydrationOwner({
    batchSize: 20,
    inspectCards: async (messageIds) => {
      inspectionBatches.push(messageIds)
      return messageIds.map((messageId) => ({
        messageId,
        projectionFingerprint: FINGERPRINT_A,
        status: "ready" as const
      }))
    },
    onFailure: () => assert.fail("window focus resync should not fail"),
    refreshConcurrency: 2
  })
  owner.registerSnapshot("annotations", async () => {
    snapshotRefreshes += 1
  })
  for (let index = 0; index < 61; index += 1) {
    const messageId = `message-${String(index).padStart(3, "0")}`
    const registration = owner.registerCard({
      messageId,
      refresh: async () => {
        activeRefreshes += 1
        maxActiveRefreshes = Math.max(maxActiveRefreshes, activeRefreshes)
        await new Promise<void>((resolve) => setImmediate(resolve))
        refreshed.push(messageId)
        activeRefreshes -= 1
      }
    })
    registration.updateProjectionFingerprint(index < 6 ? FINGERPRINT_B : FINGERPRINT_A)
  }
  const stopFocus = owner.start(focusTarget)

  assert.equal(focusTarget.listeners.size, 1)
  focusTarget.focus()
  await waitFor(() => refreshed.length === 6)
  assert.deepEqual(
    inspectionBatches.map((batch) => batch.length),
    [20, 20, 20, 1]
  )
  assert.equal(snapshotRefreshes, 1)
  assert.equal(maxActiveRefreshes, 2)
  assert.deepEqual(
    refreshed.sort(),
    Array.from({ length: 6 }, (_, index) => `message-${String(index).padStart(3, "0")}`)
  )

  stopFocus()
  assert.equal(focusTarget.listeners.size, 0)
  owner.dispose()
})

test("one issue invalidation batches card inspection and ready changes refresh only their card", async () => {
  const inspectionBatches: string[][] = []
  const refreshed: string[] = []
  let snapshotRefreshes = 0
  const owner = createContentWindowHydrationOwner({
    inspectCards: async (messageIds) => {
      inspectionBatches.push(messageIds)
      return messageIds.map((messageId) => ({
        messageId,
        projectionFingerprint: FINGERPRINT_A,
        status: "ready" as const
      }))
    },
    onFailure: () => assert.fail("projection invalidation hydration should not fail")
  })
  owner.registerSnapshot("annotations", async () => {
    snapshotRefreshes += 1
  })
  for (const [messageId, fingerprint] of [
    ["message-a", FINGERPRINT_A],
    ["message-b", FINGERPRINT_B],
    ["message-c", FINGERPRINT_A]
  ] as const) {
    const registration = owner.registerCard({
      messageId,
      refresh: async () => {
        refreshed.push(messageId)
      }
    })
    registration.updateProjectionFingerprint(fingerprint)
  }

  await owner.handleProjectionChange({
    kind: "issue",
    revision: "job:1:1",
    runId: "run-1",
    status: "failed",
    threadId: "thread-bound"
  })
  assert.deepEqual(inspectionBatches, [["message-a", "message-b", "message-c"]])
  assert.deepEqual(refreshed, ["message-b"])
  assert.equal(snapshotRefreshes, 0)

  await owner.handleProjectionChange({
    kind: "ready",
    messageId: "message-c",
    projectionFingerprint: FINGERPRINT_B,
    revision: SHA_B,
    threadId: "thread-bound"
  })
  assert.deepEqual(inspectionBatches, [["message-a", "message-b", "message-c"]])
  assert.deepEqual(refreshed, ["message-b", "message-c"])
  assert.equal(snapshotRefreshes, 0)
  owner.dispose()
})

test("repeated issue invalidations coalesce while a batched inspection is active", async () => {
  let inspectCalls = 0
  let releaseFirstInspection!: () => void
  const firstInspection = new Promise<void>((resolve) => {
    releaseFirstInspection = resolve
  })
  const owner = createContentWindowHydrationOwner({
    inspectCards: async (messageIds) => {
      inspectCalls += 1
      if (inspectCalls === 1) await firstInspection
      return messageIds.map((messageId) => ({ messageId, status: "stale" as const }))
    },
    onFailure: () => assert.fail("projection invalidation hydration should not fail")
  })
  owner.registerCard({ messageId: "message-a", refresh: async () => undefined })
  const issue = {
    kind: "issue" as const,
    revision: "job:1:1",
    runId: "run-1",
    status: "failed" as const,
    threadId: "thread-bound"
  }

  const first = owner.handleProjectionChange(issue)
  await waitFor(() => inspectCalls === 1)
  const second = owner.handleProjectionChange({ ...issue, revision: "job:1:2" })
  const third = owner.handleProjectionChange({ ...issue, revision: "job:1:3" })
  releaseFirstInspection()
  await Promise.all([first, second, third])
  await waitFor(() => inspectCalls === 2)
  assert.equal(inspectCalls, 2)
  owner.dispose()
})

test("window attempt gate bounds concurrent card retries after refresh failures", async () => {
  const focusTarget = new FakeFocusTarget()
  const scheduledRetries: Array<() => void> = []
  const perCardAttempts = new Map<string, number>()
  const cardOwners: Array<ReturnType<typeof createCanonicalHydrationOwner>> = []
  let activeAttempts = 0
  let maxActiveAttempts = 0
  let successfulRetries = 0
  const windowOwner = createContentWindowHydrationOwner({
    inspectCards: async (messageIds) =>
      messageIds.map((messageId) => ({
        messageId,
        projectionFingerprint: FINGERPRINT_A,
        status: "ready" as const
      })),
    onFailure: () => assert.fail("window inspection should not fail"),
    refreshConcurrency: 2
  })

  for (let index = 0; index < 6; index += 1) {
    const messageId = `retry-message-${index}`
    const cardOwner = createCanonicalHydrationOwner({
      load: () =>
        windowOwner.runAttempt(async () => {
          activeAttempts += 1
          maxActiveAttempts = Math.max(maxActiveAttempts, activeAttempts)
          await new Promise<void>((resolve) => setImmediate(resolve))
          const attempt = (perCardAttempts.get(messageId) ?? 0) + 1
          perCardAttempts.set(messageId, attempt)
          activeAttempts -= 1
          if (attempt === 1) throw new Error("transient")
          return messageId
        }),
      onFailure: () => undefined,
      onSuccess: () => {
        successfulRetries += 1
      },
      retryDelaysMs: [25],
      scheduleRetry: (callback) => {
        scheduledRetries.push(callback)
        return () => undefined
      }
    })
    cardOwners.push(cardOwner)
    const registration = windowOwner.registerCard({
      messageId,
      refresh: () => cardOwner.request({ resetFailures: true })
    })
    registration.updateProjectionFingerprint(FINGERPRINT_B)
  }
  windowOwner.start(focusTarget)
  focusTarget.focus()
  await waitFor(() => scheduledRetries.length === 6)
  assert.equal(maxActiveAttempts, 2)

  for (const retry of scheduledRetries.splice(0)) retry()
  await waitFor(() => successfulRetries === 6)
  assert.equal(maxActiveAttempts, 2)
  assert.deepEqual([...perCardAttempts.values()], [2, 2, 2, 2, 2, 2])

  for (const owner of cardOwners) owner.dispose()
  windowOwner.dispose()
})

test("queued card and thread attempts are cancelled before their IPC callback runs", async () => {
  const createOwner = () =>
    createContentWindowHydrationOwner({
      inspectCards: async () => [],
      onFailure: () => assert.fail("focus hydration is not used by this gate test"),
      refreshConcurrency: 2
    })

  const cardOwner = createOwner()
  let releaseCardFirst!: () => void
  let releaseCardSecond!: () => void
  let startedCardAttempts = 0
  let queuedCardRuns = 0
  const cardFirst = cardOwner.runAttempt(
    () =>
      new Promise<void>((resolve) => {
        startedCardAttempts += 1
        releaseCardFirst = resolve
      })
  )
  const cardSecond = cardOwner.runAttempt(
    () =>
      new Promise<void>((resolve) => {
        startedCardAttempts += 1
        releaseCardSecond = resolve
      })
  )
  await waitFor(() => startedCardAttempts === 2)
  const cardAbort = new AbortController()
  const queuedCard = cardOwner.runAttempt(async () => {
    queuedCardRuns += 1
  }, cardAbort.signal)
  const queuedCardCancelled = assert.rejects(
    queuedCard,
    (error: Error) => error.name === "AbortError"
  )
  cardAbort.abort()
  await queuedCardCancelled
  releaseCardFirst()
  releaseCardSecond()
  await Promise.all([cardFirst, cardSecond])
  assert.equal(queuedCardRuns, 0)
  cardOwner.dispose()

  const threadOwner = createOwner()
  const threadFocusTarget = new FakeFocusTarget()
  const stopThreadOwner = threadOwner.start(threadFocusTarget)
  let releaseThreadFirst!: () => void
  let releaseThreadSecond!: () => void
  let startedThreadAttempts = 0
  let queuedThreadRuns = 0
  const threadFirst = threadOwner.runAttempt(
    () =>
      new Promise<void>((resolve) => {
        startedThreadAttempts += 1
        releaseThreadFirst = resolve
      })
  )
  const threadSecond = threadOwner.runAttempt(
    () =>
      new Promise<void>((resolve) => {
        startedThreadAttempts += 1
        releaseThreadSecond = resolve
      })
  )
  await waitFor(() => startedThreadAttempts === 2)
  const queuedThread = threadOwner.runAttempt(async () => {
    queuedThreadRuns += 1
  })
  const queuedThreadCancelled = assert.rejects(
    queuedThread,
    (error: Error) => error.name === "AbortError"
  )
  stopThreadOwner()
  await queuedThreadCancelled
  assert.equal(threadFocusTarget.listeners.size, 0)
  releaseThreadFirst()
  releaseThreadSecond()
  await Promise.all([threadFirst, threadSecond])
  assert.equal(queuedThreadRuns, 0)
})

test("assistant projection cache rejects another source, thread, revision text, and streaming state", () => {
  const projection: AssistantContentPartsProjection = {
    contentRevision: SHA_A,
    parts: [],
    schemaVersion: 1
  }
  const loaded = {
    messageId: "message-1",
    projection,
    sourceText: "Answer A",
    threadId: "thread-bound"
  }
  assert.equal(
    projectionForAssistantContentSource({
      isStreaming: false,
      loaded,
      messageId: "message-1",
      sourceText: "Answer A",
      threadId: "thread-bound"
    }),
    projection
  )
  for (const input of [
    { isStreaming: true, messageId: "message-1", sourceText: "Answer A", threadId: "thread-bound" },
    {
      isStreaming: false,
      messageId: "message-2",
      sourceText: "Answer A",
      threadId: "thread-bound"
    },
    {
      isStreaming: false,
      messageId: "message-1",
      sourceText: "Answer B",
      threadId: "thread-bound"
    },
    { isStreaming: false, messageId: "message-1", sourceText: "Answer A", threadId: "thread-other" }
  ]) {
    assert.equal(projectionForAssistantContentSource({ ...input, loaded }), null)
  }
  assert.notEqual(SHA_A, SHA_B)
  assert.notEqual(
    assistantContentProjectionFingerprint({
      ...projection,
      parts: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          kind: "narrative",
          revision: SHA_A
        }
      ]
    }),
    assistantContentProjectionFingerprint({
      ...projection,
      parts: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          kind: "narrative",
          revision: SHA_A
        }
      ]
    })
  )
})
