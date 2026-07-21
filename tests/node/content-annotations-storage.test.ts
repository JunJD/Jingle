import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { after, before } from "node:test"
import { closeDatabase, createRun, createThread, initializeDatabase } from "../../src/main/db"
import { ContentAnnotationsService } from "../../src/main/content-annotations/service"
import { getPrismaClient } from "../../src/main/db/client"
import {
  finalizeAssistantContentPartsForRun,
  readAssistantContentPartsProjection
} from "../../src/main/db/assistant-content-parts"
import {
  persistMessageStateVersion,
  type PreparedMessageStateItem
} from "../../src/main/db/message-state"
import { createContentCardId, type ContentCardIdentity } from "../../src/shared/content-card"
import {
  resolveCodeAnnotationAnchorCandidate,
  resolveDiffAnnotationAnchorCandidate
} from "../../src/renderer/src/lib/content-annotation-reveal"

const originalJingleHome = process.env.JINGLE_HOME
let jingleHome = ""
let durableCard: ContentCardIdentity
let canonicalMessageVersion = 0
const canonicalMessages = new Map<string, PreparedMessageStateItem>()

async function persistCanonicalAssistantMessage(input: {
  content: string
  messageId: string
  runId: string
}): Promise<void> {
  canonicalMessageVersion += 1
  const previous = canonicalMessages.get(input.messageId)
  canonicalMessages.set(input.messageId, {
    content: JSON.stringify(input.content),
    kind: "message",
    messageId: input.messageId,
    metadata: null,
    name: null,
    order: previous?.order ?? canonicalMessages.size + 1,
    rawHash: `content-annotation:${canonicalMessageVersion}:${input.messageId}`,
    rawMessageEncoding: "text",
    rawMessageType: "json",
    rawMessageValue: JSON.stringify({ content: input.content }),
    role: "assistant",
    toolCallId: null,
    toolCalls: null
  })
  await persistMessageStateVersion({
    checkpointId: `checkpoint-content-annotation-${canonicalMessageVersion}`,
    checkpointNs: "",
    messages: [...canonicalMessages.values()].sort((left, right) => left.order - right.order),
    runId: input.runId,
    threadId: "thread-annotations",
    version: `content-annotation-${canonicalMessageVersion}`
  })
}

before(async () => {
  jingleHome = await mkdtemp(join(tmpdir(), "jingle-content-annotations-"))
  process.env.JINGLE_HOME = jingleHome
  execFileSync("node", ["scripts/run-prisma-jingle-db.mjs", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, JINGLE_HOME: jingleHome }
  })
  await initializeDatabase()
  await createThread("thread-annotations", { title: "Annotations" })
  await createRun("run-annotations", "thread-annotations", { status: "success" })
  await persistCanonicalAssistantMessage({
    content: "Summary",
    messageId: "message-1",
    runId: "run-annotations"
  })
  await finalizeAssistantContentPartsForRun({
    runId: "run-annotations",
    threadId: "thread-annotations"
  })
  const projection = await readAssistantContentPartsProjection({
    messageId: "message-1",
    threadId: "thread-annotations"
  })
  assert.ok(projection)
  const part = projection.parts[0]!
  const identitySource = {
    kind: part.kind,
    slot: `part:${part.id}`,
    sourceId: "message-1",
    sourceType: "message" as const
  }
  durableCard = {
    ...identitySource,
    cardId: createContentCardId(identitySource),
    revision: part.revision,
    threadId: "thread-annotations"
  }
})

after(async () => {
  await closeDatabase()
  if (originalJingleHome === undefined) delete process.env.JINGLE_HOME
  else process.env.JINGLE_HOME = originalJingleHome
  await rm(jingleHome, { force: true, recursive: true })
})

