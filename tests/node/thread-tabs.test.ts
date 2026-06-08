import assert from "node:assert/strict"
import test from "node:test"
import {
  getArtifactTabId,
  getFileTabId,
  getNextActiveTabAfterClose,
  type OpenArtifactTab,
  type OpenFile
} from "../../src/shared/thread-tabs"

test("getNextActiveTabAfterClose falls through to open artifact tabs when closing the last file tab", () => {
  const openFiles: OpenFile[] = [
    {
      name: "notes.md",
      path: "/workspace/notes.md"
    }
  ]
  const openArtifacts: OpenArtifactTab[] = [
    {
      artifactId: "artifact-1"
    }
  ]

  const nextActiveTab = getNextActiveTabAfterClose({
    activeTab: getFileTabId("/workspace/notes.md"),
    closedTabId: getFileTabId("/workspace/notes.md"),
    openArtifacts,
    openFiles
  })

  assert.equal(nextActiveTab, getArtifactTabId("artifact-1"))
})

test("file tab ids are namespaced away from reserved agent tab id", () => {
  assert.equal(getFileTabId("agent"), "file:agent")
})
