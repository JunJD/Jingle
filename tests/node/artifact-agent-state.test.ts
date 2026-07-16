import assert from "node:assert/strict"
import test from "node:test"
import { Command, ReducedValue, StateSchema } from "@langchain/langgraph"
import {
  createArtifactToolsMiddleware,
  createEmptyJingleAgentStateArtifacts,
  reduceJingleAgentStateArtifacts
} from "@jingle/langchain-agent-harness/transitional"
import { createArtifactPresentationHandler } from "../../src/main/agent/artifact-presentation-handler"
import {
  toJingleAgentStateArtifactManifest,
  toJingleAgentStateArtifactsUpdate
} from "../../src/main/artifacts/agent-state-artifacts"
import { type ArtifactRecord } from "../../src/shared/artifacts"

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

function createJingleArtifactToolsEntryForTest(props: { threadId: string; workspacePath: string }) {
  return createArtifactToolsMiddleware({
    presentArtifacts: createArtifactPresentationHandler(props)
  })
}

test("artifact manifest keeps agent state to storage pointers and status, not content", () => {
  const manifest = toJingleAgentStateArtifactManifest(createSummaryArtifact())

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
  const first = toJingleAgentStateArtifactsUpdate(
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
  const second = toJingleAgentStateArtifactsUpdate(
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

  const state = reduceJingleAgentStateArtifacts(
    reduceJingleAgentStateArtifacts(createEmptyJingleAgentStateArtifacts(), first),
    second
  )

  assert.equal(state.manifestsById["artifact-1"]?.title, "Updated summary")
  assert.equal(state.manifestsById["artifact-1"]?.status, "stale")
  assert.deepEqual(Object.keys(state.presentationsByIdempotencyKey), ["tool-call-1", "tool-call-2"])
  assert.equal(state.presentationsByIdempotencyKey["tool-call-2"]?.receipts[0]?.outcome, "updated")
})

test("artifact state reducer accepts child state snapshots", () => {
  const parentUpdate = toJingleAgentStateArtifactsUpdate(
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
  const childSnapshot = reduceJingleAgentStateArtifacts(
    createEmptyJingleAgentStateArtifacts(),
    toJingleAgentStateArtifactsUpdate(
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

  const state = reduceJingleAgentStateArtifacts(
    reduceJingleAgentStateArtifacts(createEmptyJingleAgentStateArtifacts(), parentUpdate),
    childSnapshot
  )

  assert.equal(state.manifestsById["artifact-parent"]?.title, "Summary")
  assert.equal(state.manifestsById["artifact-child"]?.title, "Child artifact")
  assert.deepEqual(Object.keys(state.presentationsByIdempotencyKey), [
    "tool-call-parent",
    "tool-call-child"
  ])
})

test("artifact tools middleware compiles the backend artifacts state channel", () => {
  const middleware = createJingleArtifactToolsEntryForTest({
    threadId: "thread-1",
    workspacePath: process.cwd()
  })
  const artifactsField = (middleware.stateSchema as StateSchema<any>).fields.artifacts

  assert.equal(StateSchema.isInstance(middleware.stateSchema), true)
  assert.equal(ReducedValue.isInstance(artifactsField), true)
  assert.deepEqual(artifactsField.inputSchema.parse(createEmptyJingleAgentStateArtifacts()), {
    manifestsById: {},
    presentationsByIdempotencyKey: {}
  })
})

test("artifact tools middleware preserves patch updates before reducing state", () => {
  const middleware = createJingleArtifactToolsEntryForTest({
    threadId: "thread-1",
    workspacePath: process.cwd()
  })
  const artifactsField = (middleware.stateSchema as StateSchema<any>).fields.artifacts
  const update = toJingleAgentStateArtifactsUpdate(
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
  const state = artifactsField.reducer(createEmptyJingleAgentStateArtifacts(), parsed)

  assert.equal(parsed.manifests?.[0]?.artifactId, "artifact-1")
  assert.equal(parsed.presentations?.[0]?.idempotencyKey, "tool-call-1")
  assert.equal(state.manifestsById["artifact-1"]?.title, "Summary")
  assert.equal(state.presentationsByIdempotencyKey["tool-call-1"]?.receipts[0]?.outcome, "created")
})

test("artifact tools middleware records artifact refs into runtime state", async () => {
  const middleware = createArtifactToolsMiddleware({
    presentArtifacts: async (_input, context) => ({
      content: "Presented artifact: Recorded summary",
      update: toJingleAgentStateArtifactsUpdate(
        {
          artifacts: [
            createSummaryArtifact({
              artifactKey: `${context.toolCallId}:0`,
              id: "artifact-recording",
              runId: context.runId,
              threadId: "thread-1",
              title: "Recorded summary",
              toolCallId: context.toolCallId
            })
          ],
          receipts: [
            {
              artifactId: "artifact-recording",
              artifactKey: `${context.toolCallId}:0`,
              dedupeKey: null,
              outcome: "created"
            }
          ],
          requestIdentity: {
            idempotencyKey: context.toolCallId,
            threadId: "thread-1"
          },
          type: "stored"
        },
        new Date("2026-01-01T00:00:05.000Z")
      )
    })
  })
  const presentArtifactsTool = middleware.tools?.find((tool) => tool.name === "present_artifacts")
  assert.ok(presentArtifactsTool)

  const output = await presentArtifactsTool.invoke(
    {
      artifacts: [
        {
          kind: "summary",
          text: "Recorded artifact body",
          title: "Recorded summary"
        }
      ]
    },
    {
      toolCall: {
        args: {},
        id: "tool-call-recording",
        name: "present_artifacts",
        type: "tool_call"
      },
      configurable: {
        run_id: "run-recording"
      }
    }
  )

  assert.equal(output instanceof Command, true)
  const update = (output as Command).update as {
    artifacts?: {
      manifests?: Array<{ artifactId: string; runId: string | null; threadId: string }>
    }
    recordingRefs?: Array<{
      createdAt: string
      domain: string
      path: string | null
      refId: string
      runId: string | null
      threadId: string | null
    }>
  }
  const artifact = update.artifacts?.manifests?.[0]
  const recordingRef = update.recordingRefs?.[0]

  assert.ok(artifact)
  assert.ok(recordingRef)
  assert.equal(recordingRef.createdAt, "2026-01-01T00:00:05.000Z")
  assert.equal(recordingRef.domain, "artifact")
  assert.equal(recordingRef.path, null)
  assert.equal(recordingRef.refId, artifact.artifactId)
  assert.equal(recordingRef.runId, "run-recording")
  assert.equal(recordingRef.threadId, "thread-1")
})