test("annotation storage enforces revision and retains a tombstone", async () => {
  const service = new ContentAnnotationsService()
  const changedRevisions: number[] = []
  const stopChanges = service.onChanged((annotation) => {
    changedRevisions.push(annotation.revision)
  })
  const created = await service.create({
    body: "Clarify this.",
    id: "annotation-1",
    intent: "comment",
    selection: {
      anchor: { blockId: durableCard.slot, end: 7, kind: "text-range", start: 0 },
      anchorResolution: "resolved",
      card: durableCard,
      contextHash: "sha256:context",
      quote: "Summary"
    }
  })
  assert.equal(created.revision, 1)
  assert.match(created.createdAt, /^2026-|^20\d\d-/)

  const updated = await service.update({
    body: "Clarify this now.",
    expectedRevision: 1,
    id: created.id,
    lifecycle: "resolved"
  })
  assert.equal(updated.revision, 2)
  assert.equal(updated.lifecycle, "resolved")
  await assert.rejects(
    service.update({ body: "stale", expectedRevision: 1, id: created.id }),
    (error: Error & { code?: string }) => error.code === "CONFLICT"
  )
  await assert.rejects(
    service.update({
      expectedRevision: 2,
      id: created.id,
      repair: {
        anchor: created.anchor,
        anchorResolution: "resolved",
        cardRevision: "sha256:missing",
        contextHash: created.contextHash,
        expected: {
          cardRevision: created.cardRevision,
          contextHash: created.contextHash
        },
        quote: created.quote
      }
    }),
    (error: Error & { code?: string }) => error.code === "FAILED_PRECONDITION"
  )

  const deleted = await service.delete({ expectedRevision: 2, id: created.id })
  assert.equal(deleted.revision, 3)
  assert.notEqual(deleted.deletedAt, null)
  assert.equal((await service.list("thread-annotations")).length, 1)
  stopChanges()
  assert.deepEqual(changedRevisions, [1, 2, 3])
})

test("annotation validation follows canonical role when the derived message disagrees", async () => {
  const prisma = getPrismaClient()
  await prisma.message.update({
    data: { role: "user" },
    where: { threadId_messageId: { messageId: "message-1", threadId: "thread-annotations" } }
  })
  const service = new ContentAnnotationsService()
  const created = await service.create({
    body: "Trust the canonical assistant fact.",
    id: "annotation-canonical-assistant",
    intent: "comment",
    selection: {
      anchor: { kind: "whole-card" },
      anchorResolution: "resolved",
      card: durableCard,
      contextHash: "sha256:canonical-assistant",
      quote: "Summary"
    }
  })
  assert.equal(created.anchorResolution, "resolved")

  const runId = "run-annotation-canonical-user"
  const messageId = "message-annotation-canonical-user"
  await createRun(runId, "thread-annotations", { status: "success" })
  await persistCanonicalAssistantMessage({ content: "Derived assistant only", messageId, runId })
  await finalizeAssistantContentPartsForRun({ runId, threadId: "thread-annotations" })
  const projection = await readAssistantContentPartsProjection({
    messageId,
    threadId: "thread-annotations"
  })
  assert.ok(projection)
  const part = projection.parts[0]!
  const event = await prisma.messageEvent.findFirstOrThrow({
    orderBy: { seq: "desc" },
    where: { messageId, threadId: "thread-annotations", type: "message.upsert" }
  })
  const payload = JSON.parse(event.payload) as Record<string, unknown>
  payload.role = "user"
  await prisma.messageEvent.update({
    data: { payload: JSON.stringify(payload) },
    where: { eventId: event.eventId }
  })
  assert.equal(
    (
      await prisma.message.findUniqueOrThrow({
        select: { role: true },
        where: { threadId_messageId: { messageId, threadId: "thread-annotations" } }
      })
    ).role,
    "assistant"
  )
  const identitySource = {
    kind: part.kind,
    slot: `part:${part.id}`,
    sourceId: messageId,
    sourceType: "message" as const
  }
  await assert.rejects(
    service.create({
      body: "Reject the derived assistant fact.",
      id: "annotation-canonical-user",
      intent: "comment",
      selection: {
        anchor: { kind: "whole-card" },
        anchorResolution: "resolved",
        card: {
          ...identitySource,
          cardId: createContentCardId(identitySource),
          revision: part.revision,
          threadId: "thread-annotations"
        },
        contextHash: "sha256:canonical-user",
        quote: "Derived assistant only"
      }
    }),
    (error: Error & { code?: string }) => error.code === "FAILED_PRECONDITION"
  )
})

