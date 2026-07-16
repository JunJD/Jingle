import assert from "node:assert/strict"
import test from "node:test"
import { createContentCardId, contentCardIdentitySchema } from "../../src/shared/content-card"
import { contentAnnotationSchema } from "../../src/shared/content-annotation"
import { createSelectionReference } from "../../src/shared/content-selection"
import { projectAssistantContentPartCard } from "../../src/renderer/src/lib/content-card-registry"
import {
  createContentAnnotationAgentContext,
  serializeContentAnnotationAgentContext
} from "../../src/shared/content-annotation-agent-context"

test("content card identity is source and slot based", () => {
  assert.equal(
    createContentCardId({
      kind: "narrative",
      sourceId: "message-1",
      sourceType: "message",
      slot: "narrative:final"
    }),
    "message:message-1:narrative:narrative%3Afinal"
  )
  assert.equal(
    contentCardIdentitySchema.parse({
      cardId: "message:message-1:narrative:narrative%3Afinal",
      kind: "narrative",
      revision: "message-revision-2",
      slot: "narrative:final",
      sourceId: "message-1",
      sourceType: "message",
      threadId: "thread-1"
    }).sourceId,
    "message-1"
  )
})

test("add-to-prompt creates an ephemeral reference without an annotation", () => {
  const reference = createSelectionReference({
    anchor: { blockId: "paragraph:intro", end: 12, kind: "text-range", start: 4 },
    anchorResolution: "resolved",
    card: {
      cardId: "message:message-1:narrative:narrative%3Afinal",
      kind: "narrative",
      revision: "message-revision-2",
      slot: "narrative:final",
      sourceId: "message-1",
      sourceType: "message",
      threadId: "thread-1"
    },
    contextHash: "sha256:context",
    quote: "selected"
  })

  assert.equal(reference.type, "content-selection")
  assert.equal("lifecycle" in reference, false)
  assert.equal("id" in reference, false)
})

test("annotation lifecycle and anchor resolution are independent", () => {
  const parsed = contentAnnotationSchema.parse({
    anchor: { kind: "whole-card" },
    anchorResolution: "orphaned",
    body: "Please revisit this section.",
    cardId: "message:message-1:narrative:narrative%3Afinal",
    cardRevision: "message-revision-2",
    contextHash: "sha256:context",
    createdAt: "2026-07-16T12:00:00.000Z",
    deletedAt: null,
    id: "annotation-1",
    intent: "comment",
    lifecycle: "resolved",
    quote: "section",
    revision: 3,
    threadId: "thread-1",
    updatedAt: "2026-07-16T12:01:00.000Z"
  })
  assert.equal(parsed.lifecycle, "resolved")
  assert.equal(parsed.anchorResolution, "orphaned")
})

test("assistant leaf adapters share one stable identity owner", () => {
  for (const kind of ["narrative", "code", "diff", "table", "mermaid"] as const) {
    const projection = projectAssistantContentPartCard({
      kind,
      messageId: "assistant-1",
      partId: `part-${kind}`,
      payload: { markdown: kind },
      revision: "sha256:one",
      threadId: "thread-1"
    })
    assert.equal(projection.identity.kind, kind)
    assert.equal(projection.identity.slot, `part:part-${kind}`)
    assert.match(projection.identity.cardId, new RegExp(`^message:assistant-1:${kind}:`))
  }
})

test("request change creates inspectable pending context without a run command", () => {
  const annotation = contentAnnotationSchema.parse({
    anchor: { kind: "whole-card" },
    anchorResolution: "resolved",
    body: "Use a clearer owner boundary.",
    cardId: "message:assistant-1:narrative:part%3Aone",
    cardRevision: "sha256:one",
    contextHash: "sha256:context",
    createdAt: "2026-07-16T12:00:00.000Z",
    deletedAt: null,
    id: "annotation-request",
    intent: "suggestion",
    lifecycle: "open",
    quote: "owner boundary",
    revision: 1,
    threadId: "thread-1",
    updatedAt: "2026-07-16T12:00:00.000Z"
  })
  const context = createContentAnnotationAgentContext(annotation)
  assert.equal(context.command, "request-change")
  assert.doesNotMatch(serializeContentAnnotationAgentContext(context), /invoke|auto.?apply/i)
})
