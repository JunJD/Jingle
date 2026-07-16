import assert from "node:assert/strict"
import test from "node:test"
import {
  BASE_SYSTEM_PROMPT,
  buildJingleSystemPrompt
} from "@jingle/langchain-agent-harness/transitional"

test("base system prompt keeps root agent execution-oriented", () => {
  assert.match(
    BASE_SYSTEM_PROMPT,
    /^The commentary channel is DISABLED, DO NOT SEND UPDATE VIA commentary CHANNEL!/
  )
  assert.match(BASE_SYSTEM_PROMPT, /You are jingle/)
  assert.match(BASE_SYSTEM_PROMPT, /Default to doing the work without asking permission/)
  assert.match(BASE_SYSTEM_PROMPT, /continue until the user's request is completed/)
  assert.match(BASE_SYSTEM_PROMPT, /do not let brevity stop the work early/)
  assert.match(BASE_SYSTEM_PROMPT, /Match the user's language/)
  assert.match(BASE_SYSTEM_PROMPT, /Do not stop after creating a todo list/)
  assert.match(BASE_SYSTEM_PROMPT, /Preserve code identifiers, commands, logs, file paths/)

  assert.doesNotMatch(BASE_SYSTEM_PROMPT, /After working on a file, just stop/)
  assert.doesNotMatch(BASE_SYSTEM_PROMPT, /ALWAYS ask the user if the plan looks good/)
})

test("jingle system prompt injects the workspace path contract", () => {
  const systemPrompt = buildJingleSystemPrompt("/tmp/jingle-project")

  assert.match(systemPrompt, /The workspace root is: `\/tmp\/jingle-project`/)
  assert.match(systemPrompt, /ls\("\/tmp\/jingle-project"\)/)
  assert.match(systemPrompt, /You are jingle/)
})
