import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { emptyCheckpoint } from "@langchain/langgraph-checkpoint"

const repoRoot = process.cwd()
let openworkHome = ""

async function loadDbModules() {
  const db = await import("../../src/main/db")
  const { getPrismaClient } = await import("../../src/main/db/client")
  return { ...db, getPrismaClient }
}

test.before(async () => {
  openworkHome = await mkdtemp(join(tmpdir(), "openwork-agent-persistence-"))
  process.env.OPENWORK_HOME = openworkHome

  execFileSync("node", ["scripts/run-prisma-openwork-db.mjs", "migrate", "deploy"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OPENWORK_HOME: openworkHome
    }
  })
})

test.beforeEach(async () => {
  const { closeDatabase, initializeDatabase, getPrismaClient } = await loadDbModules()
  await closeDatabase()
  await initializeDatabase()
  await getPrismaClient().thread.deleteMany()
})

test.after(async () => {
  const { closeDatabase } = await loadDbModules()
  await closeDatabase()
  delete process.env.OPENWORK_HOME

  if (openworkHome) {
    await rm(openworkHome, { force: true, recursive: true })
  }
})

test("resume primitives target the request's run instead of the latest active run", async () => {
  const { createRun, createThread, getHitlRequest, getRun, resolveHitlRequest, upsertHitlRequest } =
    await loadDbModules()
  const { resumeAgentRun } = await import("../../src/main/agent/persistence")

  const threadId = "thread-1"
  const olderRunId = "run-older"
  const latestRunId = "run-latest"

  await createThread(threadId)
  await createRun(olderRunId, threadId, { status: "interrupted" })
  await createRun(latestRunId, threadId, { status: "interrupted" })
  await upsertHitlRequest({
    request_id: "request-older",
    thread_id: threadId,
    run_id: olderRunId,
    tool_call_id: "tool-call-older",
    tool_name: "write_file",
    tool_args: { path: "/tmp/older.txt" },
    allowed_decisions: ["approve", "reject"],
    status: "pending"
  })
  await upsertHitlRequest({
    request_id: "request-latest",
    thread_id: threadId,
    run_id: latestRunId,
    tool_call_id: "tool-call-latest",
    tool_name: "write_file",
    tool_args: { path: "/tmp/latest.txt" },
    allowed_decisions: ["approve", "reject"],
    status: "pending"
  })

  const request = await getHitlRequest("request-older")
  assert.equal(request?.run_id, olderRunId)

  await resumeAgentRun(threadId, request!.run_id!, {
    requestId: request!.request_id,
    source: "resume"
  })
  await resolveHitlRequest(request!.request_id, "approved", {
    request_id: request!.request_id,
    tool_call_id: request!.tool_call_id,
    type: "approve"
  })

  const resumedRun = await getRun(olderRunId)
  const latestRun = await getRun(latestRunId)
  const resolvedRequest = await getHitlRequest("request-older")
  const untouchedRequest = await getHitlRequest("request-latest")

  assert.equal(resumedRun?.status, "running")
  assert.equal(latestRun?.status, "interrupted")
  assert.equal(resolvedRequest?.status, "approved")
  assert.equal(untouchedRequest?.status, "pending")
})

test("syncRunFromLatestCheckpoint reads the latest checkpoint for that run only", async () => {
  const { createRun, createThread, getRun } = await loadDbModules()
  const { syncRunFromLatestCheckpoint } = await import("../../src/main/agent/persistence")
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")

  const threadId = "thread-1"
  const interruptedRunId = "run-interrupted"
  const successRunId = "run-success"

  await createThread(threadId)
  await createRun(interruptedRunId, threadId, { status: "running" })
  await createRun(successRunId, threadId, { status: "running" })

  const interruptedCheckpoint = emptyCheckpoint()
  interruptedCheckpoint.id = "checkpoint-0001"
  interruptedCheckpoint.channel_values = {
    __interrupt__: [
      {
        value: {
          actionRequests: []
        }
      }
    ]
  }

  const successCheckpoint = emptyCheckpoint()
  successCheckpoint.id = "checkpoint-0002"
  successCheckpoint.channel_values = {
    messages: []
  }

  const saver = new PrismaCheckpointSaver()
  await saver.put(
    {
      configurable: {
        thread_id: threadId,
        run_id: interruptedRunId
      }
    },
    interruptedCheckpoint,
    {
      parents: {},
      source: "update",
      step: 0
    }
  )
  await saver.put(
    {
      configurable: {
        thread_id: threadId,
        run_id: successRunId
      }
    },
    successCheckpoint,
    {
      parents: {},
      source: "update",
      step: 1
    }
  )

  const status = await syncRunFromLatestCheckpoint(threadId, interruptedRunId)
  const interruptedRun = await getRun(interruptedRunId)
  const successRun = await getRun(successRunId)

  assert.equal(status, "interrupted")
  assert.equal(interruptedRun?.status, "interrupted")
  assert.equal(successRun?.status, "running")
})
