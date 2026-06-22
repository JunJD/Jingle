import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import test from "node:test"

const repoRoot = process.cwd()

async function readWorkspaceFile(path: string): Promise<string> {
  return readFile(join(repoRoot, path), "utf8")
}

test("main chat surfaces use ContextEvidencePanel as the current evidence source", async () => {
  const [chatContainer, launcherConversation, messageTurnView, contextEvidencePanel] =
    await Promise.all([
      readWorkspaceFile("src/renderer/src/components/chat/ChatContainer.tsx"),
      readWorkspaceFile("src/renderer/src/ai-core/LauncherAiConversation.tsx"),
      readWorkspaceFile("src/renderer/src/components/chat/MessageTurnView.tsx"),
      readWorkspaceFile("src/renderer/src/components/chat/ContextEvidencePanel.tsx")
    ])

  assert.equal(chatContainer.includes("IncludedMemoriesPanel"), false)
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
    "src/main/agent/agent-context-inclusion-middleware.ts"
  )

  assert.equal(middlewareSource.includes('"search_memory"'), false)
  assert.equal(middlewareSource.includes("searchMemorySchema"), false)
  assert.equal(middlewareSource.includes("createRetrievedMemoryContextInclusion"), false)
})

test("agent runtime passes temporary mode into openwork memory middleware", async () => {
  const runtimeSource = await readWorkspaceFile("src/main/agent/runtime.ts")

  assert.equal(
    runtimeSource.includes("temporaryMode: options.openworkMemoryTemporaryMode === true"),
    true
  )
  assert.equal(runtimeSource.includes("temporaryMode: false"), false)
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
    memoryReviewPanel.includes("readOpenworkMemoryEvidenceRefsFromReviewPayload"),
    true
  )
  assert.equal(memoryReviewPanel.includes("listIncludedMemoriesForRun"), false)
  assert.equal(memoryReviewPanel.includes("tool_call_id"), false)
  assert.equal(memoryReviewPanel.includes("pendingMemoryEvidenceTitle"), true)
})

test("agent context state memory design doc matches the implemented V2 phase contract", async () => {
  const doc = await readWorkspaceFile("docs/agent-context-state-memory-goal-cn.md")

  for (const heading of [
    "### Phase 0: 文档冻结",
    "### Phase 1: 通用 ProjectionQueue",
    "### Phase 2: Runtime evidence state baseline",
    "### Phase 3: Tool surface 收敛",
    "### Phase 4: ThreadDigest schema/projection",
    "### Phase 5: search_history 升级",
    "### Phase 6: get_message_context",
    "### Phase 7: get_trace_evidence",
    "### Phase 8: turn/message-level evidence",
    "### Phase 9: memory suggestion evidence binding"
  ]) {
    assert.equal(doc.includes(heading), true)
  }

  assert.equal(doc.includes("`Thread` 就是 Openwork 内部 session 本体。"), true)
  assert.equal(doc.includes("`SessionBinding` 只是 thread/session 与外部来源的绑定关系"), true)
  assert.equal(doc.includes("`ThreadDigest` 是可重建的 thread/session 摘要投影"), true)
  assert.equal(doc.includes("主聊天 UI 的唯一 context/evidence truth source"), true)
  assert.equal(doc.includes("temporary mode 下不读取 structured memory"), true)
})
