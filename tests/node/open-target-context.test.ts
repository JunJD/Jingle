import assert from "node:assert/strict"
import test from "node:test"
import type { OpenTarget } from "@shared/open-targets"
import { resolveOpenTargetSelection } from "../../src/renderer/src/lib/open-target-context"

const TARGETS: OpenTarget[] = [
  { id: "editor", kind: "application", label: "Editor" },
  { id: "files", kind: "file-manager", label: "Files" }
]

test("open target selection is scoped to the current workspace", () => {
  assert.equal(
    resolveOpenTargetSelection({
      folderPath: "/workspace-a",
      selection: { folderPath: "/workspace-a", targetId: "files" },
      targets: TARGETS
    })?.id,
    "files"
  )
  assert.equal(
    resolveOpenTargetSelection({
      folderPath: "/workspace-b",
      selection: { folderPath: "/workspace-a", targetId: "files" },
      targets: TARGETS
    })?.id,
    "editor"
  )
})

test("open target selection resolves only targets that are currently available", () => {
  assert.equal(
    resolveOpenTargetSelection({
      folderPath: "/workspace-a",
      selection: { folderPath: "/workspace-a", targetId: "missing" },
      targets: TARGETS
    })?.id,
    "editor"
  )
  assert.equal(
    resolveOpenTargetSelection({
      folderPath: "/workspace-a",
      selection: { folderPath: "/workspace-a", targetId: "files" },
      targets: []
    }),
    null
  )
})
