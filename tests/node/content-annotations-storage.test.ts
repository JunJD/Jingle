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
import { createContentCardId, type ContentCardIdentity } from "../../src/shared/content-card"

const originalJingleHome = process.env.JINGLE_HOME
let jingleHome = ""
let durableCard: ContentCardIdentity

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
  const now = BigInt(Date.now())
  await getPrismaClient().message.create({
    data: {
      content: JSON.stringify("Summary"),
      createdAt: now,
      kind: "assistant",
      messageId: "message-1",
      rawHash: "hash",
      rawMessage: "Summary",
      role: "assistant",
      runId: "run-annotations",
      searchText: "Summary",
      seq: 1,
      threadId: "thread-annotations",
      updatedAt: now
    }
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
        quote: created.quote
      }
    }),
    (error: Error & { code?: string }) => error.code === "FAILED_PRECONDITION"
  )

  const deleted = await service.delete({ expectedRevision: 2, id: created.id })
  assert.equal(deleted.revision, 3)
  assert.notEqual(deleted.deletedAt, null)
  assert.equal((await service.list("thread-annotations")).length, 1)
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
