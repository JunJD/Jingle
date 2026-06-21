import assert from "node:assert/strict"
import test from "node:test"
import { agentContextInclusionMiddlewareInternals } from "../../src/main/agent/agent-context-inclusion-middleware"
import type { OpenworkMemoryRecord } from "../../src/shared/openwork-memory"

function createMemory(overrides: Partial<OpenworkMemoryRecord> = {}): OpenworkMemoryRecord {
  return {
    content: "Prefer terse answers when reviewing runtime state boundaries.",
    createdAt: 1,
    lastIncludedAt: null,
    memoryId: "memory-1",
    metadata: null,
    scope: "global",
    source: "user",
    status: "active",
    type: "about_me",
    updatedAt: 1,
    workspaceKey: null,
    ...overrides
  }
}

test("search_memory tool content includes retrieved memory body for the model", () => {
  const memory = createMemory()
  const content = agentContextInclusionMiddlewareInternals.formatRetrievedMemoryToolContent([
    memory
  ])

  assert.match(content, /Retrieved memory context/)
  assert.match(content, /global\/about_me \(memory-1\)/)
  assert.match(content, /Prefer terse answers when reviewing runtime state boundaries/)
  assert.doesNotMatch(content, /^Retrieved 1 memory context item\(s\)\.$/)
})