test("pending stream selections cannot become durable annotations", async () => {
  const service = new ContentAnnotationsService()
  await assert.rejects(
    service.create({
      body: "Not stable yet.",
      id: "annotation-pending",
      intent: "comment",
      selection: {
        anchor: { kind: "whole-card" },
        anchorResolution: "pending-stream",
        card: {
          cardId: "message:message-2:narrative:narrative%3Afinal",
          kind: "narrative",
          revision: "message-revision-streaming",
          slot: "narrative:final",
          sourceId: "message-2",
          sourceType: "message",
          threadId: "thread-annotations"
        },
        contextHash: "sha256:pending",
        quote: "pending"
      }
    }),
    (error: Error & { code?: string }) => error.code === "FAILED_PRECONDITION"
  )
})

test("V1 rejects non-assistant content-card annotations", async () => {
  const service = new ContentAnnotationsService()
  await assert.rejects(
    service.create({
      body: "Not in the V1 durable scope.",
      id: "annotation-artifact",
      intent: "comment",
      selection: {
        anchor: { kind: "whole-card" },
        anchorResolution: "resolved",
        card: {
          cardId: "artifact:artifact-1:artifact:artifact%3Acontent",
          kind: "artifact",
          revision: "artifact-revision",
          slot: "artifact:content",
          sourceId: "artifact-1",
          sourceType: "artifact",
          threadId: "thread-annotations"
        },
        contextHash: "sha256:artifact",
        quote: "Artifact"
      }
    }),
    (error: Error & { code?: string }) => error.code === "FAILED_PRECONDITION"
  )
})

test("orphaned annotation anchors can reconcile against the same durable card identity", async () => {
  const service = new ContentAnnotationsService()
  const created = await service.create({
    body: "Keep this anchor.",
    id: "annotation-orphan-repair",
    intent: "comment",
    selection: {
      anchor: { blockId: durableCard.slot, end: 7, kind: "text-range", start: 0 },
      anchorResolution: "resolved",
      card: durableCard,
      contextHash: "sha256:orphan-repair",
      quote: "Summary"
    }
  })
  const orphaned = await service.update({
    expectedRevision: created.revision,
    id: created.id,
    repair: {
      anchor: created.anchor,
      anchorResolution: "orphaned",
      cardRevision: created.cardRevision,
      contextHash: created.contextHash,
      expected: {
        cardRevision: created.cardRevision,
        contextHash: created.contextHash
      },
      quote: created.quote
    }
  })
  assert.equal(orphaned.anchorResolution, "orphaned")

  const reconciled = await service.update({
    expectedRevision: orphaned.revision,
    id: orphaned.id,
    repair: {
      anchor: orphaned.anchor,
      anchorResolution: "resolved",
      cardRevision: orphaned.cardRevision,
      contextHash: orphaned.contextHash,
      expected: {
        cardRevision: orphaned.cardRevision,
        contextHash: orphaned.contextHash
      },
      quote: orphaned.quote
    }
  })
  assert.equal(reconciled.anchorResolution, "resolved")
  assert.equal(reconciled.cardId, created.cardId)
})

