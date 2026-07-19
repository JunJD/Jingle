import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import type { ComputerUseBackend, ComputerUseBackendObservation } from "@jingle/computer-use-core"

const repoRoot = process.cwd()
const originalJingleHome = process.env.JINGLE_HOME

function observation(value: string): ComputerUseBackendObservation {
  return {
    application: { id: "com.example.editor", name: "Editor" },
    capturedAt: Date.now(),
    elements: [
      {
        actions: ["type_text"],
        index: 0,
        ref: "@editor",
        role: "text_field",
        value
      }
    ],
    resourceKey: "macos:42:window-1",
    window: {
      generation: "generation-1",
      nativeId: "window-1",
      pid: 42,
      platform: "macos"
    }
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

test("post-dispatch cancellation settles durable unknown and restart does not redispatch", async () => {
  const jingleHome = await mkdtemp(join(tmpdir(), "jingle-computer-use-application-"))
  process.env.JINGLE_HOME = jingleHome
  execFileSync("node", ["scripts/run-prisma-jingle-db.mjs", "migrate", "deploy"], {
    cwd: repoRoot,
    env: { ...process.env, JINGLE_HOME: jingleHome }
  })

  const { closeDatabase, initializeDatabase } = await import("../../src/main/db")
  const { getPrismaClient } = await import("../../src/main/db/client")
  const { createPrismaComputerUseActionLedgerPort } =
    await import("../../src/main/db/computer-use-action-ledger")
  const { createComputerUseApplicationService } =
    await import("../../src/main/computer-use/service")

  const dispatchEntered = deferred()
  let dispatches = 0
  let observations = 0
  const observeKeys: string[][] = []
  const backend: ComputerUseBackend = {
    matrix: {
      capabilities: [
        {
          action: "type_text",
          background: "verified",
          foreground: "verified",
          route: "ax_value"
        }
      ],
      environment: "macos-quartz",
      platform: "macos",
      protocolVersion: 1
    },
    disposeSession() {
      return Promise.resolve()
    },
    execute({ signal }): Promise<never> {
      dispatches += 1
      dispatchEntered.resolve()
      return new Promise<never>((_resolve, reject) => {
        const rejectAborted = () =>
          reject(signal?.reason ?? new DOMException("Aborted", "AbortError"))
        if (signal?.aborted) rejectAborted()
        else signal?.addEventListener("abort", rejectAborted, { once: true })
      })
    },
    async observe(request) {
      observeKeys.push(Object.keys(request).sort())
      observations += 1
      return observation(observations > 2 ? "after" : "before")
    }
  }

  try {
    await initializeDatabase()
    const prisma = getPrismaClient()
    const now = BigInt(Date.now())
    await prisma.thread.create({
      data: { createdAt: now, status: "busy", threadId: "thread-cua", updatedAt: now }
    })
    await prisma.run.create({
      data: {
        createdAt: now,
        runId: "run-cua",
        status: "running",
        threadId: "thread-cua",
        updatedAt: now
      }
    })

    const service = createComputerUseApplicationService(backend)
    await service.setEnabled(true)
    const session = await service.observeAndOpenSession({
      applicationId: "com.example.editor",
      runId: "run-cua",
      threadId: "thread-cua"
    })
    assert.equal(observeKeys[0]?.includes("applicationId"), true)
    assert.deepEqual(
      observeKeys.flat().filter((key) => ["runId", "threadId", "ttlMs"].includes(key)),
      []
    )
    const actions = [{ kind: "type_text", ref: "@editor", value: "hello" }] as const
    const ledgerPort = createPrismaComputerUseActionLedgerPort()
    const preDispatchAbort = new AbortController()
    preDispatchAbort.abort(new DOMException("Cancelled before dispatch", "AbortError"))
    const cancelled = await service.execute({
      actions,
      baseStateId: session.observation.stateId,
      runId: "run-cua",
      sessionId: session.authorization.sessionId,
      signal: preDispatchAbort.signal,
      threadId: "thread-cua",
      transactionId: "tool-call-cua-pre-dispatch"
    })
    assert.equal(cancelled.result.outcome, "cancelled_before_dispatch")
    assert.equal(cancelled.projection, undefined)
    assert.equal(dispatches, 0)
    const durableCancelled = await ledgerPort.read("tool-call-cua-pre-dispatch")
    assert.equal(durableCancelled?.phase, "settled")
    assert.equal(durableCancelled?.result?.outcome, "cancelled_before_dispatch")

    const abortController = new AbortController()
    const execution = service.execute({
      actions,
      baseStateId: session.observation.stateId,
      runId: "run-cua",
      sessionId: session.authorization.sessionId,
      signal: abortController.signal,
      threadId: "thread-cua",
      transactionId: "tool-call-cua"
    })

    await dispatchEntered.promise
    abortController.abort(new DOMException("Cancelled by caller", "AbortError"))
    const settled = await execution

    assert.equal(settled.result.outcome, "unknown")
    assert.equal(settled.result.successor?.elements[0]?.value, "after")
    assert.equal(settled.projection?.kind, "full")
    if (settled.projection?.kind === "full") {
      assert.equal(settled.projection.reason, "external_mutation_uncertain")
      assert.equal(settled.projection.stateId, settled.result.successor?.stateId)
      assert.equal(settled.projection.elements[0]?.value, "after")
    }
    assert.equal(dispatches, 1)

    const durable = await ledgerPort.read("tool-call-cua")
    assert.equal(durable?.phase, "settled")
    assert.equal(durable?.result?.outcome, "unknown")
    assert.equal(durable?.result?.successor?.stateId, settled.result.successor?.stateId)

    await service.close()
    const restarted = createComputerUseApplicationService(backend)
    const replay = await restarted.execute({
      actions,
      baseStateId: session.observation.stateId,
      runId: "run-cua",
      sessionId: session.authorization.sessionId,
      threadId: "thread-cua",
      transactionId: "tool-call-cua"
    })
    assert.deepEqual(replay.result, settled.result)
    assert.equal(replay.projection, undefined)
    assert.equal(dispatches, 1)
    await restarted.close()
  } finally {
    await closeDatabase()
    if (originalJingleHome === undefined) delete process.env.JINGLE_HOME
    else process.env.JINGLE_HOME = originalJingleHome
    await rm(jingleHome, { force: true, recursive: true })
  }
})
