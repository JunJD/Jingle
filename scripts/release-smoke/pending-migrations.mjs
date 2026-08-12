#!/usr/bin/env node

import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { PrismaClient } from "@prisma/client"
import { runLocalCommand } from "../lib/run-local-command.mjs"
import { readMigrationManifest } from "./migration-manifest.mjs"
import { prepareUpgradeBaseline, readUpgradeBaseline } from "./upgrade-baseline.mjs"

const SENTINEL_STATUS = "idle"
const SENTINEL_TITLE = "Pending migration upgrade sentinel"
const SENTINEL_TIMESTAMP = 1_700_000_000_000
const repoRoot = fileURLToPath(new URL("../..", import.meta.url))

function fail(message) {
  throw new Error(`Pending migration smoke: ${message}`)
}

// A customer may jump from the oldest supported release to this checkout, and a
// single pull request may add more than one migration. The rehearsal therefore
// starts from the reviewed release ledger and keeps the complete current suffix
// pending instead of treating only the newest migration as an upgrade.
export function selectPendingMigrationPlan(manifest, baseline) {
  const previous = assertReleasedMigrationsUnchanged(manifest, baseline)
  const pending = manifest.slice(previous.length)
  if (pending.length === 0) {
    fail(`${baseline.tag} has no pending migration in this checkout`)
  }
  return Object.freeze({
    pending,
    previous: manifest.slice(0, previous.length)
  })
}

// A database on a user's disk already carries the checksums of the migrations
// its release shipped, so the main process refuses to start once a released
// migration is edited, renamed, or reordered. The reviewed baseline manifest is
// the only local record of what those releases wrote.
export function assertReleasedMigrationsUnchanged(manifest, baseline) {
  const checksumsByName = new Map(manifest.map((migration) => [migration.name, migration.checksum]))
  const drifted = baseline.migrations.filter(
    (migration) => checksumsByName.get(migration.name) !== migration.sha256
  )
  if (drifted.length > 0) {
    fail(
      `migrations already shipped in ${baseline.tag} must stay byte-identical, but this checkout dropped or edited ${JSON.stringify(
        drifted.map((migration) => migration.name)
      )}`
    )
  }
  const released = baseline.migrations.map((migration) => migration.name)
  const leading = manifest.slice(0, released.length).map((migration) => migration.name)
  if (JSON.stringify(leading) !== JSON.stringify(released)) {
    fail(
      `${baseline.tag} migrations must stay the leading ordered prefix of this checkout, got ${JSON.stringify(leading)}`
    )
  }
  return released
}

export function createUpgradeSentinel(token = randomUUID()) {
  return Object.freeze({
    createdAt: SENTINEL_TIMESTAMP,
    metadata: JSON.stringify({ pendingMigrationSmoke: { schemaVersion: 1, token } }),
    status: SENTINEL_STATUS,
    threadId: `pending-migration-smoke-${token}`,
    title: SENTINEL_TITLE,
    token,
    updatedAt: SENTINEL_TIMESTAMP
  })
}

export function assertMigrationLedger(rows, expected, owner) {
  if (!Array.isArray(rows)) fail(`${owner} returned no migration ledger`)
  const applied = rows.map((row) => ({ checksum: row.checksum, name: row.migration_name }))
  if (JSON.stringify(applied) !== JSON.stringify(expected)) {
    fail(
      `${owner} ledger does not match this checkout. Expected ${JSON.stringify(
        expected.map((migration) => migration.name)
      )}, got ${JSON.stringify(applied.map((migration) => migration.name))}`
    )
  }
  const broken = rows.find((row) => !row.finished_at || row.rolled_back_at)
  if (broken) {
    fail(`${owner} contains an incomplete or rolled-back migration: ${broken.migration_name}`)
  }
  return applied
}