test("changed-revision orphan repair CASes the old anchor facts and writes the new card revision", async () => {
  const runId = "run-annotation-changed-revision"
  const messageId = "message-annotation-changed-revision"
  await createRun(runId, "thread-annotations", { status: "success" })
  await persistCanonicalAssistantMessage({ content: "Before quote", messageId, runId })
  await finalizeAssistantContentPartsForRun({ runId, threadId: "thread-annotations" })
  const initialProjection = await readAssistantContentPartsProjection({
    messageId,
    threadId: "thread-annotations"
  })
  assert.ok(initialProjection)
  const initialPart = initialProjection.parts[0]!
  const identitySource = {
    kind: initialPart.kind,
    slot: `part:${initialPart.id}`,
    sourceId: messageId,
    sourceType: "message" as const
  }
  const card: ContentCardIdentity = {
    ...identitySource,
    cardId: createContentCardId(identitySource),
    revision: initialPart.revision,
    threadId: "thread-annotations"
  }
  const service = new ContentAnnotationsService()
  const created = await service.create({
    body: "Track this quote.",
    id: "annotation-changed-revision",
    intent: "comment",
    selection: {
      anchor: { blockId: card.slot, end: 6, kind: "text-range", start: 0 },
      anchorResolution: "resolved",
      card,
      contextHash: "context-before",
      quote: "Before"
    }
  })

  await persistCanonicalAssistantMessage({ content: "After only", messageId, runId })
  await finalizeAssistantContentPartsForRun({ runId, threadId: "thread-annotations" })
  const refreshedProjection = await readAssistantContentPartsProjection({
    messageId,
    threadId: "thread-annotations"
  })
  assert.ok(refreshedProjection)
  const refreshedPart = refreshedProjection.parts[0]!
  assert.equal(refreshedPart.id, initialPart.id)
  assert.notEqual(refreshedPart.revision, initialPart.revision)

  const orphaned = await service.update({
    expectedRevision: created.revision,
    id: created.id,
    repair: {
      anchor: created.anchor,
      anchorResolution: "orphaned",
      cardRevision: refreshedPart.revision,
      contextHash: `revision:${refreshedPart.revision}`,
      expected: {
        cardRevision: created.cardRevision,
        contextHash: created.contextHash
      },
      quote: created.quote
    }
  })
  assert.equal(orphaned.anchorResolution, "orphaned")
  assert.equal(orphaned.cardRevision, refreshedPart.revision)
  assert.equal(orphaned.contextHash, `revision:${refreshedPart.revision}`)
  await assert.rejects(
    service.update({
      expectedRevision: created.revision,
      id: created.id,
      repair: {
        anchor: created.anchor,
        anchorResolution: "orphaned",
        cardRevision: refreshedPart.revision,
        contextHash: `revision:${refreshedPart.revision}`,
        expected: {
          cardRevision: created.cardRevision,
          contextHash: created.contextHash
        },
        quote: created.quote
      }
    }),
    (error: Error & { code?: string }) => error.code === "CONFLICT"
  )
})

test("unverified quote positions are persisted as ambiguous, never resolved", async () => {
  const service = new ContentAnnotationsService()
  const annotation = await service.create({
    body: "Needs resolver review.",
    id: "annotation-ambiguous",
    intent: "comment",
    selection: {
      anchor: { blockId: durableCard.slot, end: 7, kind: "text-range", start: 0 },
      anchorResolution: "resolved",
      card: durableCard,
      contextHash: "sha256:ambiguous",
      quote: "Fakery!"
    }
  })
  assert.equal(annotation.anchorResolution, "ambiguous")
})

