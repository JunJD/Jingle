import assert from "node:assert/strict"
import test from "node:test"
import type { ArtifactRecord } from "../../src/shared/artifacts"
import {
  getArtifactTabId,
  getNextActiveTabAfterClose,
  syncOpenArtifactTabs,
  type OpenArtifactTab,
  type OpenFile
} from "../../src/shared/thread-tabs"

function createLinkArtifact(props: { id: string; title: string }): ArtifactRecord {
  return {
    artifactKey: "tool-call-1:0",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    id: props.id,
    kind: "link",
    messageId: null,
    mimeType: null,
    payload: null,
    previewText: null,
    runId: null,
    sizeBytes: null,
    source: {
      type: "external-url",
      uri: "https://example.com"
    },
    status: "ready",
    subtitle: null,
    threadId: "thread-1",
    title: props.title,
    toolCallId: "tool-call-1",
    updatedAt: new Date("2026-01-01T00:00:00.000Z")
  }
}

test("getNextActiveTabAfterClose falls through to open artifact tabs when closing the last file tab", () => {
  const openFiles: OpenFile[] = [
    {
      name: "notes.md",
      path: "/workspace/notes.md"
    }
  ]
  const openArtifacts: OpenArtifactTab[] = [
    {
      artifactId: "artifact-1",
      kind: "summary",
      title: "Draft summary"
    }
  ]

  const nextActiveTab = getNextActiveTabAfterClose({
    activeTab: "/workspace/notes.md",
    closedTabId: "/workspace/notes.md",
    openArtifacts,
    openFiles
  })

  assert.equal(nextActiveTab, getArtifactTabId("artifact-1"))
})

test("syncOpenArtifactTabs refreshes tab metadata from the latest artifact records", () => {
  const openArtifacts: OpenArtifactTab[] = [
    {
      artifactId: "artifact-1",
      kind: "summary",
      title: "Old summary"
    },
    {
      artifactId: "artifact-missing",
      kind: "patch",
      title: "Still open"
    }
  ]

  const nextOpenArtifacts = syncOpenArtifactTabs(openArtifacts, [
    createLinkArtifact({
      id: "artifact-1",
      title: "Published link"
    })
  ])

  assert.deepEqual(nextOpenArtifacts, [
    {
      artifactId: "artifact-1",
      kind: "link",
      title: "Published link"
    },
    {
      artifactId: "artifact-missing",
      kind: "patch",
      title: "Still open"
    }
  ])
})
