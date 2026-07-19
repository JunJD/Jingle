import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  AGENT_RUN_FAILURE_METADATA_KEY,
  type AgentRunFailure
} from "../../src/shared/agent-run-failure"
import type { ModelRuntimeSelection } from "../../src/shared/app-types"

const threadId = "thread-agent-run-failure-database-restart"
const runId = "run-agent-run-failure-database-restart"
const selection = {
  modelId: "deepseek:deepseek-v4-pro",
  thinkingEffort: "high",
  version: 1
} satisfies ModelRuntimeSelection

test("durable run failure survives database restart and hydrates the identical typed fact", async () => {
  const originalJingleHome = process.env.JINGLE_HOME
  const jingleHome = await mkdtemp(join(tmpdir(), "jingle-agent-run-failure-restart-"))
  process.env.JINGLE_HOME = jingleHome

  const [
    { AgentThreadRunner },
    { ThreadLifecycleGate },
    { toAgentRunFailure },
    { markRunFailed },
    { ArtifactsService },
    { getPrismaClient },
    { closeDatabase, initializeDatabase },
    { createRun, getRun },
    { createThread, getThread, updateThread },
    { ThreadDigestService },
    { ThreadWorkspaceRepository },
    { ThreadWorkspaceService },
    { ThreadsService },
    { MODEL_RUNTIME_SELECTION_METADATA_KEY, MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY }
  ] = await Promise.all([
    import("../../src/main/agent/agent-thread-runner"),
    import("../../src/main/agent/thread-lifecycle-gate"),
    import("../../src/main/agent/errors"),
    import("../../src/main/agent/persistence"),
    import("../../src/main/artifacts/service"),
    import("../../src/main/db/client"),
    import("../../src/main/db/lifecycle"),
    import("../../src/main/db/runs"),
    import("../../src/main/db/threads"),
    import("../../src/main/thread-digest/service"),
    import("../../src/main/thread-workspace/repository"),
    import("../../src/main/thread-workspace/service"),
    import("../../src/main/threads/service"),
    import("../../src/shared/model-runtime-selection")
  ])

  try {
    await initializeDatabase()
    await createThread(threadId, {
      metadata: {
        [MODEL_RUNTIME_SELECTION_METADATA_KEY]: selection,
        [MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY]: 1
      }
    })
    await createRun(runId, threadId, {
      metadata: { [MODEL_RUNTIME_SELECTION_METADATA_KEY]: selection },
      status: "running"
    })
    await updateThread(threadId, { status: "busy" })

    const failure = toAgentRunFailure(
      "agent:runtime",
      new Error("429 rate_limit persisted across database restart")
    )
    const terminalStatus = await markRunFailed(threadId, runId, failure)
    const writtenRun = await getRun(runId)
    const writtenEvent = await getPrismaClient().agentEvent.findFirstOrThrow({
      orderBy: { seq: "desc" },
      where: { runId, type: "run.finished" }
    })

    assert.deepEqual(failure, {
      ipcCode: "INTERNAL",
      kind: "rate_limited",
      message: "429 rate_limit persisted across database restart",
      schemaVersion: 1,
      status: 500
    })
    assert.equal(terminalStatus, "error")
    assert.equal((await getThread(threadId))?.status, "error")
    assert.deepEqual(JSON.parse(writtenRun?.metadata ?? "{}"), {
      [AGENT_RUN_FAILURE_METADATA_KEY]: failure,
      [MODEL_RUNTIME_SELECTION_METADATA_KEY]: selection
    })
    assert.deepEqual(JSON.parse(writtenEvent.payload), {
      completionReason: null,
      errorMessage: "429 rate_limit persisted across database restart",
      errorType: "rate_limited",
      status: "error"
    })

    await closeDatabase()
    await initializeDatabase()

    const threadsService = new ThreadsService(
      new ArtifactsService(),
      {
        getDefaultRuntimeSelection: () => selection,
        validateRuntimeSelection: (candidate: ModelRuntimeSelection) => candidate
      } as ConstructorParameters<typeof ThreadsService>[1],
      { getAgentConfig: () => ({ locale: "en-US" }) } as unknown as ConstructorParameters<
        typeof ThreadsService
      >[2],
      {
        createDefaultWorkspace: async () => process.cwd(),
        resolveGlobalWorkspacePath: async () => process.cwd()
      } as ConstructorParameters<typeof ThreadsService>[3],
      new ThreadWorkspaceService(new ThreadWorkspaceRepository()),
      new ThreadDigestService(),
      new ThreadLifecycleGate()
    )
    const snapshot = await threadsService.getPersistedAgentThreadData(threadId)
    const runtimeState = await new AgentThreadRunner(threadsService).readThreadState(threadId)
    const restartedRun = await getRun(runId)
    const restartedEvent = await getPrismaClient().agentEvent.findFirstOrThrow({
      orderBy: { seq: "desc" },
      where: { runId, type: "run.finished" }
    })

    assert.deepEqual(restartedRun, writtenRun)
    assert.deepEqual(JSON.parse(restartedEvent.payload), JSON.parse(writtenEvent.payload))
    assert.deepEqual(snapshot.runState.error, failure)
    assert.equal(snapshot.runState.runId, runId)
    assert.equal(snapshot.thread.status, "error")
    assert.deepEqual(runtimeState.error, failure)
    assert.equal(runtimeState.latestRunId, runId)
    assert.equal(runtimeState.status, "error")
    assert.deepEqual(
      (JSON.parse(restartedRun?.metadata ?? "{}") as Record<string, unknown>)[
        AGENT_RUN_FAILURE_METADATA_KEY
      ],
      failure satisfies AgentRunFailure
    )
  } finally {
    await closeDatabase()
    if (originalJingleHome === undefined) {
      delete process.env.JINGLE_HOME
    } else {
      process.env.JINGLE_HOME = originalJingleHome
    }
    await rm(jingleHome, { force: true, recursive: true })
  }
})
