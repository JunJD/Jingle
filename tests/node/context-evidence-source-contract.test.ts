import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import test from "node:test"

const repoRoot = process.cwd()

async function readWorkspaceFile(path: string): Promise<string> {
  return readFile(join(repoRoot, path), "utf8")
}

test("main chat surfaces use ContextEvidencePanel as the current evidence source", async () => {
  const [chatContainer, launcherConversation, contextEvidencePanel] = await Promise.all([
    readWorkspaceFile("src/renderer/src/components/chat/ChatContainer.tsx"),
    readWorkspaceFile("src/renderer/src/ai-core/LauncherAiConversation.tsx"),
    readWorkspaceFile("src/renderer/src/components/chat/ContextEvidencePanel.tsx")
  ])

  assert.equal(chatContainer.includes("IncludedMemoriesPanel"), false)
  assert.equal(launcherConversation.includes("IncludedMemoriesPanel"), false)
  assert.equal(contextEvidencePanel.includes("listIncludedMemoriesForRun"), false)
  assert.equal(contextEvidencePanel.includes("useThreadSelector"), true)
  assert.equal(contextEvidencePanel.includes("contextInclusions"), true)
})
