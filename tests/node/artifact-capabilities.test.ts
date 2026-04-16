import assert from "node:assert/strict"
import test from "node:test"
import {
  getArtifactCapabilities,
  supportsArtifactAction,
  type ArtifactRecord
} from "../../src/shared/artifacts"

const baseArtifact = {
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  messageId: null,
  mimeType: null,
  previewText: null,
  runId: null,
  sizeBytes: null,
  status: "ready" as const,
  subtitle: null,
  threadId: "thread-1",
  toolCallId: "tool-call-1",
  updatedAt: new Date("2026-01-01T00:00:00.000Z")
}

function createArtifact(overrides: ArtifactRecord): ArtifactRecord {
  return overrides
}

test("managed patch artifacts share managed-file actions with file artifacts", () => {
  const artifact = createArtifact({
    ...baseArtifact,
    id: "artifact-patch",
    kind: "patch",
    payload: null,
    source: {
      type: "managed-file-path",
      uri: "/tmp/report.patch"
    },
    title: "Report patch"
  })

  assert.deepEqual(getArtifactCapabilities(artifact), {
    primaryAction: "open",
    supportedActions: ["open", "download", "reveal-source"]
  })
  assert.equal(supportsArtifactAction(artifact, "reveal-source"), true)
})

test("inline patch artifacts stay preview-only", () => {
  const artifact = createArtifact({
    ...baseArtifact,
    id: "artifact-inline-patch",
    kind: "patch",
    payload: {
      format: "diff",
      text: "--- a/file\n+++ b/file\n"
    },
    source: {
      type: "inline-text",
      uri: null
    },
    title: "Inline patch"
  })

  assert.deepEqual(getArtifactCapabilities(artifact), {
    primaryAction: "preview",
    supportedActions: ["preview"]
  })
  assert.equal(supportsArtifactAction(artifact, "open"), false)
})

test("link artifacts expose copy-link without reveal-source", () => {
  const artifact = createArtifact({
    ...baseArtifact,
    id: "artifact-link",
    kind: "link",
    payload: null,
    source: {
      type: "external-url",
      uri: "https://example.com/report"
    },
    title: "External report"
  })

  assert.equal(supportsArtifactAction(artifact, "copy-link"), true)
  assert.equal(supportsArtifactAction(artifact, "reveal-source"), false)
})
