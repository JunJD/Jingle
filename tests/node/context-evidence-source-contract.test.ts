import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import test from "node:test"

const repoRoot = process.cwd()

async function readWorkspaceFile(path: string): Promise<string> {
  return readFile(join(repoRoot, path), "utf8")
}

test("main chat surfaces use ContextEvidencePanel as the current evidence source", async () => {
  const [launcherConversation, messageTurnView, contextEvidencePanel] =
    await Promise.all([
      readWorkspaceFile("src/renderer/src/ai-core/LauncherAiConversation.tsx"),
      readWorkspaceFile("src/renderer/src/components/chat/MessageTurnView.tsx"),
      readWorkspaceFile("src/renderer/src/components/chat/ContextEvidencePanel.tsx")
    ])

  assert.equal(launcherConversation.includes("IncludedMemoriesPanel"), false)
  assert.equal(contextEvidencePanel.includes("listIncludedMemoriesForRun"), false)
  assert.equal(contextEvidencePanel.includes("useThreadSelector"), true)
  assert.equal(contextEvidencePanel.includes("contextInclusions"), true)
  assert.equal(messageTurnView.includes("<ContextEvidencePanel"), true)
  assert.equal(messageTurnView.includes("turnId={turn.key}"), true)
})

test("context evidence panel supports global and turn-bound schema state projections", async () => {
  const contextEvidencePanel = await readWorkspaceFile(
    "src/renderer/src/components/chat/ContextEvidencePanel.tsx"
  )

  assert.equal(contextEvidencePanel.includes("turnId?: string | null"), true)
  assert.equal(contextEvidencePanel.includes("messageId?: string | null"), true)
  assert.equal(contextEvidencePanel.includes("inclusion.turnId === turnId"), true)
  assert.equal(
    contextEvidencePanel.includes("inclusion.turnId === null && inclusion.messageId === null"),
    true
  )
  assert.equal(contextEvidencePanel.includes("tool_call_id"), false)
})

test("main agent default context retrieval surface does not expose memory search", async () => {
  const middlewareSource = await readWorkspaceFile(
    "src/main/agent/context-retrieval-tool-handlers.ts"
  )

  assert.equal(middlewareSource.includes('"search_memory"'), false)
  assert.equal(middlewareSource.includes("searchMemorySchema"), false)
  assert.equal(middlewareSource.includes("createRetrievedMemoryContextInclusion"), false)
})

test("agent runtime passes temporary mode into jingle memory middleware", async () => {
  const runtimeHostSource = await readWorkspaceFile("src/main/agent/runtime-assembly.ts")

  assert.equal(runtimeHostSource.includes("createJingleMemoryHarnessPortOptions"), true)
  assert.equal(runtimeHostSource.includes("temporaryMode: jingleMemoryTemporaryMode"), true)
  assert.equal(runtimeHostSource.includes("temporaryMode: false"), false)
})

test("context evidence display maps schema source types to user-facing labels", async () => {
  const contextEvidencePanel = await readWorkspaceFile(
    "src/renderer/src/components/chat/ContextEvidencePanel.tsx"
  )

  assert.equal(contextEvidencePanel.includes('case "thread_digest":'), true)
  assert.equal(contextEvidencePanel.includes('return "thread summary"'), true)
  assert.equal(contextEvidencePanel.includes("inclusion.sourceType,"), false)
})

test("pending memory review displays evidence refs from suggestion review payload", async () => {
  const memoryReviewPanel = await readWorkspaceFile(
    "src/renderer/src/components/chat/MemoryReviewPanel.tsx"
  )

  assert.equal(
    memoryReviewPanel.includes("readJingleMemoryEvidenceRefsFromReviewPayload"),
    true
  )
  assert.equal(memoryReviewPanel.includes("listIncludedMemoriesForRun"), false)
  assert.equal(memoryReviewPanel.includes("tool_call_id"), false)
  assert.equal(memoryReviewPanel.includes("pendingMemoryEvidenceTitle"), true)
})
