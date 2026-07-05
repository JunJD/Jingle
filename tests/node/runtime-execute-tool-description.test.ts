import assert from "node:assert/strict"
import test from "node:test"
import { buildJingleExecuteToolDescription } from "@jingle/langchain-agent-harness/transitional"

test("execute tool description exposes workspace cwd as the command contract", () => {
  const workspacePath = "/tmp/jingle-project"
  const description = buildJingleExecuteToolDescription(workspacePath)

  assert.match(description, /cwd set to:/)
  assert.match(description, /\/tmp\/jingle-project/)
  assert.match(description, /"git status"/)
  assert.match(description, /"npm test"/)
  assert.match(description, /cwd="packages\/api"/)
  assert.match(description, /Do not prefix commands with "cd \/tmp\/jingle-project &&"/)
  assert.match(description, /"cd subdir &&"/)
})
