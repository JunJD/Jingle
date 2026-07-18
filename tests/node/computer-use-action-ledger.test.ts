import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
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

function queuedAttemptPayload(transactionId: string, runId: string, threadId: string) {
  const input = actionAttemptInput(transactionId)
  input.authorization.runId = runId
  input.authorization.threadId = threadId
  return {
    ...input,
    attemptId: transactionId,
    phase: "queued" as const,
    revision: 0,
    startedAt: Date.now()
  }
}

async function createOwnershipMigrationFixture(prefix: string): Promise<{
  directory: string
  prisma: PrismaClient
}> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${join(directory, "fixture.sqlite")}` } }
  })
  await prisma.$connect()
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "runs" (
      "run_id" TEXT NOT NULL PRIMARY KEY,
      "thread_id" TEXT NOT NULL
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "computer_use_attempts" (
      "attempt_id" TEXT NOT NULL PRIMARY KEY,
      "phase" TEXT NOT NULL,
      "revision" INTEGER NOT NULL,
      "payload_json" TEXT NOT NULL,
      CONSTRAINT "computer_use_attempts_phase_revision_check" CHECK (
        ("phase" = 'queued' AND "revision" = 0)
        OR ("phase" = 'dispatched' AND "revision" = 1)
        OR ("phase" = 'settled' AND "revision" IN (1, 2))
      ),
      CONSTRAINT "computer_use_attempts_payload_json_check" CHECK (json_valid("payload_json"))
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "_prisma_migrations" (
      "migration_name" TEXT NOT NULL PRIMARY KEY
    )
  `)
  return { directory, prisma }
}

async function applyOwnershipMigration(prisma: PrismaClient): Promise<void> {
  const sql = await readFile(
    join(
      repoRoot,
      "prisma/migrations/20260717070000_bind_computer_use_attempt_ownership/migration.sql"
    ),
    "utf8"
  )
  const statements = sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
  await prisma.$transaction(async (transaction) => {
    for (const statement of statements) {
      await transaction.$executeRawUnsafe(statement)
    }
    await transaction.$executeRawUnsafe(
      'INSERT INTO "_prisma_migrations" ("migration_name") VALUES (?)',
      "20260717070000_bind_computer_use_attempt_ownership"
    )
  })
}

async function readOwnershipMigrationRecordCount(prisma: PrismaClient): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*) AS count FROM "_prisma_migrations"
     WHERE "migration_name" = '20260717070000_bind_computer_use_attempt_ownership'`
  )
  return Number(rows[0]?.count)
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
  const prisma = getPrismaClient()
  await prisma.computerUseAttempt.deleteMany()
  const now = BigInt(Date.now())
  await prisma.thread.upsert({
    create: {
      createdAt: now,
      status: "idle",
      threadId: "thread-ledger",
      updatedAt: now
    },
    update: { updatedAt: now },
    where: { threadId: "thread-ledger" }
  })
  await prisma.run.upsert({
    create: {
      createdAt: now,
      runId: "run-ledger",
      status: "running",
      threadId: "thread-ledger",
      updatedAt: now
    },
    update: { updatedAt: now },
    where: { runId: "run-ledger" }
  })
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
    ["attempt_id", "run_id", "thread_id", "phase", "revision", "payload_json"]
  )
  const schema = await prisma.$queryRawUnsafe<Array<{ sql: string }>>(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'computer_use_attempts'`
  )
  assert.match(schema[0]?.sql ?? "", /phase_revision_check/)
  assert.match(schema[0]?.sql ?? "", /json_valid\("payload_json"\)/)
  assert.match(schema[0]?.sql ?? "", /payload_owner_check/)
  assert.match(schema[0]?.sql ?? "", /FOREIGN KEY \("run_id", "thread_id"\)/)

  const runIndex = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    'PRAGMA index_info("idx_computer_use_attempts_run_id")'
  )
  assert.deepEqual(
    runIndex.map((column) => column.name),
    ["run_id"]
  )
  const threadIndex = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    'PRAGMA index_info("idx_computer_use_attempts_thread_id")'
  )
  assert.deepEqual(
    threadIndex.map((column) => column.name),
    ["thread_id"]
  )

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
    data: {
      payloadJson: JSON.stringify({
        ...claim.attempt,
        actions: [{ kind: "invalid-action", ref: "@e1" }]
      })
    },
    where: { attemptId: claim.attempt.attemptId }
  })
  await assert.rejects(
    port.read(claim.attempt.attemptId),
    /Persisted computer-use action attempt .* is corrupt/
  )

  await assert.rejects(
    prisma.computerUseAttempt.update({
      data: {
        payloadJson: JSON.stringify(claim.attempt),
        phase: "dispatched",
        revision: 1
      },
      where: { attemptId: claim.attempt.attemptId }
    })
  )
})

