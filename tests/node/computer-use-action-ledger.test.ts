import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { PrismaClient } from "@prisma/client"
import {
  ComputerUseActionLedger,
  type ComputerUseActionAttempt,
  type ComputerUseTransactionResult
} from "@jingle/computer-use-core"
import {
  createPrismaComputerUseActionLedgerPort,
  PrismaComputerUseActionLedgerPort
} from "../../src/main/db/computer-use-action-ledger"

const repoRoot = process.cwd()
const originalJingleHome = process.env.JINGLE_HOME
let jingleHome = ""

function actionAttemptInput(transactionId: string) {
  return {
    actions: [{ kind: "type_text", ref: "@e1", value: "hello" }] as const,
    authorization: {
      expiresAt: Date.now() + 60_000,
      runId: "run-ledger",
      sessionId: "session-ledger",
      threadId: "thread-ledger",
      window: { generation: "g1", nativeId: "w1", pid: 42, platform: "macos" as const }
    },
    baseStateId: "state-0",
    target: {
      applicationId: "com.example.fixture",
      resourceKey: "desktop-pid:42",
      window: { generation: "g1", nativeId: "w1", pid: 42, platform: "macos" as const }
    },
    transactionId
  }
}

async function createIndependentPrismaClient(): Promise<PrismaClient> {
  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${join(jingleHome, "jingle.sqlite")}` } }
  })
  await prisma.$connect()
  await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 5000")
  return prisma
}

test.before(async () => {
  jingleHome = await mkdtemp(join(tmpdir(), "jingle-computer-use-ledger-"))
  process.env.JINGLE_HOME = jingleHome
  execFileSync("node", ["scripts/run-prisma-jingle-db.mjs", "migrate", "deploy"], {
    cwd: repoRoot,
    env: { ...process.env, JINGLE_HOME: jingleHome }
  })
})

test.beforeEach(async () => {
  const { closeDatabase, initializeDatabase } = await import("../../src/main/db")
  const { getPrismaClient } = await import("../../src/main/db/client")
  await closeDatabase()
  await initializeDatabase()
  await getPrismaClient().computerUseAttempt.deleteMany()
})

test.after(async () => {
  const { closeDatabase } = await import("../../src/main/db")
  await closeDatabase()
  if (originalJingleHome === undefined) delete process.env.JINGLE_HOME
  else process.env.JINGLE_HOME = originalJingleHome
  await rm(jingleHome, { force: true, recursive: true })
})

test("migration owns the computer-use ledger schema and a reserved attempt survives restart", async () => {
  const { closeDatabase, initializeDatabase } = await import("../../src/main/db")
  const { getPrismaClient } = await import("../../src/main/db/client")
  const prisma = getPrismaClient()
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    'PRAGMA table_info("computer_use_attempts")'
  )
  assert.deepEqual(
    columns.map((column) => column.name),
    ["attempt_id", "phase", "revision", "payload_json"]
  )
  const schema = await prisma.$queryRawUnsafe<Array<{ sql: string }>>(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'computer_use_attempts'`
  )
  assert.match(schema[0]?.sql ?? "", /phase_revision_check/)
  assert.match(schema[0]?.sql ?? "", /json_valid\("payload_json"\)/)

  const ledger = new ComputerUseActionLedger(createPrismaComputerUseActionLedgerPort())
  const claim = await ledger.begin(actionAttemptInput("restart-reservation"))
  assert.equal(claim.status, "reserved")

  await closeDatabase()
  await initializeDatabase()
  const restarted = new ComputerUseActionLedger(createPrismaComputerUseActionLedgerPort())
  const hydrated = await restarted.find("restart-reservation")
  assert.deepEqual(hydrated?.attempt, claim.attempt)
  assert.equal(hydrated?.source, "durable")
  assert.equal(Object.isFrozen(hydrated?.attempt), true)
  assert.equal(Object.isFrozen(hydrated?.attempt.authorization.window), true)
})

test("persisted logical corruption and phase-payload disagreement fail closed", async () => {
  const { getPrismaClient } = await import("../../src/main/db/client")
  const prisma = getPrismaClient()
  const port = createPrismaComputerUseActionLedgerPort()
  const ledger = new ComputerUseActionLedger(port)
  const claim = await ledger.begin(actionAttemptInput("corrupt-payload"))

  await prisma.computerUseAttempt.update({
    data: { payloadJson: JSON.stringify({ attemptId: claim.attempt.attemptId }) },
    where: { attemptId: claim.attempt.attemptId }
  })
  await assert.rejects(
    port.read(claim.attempt.attemptId),
    /Persisted computer-use action attempt .* is corrupt/
  )

  await prisma.computerUseAttempt.update({
    data: {
      payloadJson: JSON.stringify(claim.attempt),
      phase: "dispatched",
      revision: 1
    },
    where: { attemptId: claim.attempt.attemptId }
  })
  await assert.rejects(
    port.read(claim.attempt.attemptId),
    /Persisted computer-use action attempt .* is corrupt/
  )
})

test("two durable ledger instances atomically reserve and settle one immutable attempt", async () => {
  const clientA = await createIndependentPrismaClient()
  const clientB = await createIndependentPrismaClient()
  try {
    const portA = new PrismaComputerUseActionLedgerPort(clientA)
    const portB = new PrismaComputerUseActionLedgerPort(clientB)
    const ledgerA = new ComputerUseActionLedger(portA)
    const ledgerB = new ComputerUseActionLedger(portB)
    const input = actionAttemptInput("concurrent-transition")
    const [claimA, claimB] = await Promise.all([ledgerA.begin(input), ledgerB.begin(input)])
    assert.deepEqual([claimA.status, claimB.status].sort(), ["existing", "reserved"])

    const [dispatch, cancellation] = await Promise.all([
      ledgerA.dispatched(input.transactionId),
      ledgerB.cancel(input.transactionId)
    ])
    assert.ok(["applied", "conflict"].includes(dispatch.status))
    assert.ok(["cancelled_before_dispatch", "unknown"].includes(cancellation.outcome))

    const settled = await portA.read(input.transactionId)
    assert.equal(settled?.phase, "settled")
    assert.ok(["cancelled_before_dispatch", "unknown"].includes(settled?.result?.outcome ?? ""))
    assert.equal(settled?.revision, settled?.dispatchedAt === undefined ? 1 : 2)

    const staleDispatch: ComputerUseActionAttempt = {
      ...claimA.attempt,
      dispatchedAt: Date.now(),
      phase: "dispatched",
      revision: 1
    }
    const stale = await portB.transition({
      attempt: staleDispatch,
      expectedPhase: "queued",
      expectedRevision: 0
    })
    assert.equal(stale.status, "conflict")
    assert.deepEqual(stale.status === "conflict" ? stale.current : undefined, settled)

    const replayA: ComputerUseTransactionResult = await ledgerA.cancel(input.transactionId)
    const replayB: ComputerUseTransactionResult = await ledgerB.cancel(input.transactionId)
    assert.deepEqual(replayA, settled?.result)
    assert.deepEqual(replayB, settled?.result)
  } finally {
    await Promise.all([clientA.$disconnect(), clientB.$disconnect()])
  }

  const restartClient = await createIndependentPrismaClient()
  try {
    const restarted = new ComputerUseActionLedger(
      new PrismaComputerUseActionLedgerPort(restartClient)
    )
    const replay = await restarted.find("concurrent-transition")
    assert.equal(replay?.attempt.phase, "settled")
    assert.equal(replay?.source, "durable")
  } finally {
    await restartClient.$disconnect()
  }
})