test("shifted code quote repair persists the canonical current range", async () => {
  const service = new ContentAnnotationsService()
  const runId = "run-annotation-code-reanchor"
  const messageId = "message-annotation-code-reanchor"
  const quote = "const target = 1"
  const initialContent = `\`\`\`ts\n${quote}\nconst tail = 2\n\`\`\``
  await createRun(runId, "thread-annotations", { status: "success" })
  await persistCanonicalAssistantMessage({ content: initialContent, messageId, runId })
  await finalizeAssistantContentPartsForRun({ runId, threadId: "thread-annotations" })
  const initialProjection = await readAssistantContentPartsProjection({
    messageId,
    threadId: "thread-annotations"
  })
  assert.ok(initialProjection)
  const initialPart = initialProjection.parts.find((part) => part.kind === "code")
  assert.ok(initialPart)
  const identitySource = {
    kind: initialPart.kind,
    slot: `part:${initialPart.id}`,
    sourceId: messageId,
    sourceType: "message" as const
  }
  const card: ContentCardIdentity = {
    ...identitySource,
    cardId: createContentCardId(identitySource),
    revision: initialPart.revision,
    threadId: "thread-annotations"
  }
  const created = await service.create({
    body: "Track the code line.",
    id: "annotation-code-reanchor",
    intent: "comment",
    selection: {
      anchor: {
        blockId: card.slot,
        endColumn: quote.length + 1,
        endLine: 1,
        kind: "code-range",
        startColumn: 1,
        startLine: 1
      },
      anchorResolution: "resolved",
      card,
      contextHash: "context-code-before",
      quote
    }
  })
  assert.equal(created.anchorResolution, "resolved")

  const shiftedContent = `\`\`\`ts\nconst inserted = 0\n${quote}\nconst tail = 2\n\`\`\``
  await persistCanonicalAssistantMessage({ content: shiftedContent, messageId, runId })
  await finalizeAssistantContentPartsForRun({ runId, threadId: "thread-annotations" })
  const shiftedProjection = await readAssistantContentPartsProjection({
    messageId,
    threadId: "thread-annotations"
  })
  assert.ok(shiftedProjection)
  const shiftedPart = shiftedProjection.parts.find((part) => part.kind === "code")
  assert.ok(shiftedPart)
  const candidate = resolveCodeAnnotationAnchorCandidate({
    anchor: created.anchor as Extract<typeof created.anchor, { kind: "code-range" }>,
    quote,
    source: shiftedPart.payload.code
  })
  assert.equal(candidate.status, "resolved")
  if (candidate.status !== "resolved") assert.fail("code quote should reanchor uniquely")

  const repaired = await service.update({
    expectedRevision: created.revision,
    id: created.id,
    repair: {
      anchor: candidate.anchor,
      anchorResolution: "resolved",
      cardRevision: shiftedPart.revision,
      contextHash: `revision:${shiftedPart.revision}`,
      expected: {
        cardRevision: created.cardRevision,
        contextHash: created.contextHash
      },
      quote
    }
  })
  assert.deepEqual(repaired.anchor, candidate.anchor)
  assert.equal(repaired.cardRevision, shiftedPart.revision)
})

