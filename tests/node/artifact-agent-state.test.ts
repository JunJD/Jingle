import assert from "node:assert/strict"
import test from "node:test"
import { ReducedValue, StateSchema } from "@langchain/langgraph"
import { createArtifactToolsMiddleware } from "../../src/main/agent/artifact-tools-middleware"
import {
  createEmptyAgentStateArtifacts,
  reduceAgentStateArtifacts,
  toAgentStateArtifactManifest,
  toAgentStateArtifactsUpdate,
  type ArtifactRecord
} from "../../src/shared/artifacts"

const baseArtifact = {
  artifactKey: "tool-call-1:0",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  messageId: null,
  mimeType: null,
  previewText: "content preview stays outside agent state",
  runId: "run-1",
  sizeBytes: null,
  status: "ready" as const,
  subtitle: null,
  threadId: "thread-1",
  toolCallId: "tool-call-1",
  updatedAt: new Date("2026-01-01T00:00:01.000Z")
}

function createSummaryArtifact(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    ...baseArtifact,
    id: "artifact-1",
    kind: "summary",
    payload: {
      format: "markdown",
      text: "# Full artifact content"
    },
    source: {
      type: "inline-text",
      uri: null
    },
    title: "Summary",
    ...overrides
  } as ArtifactRecord
}

test("artifact manifest keeps agent state to storage pointers and status, not content", () => {
  const manifest = toAgentStateArtifactManifest(createSummaryArtifact())

  assert.deepEqual(manifest, {
    artifactId: "artifact-1",
    artifactKey: "tool-call-1:0",
    kind: "summary",
    mimeType: null,
    runId: "run-1",
    sizeBytes: null,
    sourceType: "inline-text",
    status: "ready",
    threadId: "thread-1",
    title: "Summary",
    toolCallId: "tool-call-1",
    updatedAt: "2026-01-01T00:00:01.000Z"
  })
  assert.equal("payload" in manifest, false)
  assert.equal("previewText" in manifest, false)
  assert.equal("sourceUri" in manifest, false)
})

test("artifact state reducer merges presentation receipts and replaces manifests by id", () => {
  const first = toAgentStateArtifactsUpdate(
    {
      artifacts: [createSummaryArtifact()],
      receipts: [
        {
          artifactId: "artifact-1",
          artifactKey: "tool-call-1:0",
          dedupeKey: null,
          outcome: "created"
        }
      ],
      requestIdentity: {
        idempotencyKey: "tool-call-1",
        threadId: "thread-1"
      },
      type: "stored"
    },
    new Date("2026-01-01T00:00:02.000Z")
  )
  const second = toAgentStateArtifactsUpdate(
    {
      artifacts: [
        createSummaryArtifact({
          status: "stale",
          title: "Updated summary",
          updatedAt: new Date("2026-01-01T00:00:03.000Z")
        })
      ],
      receipts: [
        {
          artifactId: "artifact-1",
          artifactKey: "tool-call-2:0",
          dedupeKey: "summary",
          outcome: "updated"
        }
      ],
      requestIdentity: {
        idempotencyKey: "tool-call-2",
        threadId: "thread-1"
      },
      type: "stored"
    },
    new Date("2026-01-01T00:00:04.000Z")
  )

  const state = reduceAgentStateArtifacts(
    reduceAgentStateArtifacts(createEmptyAgentStateArtifacts(), first),
    second
  )

  assert.equal(state.manifestsById["artifact-1"]?.title, "Updated summary")
  assert.equal(state.manifestsById["artifact-1"]?.status, "stale")
  assert.deepEqual(Object.keys(state.presentationsByIdempotencyKey), [
    "tool-call-1",
    "tool-call-2"
  ])
  assert.equal(
    state.presentationsByIdempotencyKey["tool-call-2"]?.receipts[0]?.outcome,
    "updated"
  )
})

test("artifact state reducer accepts subagent-returned state snapshots", () => {
  const parentUpdate = toAgentStateArtifactsUpdate(
    {
      artifacts: [createSummaryArtifact({ id: "artifact-parent" })],
      receipts: [
        {
          artifactId: "artifact-parent",
          artifactKey: "tool-call-parent:0",
          dedupeKey: null,
          outcome: "created"
        }
      ],
      requestIdentity: {
        idempotencyKey: "tool-call-parent",
        threadId: "thread-1"
      },
      type: "stored"
    },
    new Date("2026-01-01T00:00:02.000Z")
  )
  const subagentSnapshot = reduceAgentStateArtifacts(
    createEmptyAgentStateArtifacts(),
    toAgentStateArtifactsUpdate(
      {
        artifacts: [
          createSummaryArtifact({
            artifactKey: "tool-call-child:0",
            id: "artifact-child",
            title: "Child artifact",
            toolCallId: "tool-call-child"
          })
        ],
        receipts: [
          {
            artifactId: "artifact-child",
            artifactKey: "tool-call-child:0",
            dedupeKey: null,
            outcome: "created"
          }
        ],
        requestIdentity: {
          idempotencyKey: "tool-call-child",
          threadId: "thread-1"
        },
        type: "stored"
      },
      new Date("2026-01-01T00:00:03.000Z")
    )
  )

  const state = reduceAgentStateArtifacts(
    reduceAgentStateArtifacts(createEmptyAgentStateArtifacts(), parentUpdate),
    subagentSnapshot
  )

  assert.equal(state.manifestsById["artifact-parent"]?.title, "Summary")
  assert.equal(state.manifestsById["artifact-child"]?.title, "Child artifact")
  assert.deepEqual(Object.keys(state.presentationsByIdempotencyKey), [
    "tool-call-parent",
    "tool-call-child"
  ])
})

test("artifact tools middleware owns the backend artifacts state channel", () => {
  const middleware = createArtifactToolsMiddleware({
    threadId: "thread-1",
    workspacePath: process.cwd()
  })
  const artifactsField = (middleware.stateSchema as StateSchema<any>).fields.artifacts

  assert.equal(StateSchema.isInstance(middleware.stateSchema), true)
  assert.equal(ReducedValue.isInstance(artifactsField), true)
  assert.deepEqual(artifactsField.inputSchema.parse(createEmptyAgentStateArtifacts()), {
    manifestsById: {},
    presentationsByIdempotencyKey: {}
  })
})

test("artifact tools middleware preserves patch updates before reducing state", () => {
  const middleware = createArtifactToolsMiddleware({
    threadId: "thread-1",
    workspacePath: process.cwd()
  })
  const artifactsField = (middleware.stateSchema as StateSchema<any>).fields.artifacts
  const update = toAgentStateArtifactsUpdate(
    {
      artifacts: [createSummaryArtifact()],
      receipts: [
        {
          artifactId: "artifact-1",
          artifactKey: "tool-call-1:0",
          dedupeKey: null,
          outcome: "created"
        }
      ],
      requestIdentity: {
        idempotencyKey: "tool-call-1",
        threadId: "thread-1"
      },
      type: "stored"
    },
    new Date("2026-01-01T00:00:02.000Z")
  )

  const parsed = artifactsField.inputSchema.parse(update)
  const state = artifactsField.reducer(createEmptyAgentStateArtifacts(), parsed)

  assert.equal(parsed.manifests?.[0]?.artifactId, "artifact-1")
  assert.equal(parsed.presentations?.[0]?.idempotencyKey, "tool-call-1")
  assert.equal(state.manifestsById["artifact-1"]?.title, "Summary")
  assert.equal(
    state.presentationsByIdempotencyKey["tool-call-1"]?.receipts[0]?.outcome,
    "created"
  )
})