// SQLite BIGINT columns arrive as BigInt through the Prisma client, so the row is
// normalized to strings before it is compared with the seeded sentinel.
export function assertUpgradeSentinelRow(row, sentinel, owner) {
  if (!row || typeof row !== "object") fail(`${owner} lost the pre-upgrade sentinel thread`)
  const actual = {
    createdAt: String(row.created_at),
    metadata: row.metadata,
    status: row.status,
    threadId: row.thread_id,
    title: row.title,
    updatedAt: String(row.updated_at)
  }
  const expected = {
    createdAt: String(sentinel.createdAt),
    metadata: sentinel.metadata,
    status: sentinel.status,
    threadId: sentinel.threadId,
    title: sentinel.title,
    updatedAt: String(sentinel.updatedAt)
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${owner} rewrote the upgrade sentinel thread: ${JSON.stringify(actual)}`)
  }
  return actual
}

function toSqliteUrl(databasePath) {
  return `file:${databasePath.replaceAll("\\", "/")}`
}

async function withPrismaClient(databasePath, operation) {
  const prisma = new PrismaClient({ datasources: { db: { url: toSqliteUrl(databasePath) } } })
  try {
    return await operation(prisma)
  } finally {
    await prisma.$disconnect()
  }
}

function readMigrationLedger(prisma) {
  return prisma.$queryRawUnsafe(
    "SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name"
  )
}

export async function seedUpgradeSentinel(databasePath, sentinel) {
  await withPrismaClient(databasePath, (prisma) =>
    prisma.$executeRawUnsafe(
      `INSERT INTO "threads" ("thread_id", "created_at", "updated_at", "metadata", "status", "title")
       VALUES (?, ?, ?, ?, ?, ?)`,
      sentinel.threadId,
      sentinel.createdAt,
      sentinel.updatedAt,
      sentinel.metadata,
      sentinel.status,
      sentinel.title
    )
  )
  return databasePath
}

export async function createPreviousStateDatabase(input) {
  const { jingleHome, plan, workspace } = input
  const prepared = await prepareUpgradeBaseline({
    dependencyRoot: repoRoot,
    jingleHome,
    repositoryRoot: repoRoot,
    workspace
  })
  const databasePath = prepared.databasePath
  await withPrismaClient(databasePath, async (prisma) => {
    assertMigrationLedger(await readMigrationLedger(prisma), plan.previous, "reviewed baseline")
  })
  const sentinel = input.sentinel ?? createUpgradeSentinel()
  await seedUpgradeSentinel(databasePath, sentinel)
  return { databasePath, sentinel, sourceRoot: prepared.sourceRoot }
}

export async function assertUpgradedDatabase(databasePath, manifest, sentinel) {
  return withPrismaClient(databasePath, async (prisma) => {
    const integrityRows = await prisma.$queryRawUnsafe("PRAGMA integrity_check")
    if (integrityRows.length !== 1 || Object.values(integrityRows[0])[0] !== "ok") {
      fail(`upgraded database integrity check failed: ${JSON.stringify(integrityRows)}`)
    }
    assertMigrationLedger(await readMigrationLedger(prisma), manifest, "upgraded database")
    const threadRows = await prisma.$queryRawUnsafe(
      `SELECT thread_id, created_at, updated_at, metadata, status, title
       FROM threads WHERE thread_id = ?`,
      sentinel.threadId
    )
    if (threadRows.length !== 1) fail("upgraded database lost the pre-upgrade sentinel thread")
    return assertUpgradeSentinelRow(threadRows[0], sentinel, "upgraded database")
  })
}

async function run() {
  const manifest = readMigrationManifest()
  const plan = selectPendingMigrationPlan(manifest, readUpgradeBaseline())
  const workspace = mkdtempSync(join(tmpdir(), "jingle-pending-migration-smoke-"))
  try {
    const jingleHome = join(workspace, "jingle-home")
    const { databasePath, sentinel } = await createPreviousStateDatabase({
      jingleHome,
      plan,
      workspace
    })
    await runLocalCommand(
      process.execPath,
      ["scripts/run-prisma-jingle-db.mjs", "migrate", "deploy"],
      {
        cwd: repoRoot,
        displayName: "Pending Prisma migration deploy",
        env: { ...process.env, JINGLE_HOME: jingleHome }
      }
    )
    await assertUpgradedDatabase(databasePath, manifest, sentinel)
    console.log(
      `pending migration smoke passed: ${plan.pending.length} migration(s) applied over reviewed ${plan.previous.length}-migration baseline with the sentinel thread intact`
    )
  } finally {
    rmSync(workspace, { force: true, recursive: true })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}