test("standard diff repair persists only an exact canonical side range", async () => {
  const service = new ContentAnnotationsService()
  const runId = "run-annotation-diff-reanchor"
  const messageId = "message-annotation-diff-reanchor"
  const deletionQuote = "-const previous = 1"
  const additionQuote = "+const target = 1"
  const initialPatch = [
    "--- a/example.ts",
    "+++ b/example.ts",
    "@@ -1,2 +1,3 @@",
    " context",
    deletionQuote,
    additionQuote,
    " tail"
  ].join("\n")
  const initialContent = `\`\`\`diff\n${initialPatch}\n\`\`\``
  await createRun(runId, "thread-annotations", { status: "success" })
  await persistCanonicalAssistantMessage({ content: initialContent, messageId, runId })
  await finalizeAssistantContentPartsForRun({ runId, threadId: "thread-annotations" })
  const initialProjection = await readAssistantContentPartsProjection({
    messageId,
    threadId: "thread-annotations"
  })
  assert.ok(initialProjection)
  const initialPart = initialProjection.parts.find((part) => part.kind === "diff")
  assert.ok(initialPart)
  const identitySource = {
    kind: initialPart.kind,
    slot: `part:${initialPart.id}`,
    sourceId: messageId,
    sourceType: "message" as const
  }
  const card: ContentCardIdentity = {
    ...identitySource,
    cardId: createContentCardId(identitySource),
    revision: initialPart.revision,
    threadId: "thread-annotations"
  }
  const deletion = await service.create({
    body: "Track the removed line.",
    id: "annotation-diff-deletion-reanchor",
    intent: "comment",
    selection: {
      anchor: {
        endLine: 4,
        filePath: null,
        kind: "diff-range",
        patchRevision: initialPart.revision,
        side: "before",
        startLine: 4
      },
      anchorResolution: "resolved",
      card,
      contextHash: "context-diff-deletion-before",
      quote: deletionQuote
    }
  })
  const addition = await service.create({
    body: "Track the added line.",
    id: "annotation-diff-addition-reanchor",
    intent: "comment",
    selection: {
      anchor: {
        endLine: 5,
        filePath: null,
        kind: "diff-range",
        patchRevision: initialPart.revision,
        side: "after",
        startLine: 5
      },
      anchorResolution: "resolved",
      card,
      contextHash: "context-diff-addition-before",
      quote: additionQuote
    }
  })
  assert.equal(deletion.anchorResolution, "resolved")
  assert.equal(addition.anchorResolution, "resolved")

  const shiftedPatch = [
    "--- a/example.ts",
    "+++ b/example.ts",
    "@@ -1,2 +1,4 @@",
    " leading context",
    " context",
    deletionQuote,
    "+const inserted = 0",
    additionQuote,
    " tail"
  ].join("\n")
  const shiftedContent = `\`\`\`diff\n${shiftedPatch}\n\`\`\``
  await persistCanonicalAssistantMessage({ content: shiftedContent, messageId, runId })
  await finalizeAssistantContentPartsForRun({ runId, threadId: "thread-annotations" })
  const shiftedProjection = await readAssistantContentPartsProjection({
    messageId,
    threadId: "thread-annotations"
  })
  assert.ok(shiftedProjection)
  const shiftedPart = shiftedProjection.parts.find((part) => part.kind === "diff")
  assert.ok(shiftedPart)
  const deletionCandidate = resolveDiffAnnotationAnchorCandidate({
    anchor: deletion.anchor as Extract<typeof deletion.anchor, { kind: "diff-range" }>,
    cardRevision: shiftedPart.revision,
    quote: deletionQuote,
    source: shiftedPart.payload.patch
  })
  const additionCandidate = resolveDiffAnnotationAnchorCandidate({
    anchor: addition.anchor as Extract<typeof addition.anchor, { kind: "diff-range" }>,
    cardRevision: shiftedPart.revision,
    quote: additionQuote,
    source: shiftedPart.payload.patch
  })
  assert.equal(deletionCandidate.status, "resolved")
  assert.equal(additionCandidate.status, "resolved")
  if (deletionCandidate.status !== "resolved" || additionCandidate.status !== "resolved") {
    assert.fail("standard diff quotes should reanchor uniquely")
  }
  assert.deepEqual(
    [deletionCandidate.anchor.side, deletionCandidate.anchor.startLine],
    ["before", 5]
  )
  assert.deepEqual(
    [additionCandidate.anchor.side, additionCandidate.anchor.startLine],
    ["after", 7]
  )

  for (const anchor of [
    { ...deletionCandidate.anchor, endLine: 6 },
    { ...deletionCandidate.anchor, endLine: 999 },
    { ...deletionCandidate.anchor, side: "after" as const }
  ]) {
    await assert.rejects(
      service.update({
        expectedRevision: deletion.revision,
        id: deletion.id,
        repair: {
          anchor,
          anchorResolution: "resolved",
          cardRevision: shiftedPart.revision,
          contextHash: `revision:${shiftedPart.revision}`,
          expected: {
            cardRevision: deletion.cardRevision,
            contextHash: deletion.contextHash
          },
          quote: deletionQuote
        }
      }),
      (error: Error & { code?: string }) => error.code === "FAILED_PRECONDITION"
    )
  }

  const repairedDeletion = await service.update({
    expectedRevision: deletion.revision,
    id: deletion.id,
    repair: {
      anchor: deletionCandidate.anchor,
      anchorResolution: "resolved",
      cardRevision: shiftedPart.revision,
      contextHash: `revision:${shiftedPart.revision}`,
      expected: { cardRevision: deletion.cardRevision, contextHash: deletion.contextHash },
      quote: deletionQuote
    }
  })
  const repairedAddition = await service.update({
    expectedRevision: addition.revision,
    id: addition.id,
    repair: {
      anchor: additionCandidate.anchor,
      anchorResolution: "resolved",
      cardRevision: shiftedPart.revision,
      contextHash: `revision:${shiftedPart.revision}`,
      expected: { cardRevision: addition.cardRevision, contextHash: addition.contextHash },
      quote: additionQuote
    }
  })
  assert.deepEqual(repairedDeletion.anchor, deletionCandidate.anchor)
  assert.deepEqual(repairedAddition.anchor, additionCandidate.anchor)
})