test("durable owner columns fail closed on drift and cascade with their canonical run", async () => {
  const { getPrismaClient } = await import("../../src/main/db/client")
  const prisma = getPrismaClient()
  const port = createPrismaComputerUseActionLedgerPort()
  const ledger = new ComputerUseActionLedger(port)
  const claim = await ledger.begin(actionAttemptInput("owned-attempt"))

  const now = BigInt(Date.now())
  await prisma.thread.create({
    data: {
      createdAt: now,
      status: "idle",
      threadId: "thread-other",
      updatedAt: now
    }
  })
  await prisma.run.create({
    data: {
      createdAt: now,
      runId: "run-other",
      status: "running",
      threadId: "thread-other",
      updatedAt: now
    }
  })
  await assert.rejects(
    prisma.computerUseAttempt.update({
      data: { runId: "run-other", threadId: "thread-other" },
      where: { attemptId: claim.attempt.attemptId }
    })
  )
  assert.deepEqual(await port.read(claim.attempt.attemptId), claim.attempt)
  await prisma.run.delete({ where: { runId: "run-ledger" } })
  assert.equal(await port.read(claim.attempt.attemptId), undefined)
})

test("ownership migration keeps canonical rows, drops deleted-owner orphans, and rejects owned corruption", async () => {
  const retained = await createOwnershipMigrationFixture("jingle-computer-use-upgrade-retained-")
  try {
    await retained.prisma.$executeRawUnsafe(
      'INSERT INTO "runs" ("run_id", "thread_id") VALUES (?, ?)',
      "run-retained",
      "thread-retained"
    )
    const valid = queuedAttemptPayload("attempt-retained", "run-retained", "thread-retained")
    const orphan = queuedAttemptPayload("attempt-orphan", "run-deleted", "thread-deleted")
    for (const attempt of [valid, orphan]) {
      await retained.prisma.$executeRawUnsafe(
        `INSERT INTO "computer_use_attempts"
          ("attempt_id", "phase", "revision", "payload_json")
         VALUES (?, ?, ?, ?)`,
        attempt.attemptId,
        attempt.phase,
        attempt.revision,
        JSON.stringify(attempt)
      )
    }

    await applyOwnershipMigration(retained.prisma)
    const migrated = await retained.prisma.$queryRawUnsafe<
      Array<{ attempt_id: string; run_id: string; thread_id: string }>
    >(
      'SELECT "attempt_id", "run_id", "thread_id" FROM "computer_use_attempts" ORDER BY "attempt_id"'
    )
    assert.deepEqual(migrated, [
      {
        attempt_id: "attempt-retained",
        run_id: "run-retained",
        thread_id: "thread-retained"
      }
    ])
    assert.equal(await readOwnershipMigrationRecordCount(retained.prisma), 1)

    await retained.prisma.$executeRawUnsafe('DELETE FROM "runs" WHERE "run_id" = ?', "run-retained")
    const afterOwnerDeletion = await retained.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*) AS count FROM "computer_use_attempts"'
    )
    assert.equal(Number(afterOwnerDeletion[0]?.count), 0)
  } finally {
    await retained.prisma.$disconnect()
    await rm(retained.directory, { force: true, recursive: true })
  }

  const corrupted = await createOwnershipMigrationFixture("jingle-computer-use-upgrade-corrupt-")
  try {
    await corrupted.prisma.$executeRawUnsafe(
      'INSERT INTO "runs" ("run_id", "thread_id") VALUES (?, ?)',
      "run-corrupt",
      "thread-corrupt"
    )
    const attempt = queuedAttemptPayload("attempt-corrupt", "run-corrupt", "thread-corrupt")
    await corrupted.prisma.$executeRawUnsafe(
      `INSERT INTO "computer_use_attempts"
        ("attempt_id", "phase", "revision", "payload_json")
       VALUES (?, ?, ?, ?)`,
      attempt.attemptId,
      attempt.phase,
      attempt.revision,
      JSON.stringify({ ...attempt, phase: "dispatched", revision: 1 })
    )
    await assert.rejects(applyOwnershipMigration(corrupted.prisma))
    const oldColumns = await corrupted.prisma.$queryRawUnsafe<Array<{ name: string }>>(
      'PRAGMA table_info("computer_use_attempts")'
    )
    assert.deepEqual(
      oldColumns.map((column) => column.name),
      ["attempt_id", "phase", "revision", "payload_json"]
    )
    assert.equal(await readOwnershipMigrationRecordCount(corrupted.prisma), 0)
  } finally {
    await corrupted.prisma.$disconnect()
    await rm(corrupted.directory, { force: true, recursive: true })
  }

  const mismatched = await createOwnershipMigrationFixture("jingle-computer-use-upgrade-mismatch-")
  try {
    await mismatched.prisma.$executeRawUnsafe(
      'INSERT INTO "runs" ("run_id", "thread_id") VALUES (?, ?)',
      "run-live",
      "thread-canonical"
    )
    const attempt = queuedAttemptPayload("attempt-mismatch", "run-live", "thread-drifted")
    await mismatched.prisma.$executeRawUnsafe(
      `INSERT INTO "computer_use_attempts"
        ("attempt_id", "phase", "revision", "payload_json")
       VALUES (?, ?, ?, ?)`,
      attempt.attemptId,
      attempt.phase,
      attempt.revision,
      JSON.stringify(attempt)
    )
    await assert.rejects(applyOwnershipMigration(mismatched.prisma))
    const remaining = await mismatched.prisma.$queryRawUnsafe<Array<{ attempt_id: string }>>(
      'SELECT "attempt_id" FROM "computer_use_attempts"'
    )
    assert.deepEqual(remaining, [{ attempt_id: "attempt-mismatch" }])
    assert.equal(await readOwnershipMigrationRecordCount(mismatched.prisma), 0)
  } finally {
    await mismatched.prisma.$disconnect()
    await rm(mismatched.directory, { force: true, recursive: true })
  }

  const malformed = await createOwnershipMigrationFixture("jingle-computer-use-upgrade-malformed-")
  try {
    const attempt = queuedAttemptPayload("attempt-malformed", "run-deleted", "thread-deleted")
    await malformed.prisma.$executeRawUnsafe(
      `INSERT INTO "computer_use_attempts"
        ("attempt_id", "phase", "revision", "payload_json")
       VALUES (?, ?, ?, ?)`,
      attempt.attemptId,
      attempt.phase,
      attempt.revision,
      JSON.stringify({
        ...attempt,
        authorization: { ...attempt.authorization, runId: null }
      })
    )
    await assert.rejects(applyOwnershipMigration(malformed.prisma))
    const remaining = await malformed.prisma.$queryRawUnsafe<Array<{ attempt_id: string }>>(
      'SELECT "attempt_id" FROM "computer_use_attempts"'
    )
    assert.deepEqual(remaining, [{ attempt_id: "attempt-malformed" }])
    assert.equal(await readOwnershipMigrationRecordCount(malformed.prisma), 0)
  } finally {
    await malformed.prisma.$disconnect()
    await rm(malformed.directory, { force: true, recursive: true })
  }

  const whitespaceOwner = await createOwnershipMigrationFixture(
    "jingle-computer-use-upgrade-whitespace-owner-"
  )
  try {
    const attempt = queuedAttemptPayload(
      "attempt-whitespace-owner",
      "\trun-deleted\t",
      "thread-deleted"
    )
    await whitespaceOwner.prisma.$executeRawUnsafe(
      `INSERT INTO "computer_use_attempts"
        ("attempt_id", "phase", "revision", "payload_json")
       VALUES (?, ?, ?, ?)`,
      attempt.attemptId,
      attempt.phase,
      attempt.revision,
      JSON.stringify(attempt)
    )
    await assert.rejects(applyOwnershipMigration(whitespaceOwner.prisma))
    const remaining = await whitespaceOwner.prisma.$queryRawUnsafe<Array<{ attempt_id: string }>>(
      'SELECT "attempt_id" FROM "computer_use_attempts"'
    )
    assert.deepEqual(remaining, [{ attempt_id: "attempt-whitespace-owner" }])
    assert.equal(await readOwnershipMigrationRecordCount(whitespaceOwner.prisma), 0)
  } finally {
    await whitespaceOwner.prisma.$disconnect()
    await rm(whitespaceOwner.directory, { force: true, recursive: true })
  }

  const noncanonicalId = await createOwnershipMigrationFixture(
    "jingle-computer-use-upgrade-noncanonical-id-"
  )
  try {
    await noncanonicalId.prisma.$executeRawUnsafe(
      'INSERT INTO "runs" ("run_id", "thread_id") VALUES (?, ?)',
      "run-noncanonical-id",
      "thread-noncanonical-id"
    )
    const attempt = queuedAttemptPayload(
      " attempt-noncanonical-id ",
      "run-noncanonical-id",
      "thread-noncanonical-id"
    )
    await noncanonicalId.prisma.$executeRawUnsafe(
      `INSERT INTO "computer_use_attempts"
        ("attempt_id", "phase", "revision", "payload_json")
       VALUES (?, ?, ?, ?)`,
      attempt.attemptId,
      attempt.phase,
      attempt.revision,
      JSON.stringify(attempt)
    )
    await assert.rejects(applyOwnershipMigration(noncanonicalId.prisma))
    const remaining = await noncanonicalId.prisma.$queryRawUnsafe<Array<{ attempt_id: string }>>(
      'SELECT "attempt_id" FROM "computer_use_attempts"'
    )
    assert.deepEqual(remaining, [{ attempt_id: " attempt-noncanonical-id " }])
    assert.equal(await readOwnershipMigrationRecordCount(noncanonicalId.prisma), 0)
  } finally {
    await noncanonicalId.prisma.$disconnect()
    await rm(noncanonicalId.directory, { force: true, recursive: true })
  }
})

