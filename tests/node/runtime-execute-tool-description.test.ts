import assert from "node:assert/strict"
import test from "node:test"
import { getExecuteToolDescription } from "../../src/main/agent/runtime"

test("execute tool description exposes workspace cwd as the command contract", () => {
  const workspacePath = "/tmp/openwork-project"
  const description = getExecuteToolDescription(workspacePath)

  assert.match(description, /current working directory set to:/)
  assert.match(description, /\/tmp\/openwork-project/)
  assert.match(description, /"git status"/)
  assert.match(description, /"npm test"/)
  assert.match(description, /do not prefix it with "cd \/tmp\/openwork-project &&"/)
})