test("whole-card revision repair derives the current durable quote", async () => {
  const service = new ContentAnnotationsService()
  const runId = "run-annotation-whole-card-repair"
  const messageId = "message-annotation-whole-card-repair"
  await createRun(runId, "thread-annotations", { status: "success" })
  await persistCanonicalAssistantMessage({ content: "Before whole card", messageId, runId })
  await finalizeAssistantContentPartsForRun({ runId, threadId: "thread-annotations" })
  const initialProjection = await readAssistantContentPartsProjection({
    messageId,
    threadId: "thread-annotations"
  })
  assert.ok(initialProjection)
  const initialPart = initialProjection.parts[0]!
  const identitySource = {
    kind: initialPart.kind,
    slot: `part:${initialPart.id}`,
    sourceId: messageId,
    sourceType: "message" as const
  }
  const created = await service.create({
    body: "Track the whole card.",
    id: "annotation-whole-card-repair",
    intent: "comment",
    selection: {
      anchor: { kind: "whole-card" },
      anchorResolution: "resolved",
      card: {
        ...identitySource,
        cardId: createContentCardId(identitySource),
        revision: initialPart.revision,
        threadId: "thread-annotations"
      },
      contextHash: `revision:${initialPart.revision}`,
      quote: "Before whole card"
    }
  })

  await persistCanonicalAssistantMessage({ content: "After whole card", messageId, runId })
  await finalizeAssistantContentPartsForRun({ runId, threadId: "thread-annotations" })
  const currentProjection = await readAssistantContentPartsProjection({
    messageId,
    threadId: "thread-annotations"
  })
  assert.ok(currentProjection)
  const currentPart = currentProjection.parts[0]!
  assert.equal(currentPart.id, initialPart.id)
  assert.notEqual(currentPart.revision, initialPart.revision)

  await assert.rejects(
    service.update({
      expectedRevision: created.revision,
      id: created.id,
      repair: {
        anchor: created.anchor,
        anchorResolution: "resolved",
        cardRevision: currentPart.revision,
        contextHash: `revision:${currentPart.revision}`,
        expected: { cardRevision: created.cardRevision, contextHash: created.contextHash },
        quote: "Retargeted quote"
      }
    }),
    (error: Error & { code?: string }) => error.code === "CONFLICT"
  )

  const repaired = await service.update({
    expectedRevision: created.revision,
    id: created.id,
    repair: {
      anchor: created.anchor,
      anchorResolution: "resolved",
      cardRevision: currentPart.revision,
      contextHash: `revision:${currentPart.revision}`,
      expected: { cardRevision: created.cardRevision, contextHash: created.contextHash },
      quote: created.quote
    }
  })
  assert.deepEqual(repaired.anchor, created.anchor)
  assert.equal(repaired.anchorResolution, "resolved")
  assert.equal(repaired.cardRevision, currentPart.revision)
  assert.equal(repaired.quote, "After whole card")
})