test("reservation requires an existing run whose thread matches the canonical authorization", async () => {
  const { getPrismaClient } = await import("../../src/main/db/client")
  const prisma = getPrismaClient()
  const port = createPrismaComputerUseActionLedgerPort()
  const ledger = new ComputerUseActionLedger(port)
  const missingOwner = actionAttemptInput("missing-owner")
  missingOwner.authorization.runId = "run-missing"

  await assert.rejects(ledger.begin(missingOwner))
  assert.equal(await port.read(missingOwner.transactionId), undefined)

  const now = BigInt(Date.now())
  await prisma.thread.create({
    data: {
      createdAt: now,
      status: "idle",
      threadId: "thread-mismatch",
      updatedAt: now
    }
  })
  const mismatchedPair = actionAttemptInput("mismatched-owner")
  mismatchedPair.authorization.threadId = "thread-mismatch"
  await assert.rejects(ledger.begin(mismatchedPair))
  assert.equal(await port.read(mismatchedPair.transactionId), undefined)
})

test("a stale transition cannot move an attempt to another durable owner", async () => {
  const { getPrismaClient } = await import("../../src/main/db/client")
  const prisma = getPrismaClient()
  const port = createPrismaComputerUseActionLedgerPort()
  const ledger = new ComputerUseActionLedger(port)
  const claim = await ledger.begin(actionAttemptInput("owner-transition"))
  const now = BigInt(Date.now())
  await prisma.thread.create({
    data: {
      createdAt: now,
      status: "idle",
      threadId: "thread-transition-other",
      updatedAt: now
    }
  })
  await prisma.run.create({
    data: {
      createdAt: now,
      runId: "run-transition-other",
      status: "running",
      threadId: "thread-transition-other",
      updatedAt: now
    }
  })

  const transition = await port.transition({
    attempt: {
      ...claim.attempt,
      authorization: {
        ...claim.attempt.authorization,
        runId: "run-transition-other",
        threadId: "thread-transition-other"
      },
      dispatchedAt: Date.now(),
      phase: "dispatched",
      revision: 1
    },
    expectedPhase: "queued",
    expectedRevision: 0
  })
  assert.equal(transition.status, "conflict")
  assert.deepEqual(transition.status === "conflict" ? transition.current : undefined, claim.attempt)
  assert.deepEqual(await port.read(claim.attempt.attemptId), claim.attempt)
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