test("table-cell revision repair keeps its stable marker and derives the current quote", async () => {
  const service = new ContentAnnotationsService()
  const runId = "run-annotation-table-cell-repair"
  const messageId = "message-annotation-table-cell-repair"
  const initialContent = ["| Item | Value |", "| --- | --- |", "| target | Before cell |"].join(
    "\n"
  )
  await createRun(runId, "thread-annotations", { status: "success" })
  await persistCanonicalAssistantMessage({ content: initialContent, messageId, runId })
  await finalizeAssistantContentPartsForRun({ runId, threadId: "thread-annotations" })
  const initialProjection = await readAssistantContentPartsProjection({
    messageId,
    threadId: "thread-annotations"
  })
  assert.ok(initialProjection)
  const initialPart = initialProjection.parts.find((part) => part.kind === "table")
  assert.ok(initialPart)
  const row = initialPart.payload.rows[0]
  const itemColumn = initialPart.payload.columns[0]
  const valueColumn = initialPart.payload.columns[1]
  assert.ok(row)
  assert.ok(itemColumn)
  assert.ok(valueColumn)
  assert.equal(row.cells[valueColumn.id], "Before cell")
  const identitySource = {
    kind: initialPart.kind,
    slot: `part:${initialPart.id}`,
    sourceId: messageId,
    sourceType: "message" as const
  }
  const created = await service.create({
    body: "Track this table cell.",
    id: "annotation-table-cell-repair",
    intent: "comment",
    selection: {
      anchor: { columnId: valueColumn.id, kind: "table-cell", rowId: row.id },
      anchorResolution: "resolved",
      card: {
        ...identitySource,
        cardId: createContentCardId(identitySource),
        revision: initialPart.revision,
        threadId: "thread-annotations"
      },
      contextHash: `revision:${initialPart.revision}`,
      quote: "Before cell"
    }
  })

  const currentRevision = `sha256:${"a".repeat(64)}`
  await getPrismaClient().assistantContentPart.update({
    data: {
      payloadJson: JSON.stringify({
        ...initialPart.payload,
        rows: initialPart.payload.rows.map((candidate) =>
          candidate.id === row.id
            ? { ...candidate, cells: { ...candidate.cells, [valueColumn.id]: "After cell" } }
            : candidate
        )
      }),
      revision: currentRevision
    },
    where: { partId: initialPart.id }
  })
  const currentProjection = await readAssistantContentPartsProjection({
    messageId,
    threadId: "thread-annotations"
  })
  assert.ok(currentProjection)
  const currentPart = currentProjection.parts.find((part) => part.kind === "table")
  assert.ok(currentPart)
  assert.equal(currentPart.id, initialPart.id)
  assert.equal(currentPart.revision, currentRevision)
  const currentRow = currentPart.payload.rows.find((candidate) => candidate.id === row.id)
  assert.equal(currentRow?.cells[valueColumn.id], "After cell")

  await assert.rejects(
    service.update({
      expectedRevision: created.revision,
      id: created.id,
      repair: {
        anchor: { columnId: itemColumn.id, kind: "table-cell", rowId: row.id },
        anchorResolution: "resolved",
        cardRevision: currentPart.revision,
        contextHash: `revision:${currentPart.revision}`,
        expected: { cardRevision: created.cardRevision, contextHash: created.contextHash },
        quote: created.quote
      }
    }),
    (error: Error & { code?: string }) => error.code === "FAILED_PRECONDITION"
  )

  const repaired = await service.update({
    expectedRevision: created.revision,
    id: created.id,
    repair: {
      anchor: created.anchor,
      anchorResolution: "resolved",
      cardRevision: currentPart.revision,
      contextHash: `revision:${currentPart.revision}`,
      expected: { cardRevision: created.cardRevision, contextHash: created.contextHash },
      quote: created.quote
    }
  })
  assert.deepEqual(repaired.anchor, created.anchor)
  assert.equal(repaired.anchorResolution, "resolved")
  assert.equal(repaired.cardRevision, currentPart.revision)
  assert.equal(repaired.quote, "After cell")
})
