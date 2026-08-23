import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"

interface MigrationEntry {
  checksum: string
  name: string
}

interface UpgradeSentinel {
  createdAt: number
  metadata: string
  status: string
  threadId: string
  title: string
  token: string
  updatedAt: number
}

interface PendingMigrationPlan {
  pending: MigrationEntry[]
  previous: MigrationEntry[]
}

interface MigrationManifestModule {
  readMigrationManifest(migrationsRoot?: string): MigrationEntry[]
  repoMigrationsRoot: string
}

interface PendingMigrationsModule {
  assertMigrationLedger(rows: unknown, expected: MigrationEntry[], owner: string): unknown
  assertReleasedMigrationsUnchanged(
    manifest: MigrationEntry[],
    baseline: { migrations: Array<{ name: string; sha256: string }>; tag: string }
  ): string[]
  assertUpgradeSentinelRow(row: unknown, sentinel: UpgradeSentinel, owner: string): unknown
  assertUpgradedDatabase(
    databasePath: string,
    manifest: MigrationEntry[],
    sentinel: UpgradeSentinel
  ): Promise<unknown>
  createPreviousStateDatabase(input: {
    jingleHome: string
    plan: PendingMigrationPlan
    sentinel?: UpgradeSentinel
    workspace: string
  }): Promise<{ databasePath: string; sentinel: UpgradeSentinel; sourceRoot: string }>
  createUpgradeSentinel(token?: string): UpgradeSentinel
  selectPendingMigrationPlan(
    manifest: MigrationEntry[],
    baseline: { migrations: Array<{ name: string; sha256: string }>; tag: string }
  ): PendingMigrationPlan
}

function moduleUrlFor(relativePath: string): string {
  return pathToFileURL(join(process.cwd(), relativePath)).href
}

const manifestModulePromise = import(
  moduleUrlFor("scripts/release-smoke/migration-manifest.mjs")
) as Promise<MigrationManifestModule>
const smokeModulePromise = import(
  moduleUrlFor("scripts/release-smoke/pending-migrations.mjs")
) as Promise<PendingMigrationsModule>

const originalJingleHome = process.env.JINGLE_HOME
let workspace = ""

test.before(() => {
  workspace = mkdtempSync(join(tmpdir(), "jingle-pending-migration-test-"))
  process.env.JINGLE_HOME = join(workspace, "jingle-home")
})

test.after(async () => {
  const { closeDatabase } = await import("../../src/main/db")
  await closeDatabase()

  if (originalJingleHome === undefined) {
    delete process.env.JINGLE_HOME
  } else {
    process.env.JINGLE_HOME = originalJingleHome
  }

  rmSync(workspace, { force: true, recursive: true })
})

function writeMigration(migrationsRoot: string, name: string, sql: string): MigrationEntry {
  mkdirSync(join(migrationsRoot, name), { recursive: true })
  writeFileSync(join(migrationsRoot, name, "migration.sql"), sql)
  return { checksum: createHash("sha256").update(sql).digest("hex"), name }
}

function ledgerRow(migration: MigrationEntry): Record<string, unknown> {
  return {
    checksum: migration.checksum,
    finished_at: new Date(0),
    migration_name: migration.name,
    rolled_back_at: null
  }
}

test("reads one sorted migration manifest that matches the checked-in SQL", async () => {
  const manifestModule = await manifestModulePromise
  const root = mkdtempSync(join(tmpdir(), "jingle-migration-manifest-"))
  try {
    const second = writeMigration(root, "20260202000000_second", 'ALTER TABLE "threads";\n')
    const first = writeMigration(root, "20260101000000_first", 'CREATE TABLE "threads";\n')
    writeFileSync(join(root, "migration_lock.toml"), 'provider = "sqlite"\n')

    assert.deepEqual(manifestModule.readMigrationManifest(root), [first, second])

    const missingSqlRoot = join(root, "20260303000000_without_sql")
    mkdirSync(missingSqlRoot)
    assert.throws(() => manifestModule.readMigrationManifest(root), /migration SQL is missing/)
    rmSync(missingSqlRoot, { recursive: true })

    writeMigration(root, "20260404000000_windows_checkout", "SELECT 1;\r\n")
    assert.throws(() => manifestModule.readMigrationManifest(root), /canonical LF line endings/)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test("pins packaged Prisma migration SQL to LF on every Git checkout", () => {
  assert.match(
    readFileSync(join(process.cwd(), ".gitattributes"), "utf8"),
    /^prisma\/migrations\/\*\*\/migration\.sql text eol=lf$/m
  )
})

test("keeps the complete suffix after the reviewed release pending", async () => {
  const smokeModule = await smokeModulePromise
  const manifest: MigrationEntry[] = [
    { checksum: "a".repeat(64), name: "20260101000000_first" },
    { checksum: "b".repeat(64), name: "20260202000000_second" },
    { checksum: "c".repeat(64), name: "20260303000000_third" }
  ]

  const plan = smokeModule.selectPendingMigrationPlan(manifest, {
    migrations: [{ name: manifest[0].name, sha256: manifest[0].checksum }],
    tag: "v0.0.1"
  })
  assert.deepEqual(
    plan.pending.map((migration) => migration.name),
    ["20260202000000_second", "20260303000000_third"]
  )
  assert.deepEqual(
    plan.previous.map((migration) => migration.name),
    ["20260101000000_first"]
  )
  assert.throws(
    () =>
      smokeModule.selectPendingMigrationPlan(manifest.slice(0, 1), {
        migrations: [{ name: manifest[0].name, sha256: manifest[0].checksum }],
        tag: "v0.0.1"
      }),
    /no pending migration/
  )
})

test("holds the released migrations of this checkout byte-identical and in order", async () => {
  const manifestModule = await manifestModulePromise
  const smokeModule = await smokeModulePromise
  const baselineModule = (await import(
    moduleUrlFor("scripts/release-smoke/upgrade-baseline.mjs")
  )) as {
    readUpgradeBaseline(): { migrations: Array<{ name: string; sha256: string }>; tag: string }
  }
  const baseline = baselineModule.readUpgradeBaseline()
  const manifest = manifestModule.readMigrationManifest()

  assert.deepEqual(
    smokeModule.assertReleasedMigrationsUnchanged(manifest, baseline),
    baseline.migrations.map((migration) => migration.name)
  )
  assert.throws(
    () =>
      smokeModule.assertReleasedMigrationsUnchanged(
        manifest.map((migration) =>
          migration.name === baseline.migrations[0].name
            ? { checksum: "0".repeat(64), name: migration.name }
            : migration
        ),
        baseline
      ),
    /must stay byte-identical/
  )
  assert.throws(
    () =>
      smokeModule.assertReleasedMigrationsUnchanged(
        [{ checksum: "0".repeat(64), name: "20250101000000_backdated" }, ...manifest],
        baseline
      ),
    /leading ordered prefix/
  )
})

test("rejects a ledger that is short, drifted, or left unfinished", async () => {
  const smokeModule = await smokeModulePromise
  const previous: MigrationEntry = { checksum: "a".repeat(64), name: "20260101000000_first" }
  const pending: MigrationEntry = { checksum: "b".repeat(64), name: "20260202000000_second" }
  const expected = [previous, pending]

  assert.deepEqual(
    smokeModule.assertMigrationLedger(expected.map(ledgerRow), expected, "upgraded database"),
    expected
  )
  assert.throws(
    () => smokeModule.assertMigrationLedger([ledgerRow(previous)], expected, "upgraded database"),
    /does not match this checkout/
  )
  assert.throws(
    () =>
      smokeModule.assertMigrationLedger(
        [ledgerRow(previous), { ...ledgerRow(pending), checksum: "c".repeat(64) }],
        expected,
        "upgraded database"
      ),
    /does not match this checkout/
  )
  assert.throws(
    () =>
      smokeModule.assertMigrationLedger(
        [ledgerRow(previous), { ...ledgerRow(pending), finished_at: null }],
        expected,
        "upgraded database"
      ),
    /incomplete or rolled-back migration/
  )
  assert.throws(
    () =>
      smokeModule.assertMigrationLedger(
        [ledgerRow(previous), { ...ledgerRow(pending), rolled_back_at: new Date(0) }],
        expected,
        "upgraded database"
      ),
    /incomplete or rolled-back migration/
  )
})

test("compares the sentinel row through the BigInt columns SQLite returns", async () => {
  const smokeModule = await smokeModulePromise
  const sentinel = smokeModule.createUpgradeSentinel("fixed-token")
  const row = {
    created_at: BigInt(sentinel.createdAt),
    metadata: sentinel.metadata,
    status: sentinel.status,
    thread_id: sentinel.threadId,
    title: sentinel.title,
    updated_at: BigInt(sentinel.updatedAt)
  }

  assert.equal(
    (smokeModule.assertUpgradeSentinelRow(row, sentinel, "upgraded database") as { title: string })
      .title,
    sentinel.title
  )
  assert.throws(
    () =>
      smokeModule.assertUpgradeSentinelRow(
        { ...row, title: "rewritten" },
        sentinel,
        "upgraded database"
      ),
    /rewrote the upgrade sentinel thread/
  )
  assert.throws(
    () =>
      smokeModule.assertUpgradeSentinelRow(
        { ...row, metadata: null },
        sentinel,
        "upgraded database"
      ),
    /rewrote the upgrade sentinel thread/
  )
  assert.throws(
    () => smokeModule.assertUpgradeSentinelRow(null, sentinel, "upgraded database"),
    /lost the pre-upgrade sentinel thread/
  )
})

// The packaged upgrade smoke proves this through an installed build. Locally the
// main process applies the same pending migrations to the same previous-state
// database, so a migration that cannot be applied over existing rows fails here
// instead of at release time.
test("upgrades a previous-state database through the main process and keeps its rows", async () => {
  const manifestModule = await manifestModulePromise
  const smokeModule = await smokeModulePromise
  const manifest = manifestModule.readMigrationManifest()
  const baselineModule = (await import(
    moduleUrlFor("scripts/release-smoke/upgrade-baseline.mjs")
  )) as {
    readUpgradeBaseline(): {
      migrations: Array<{ name: string; sha256: string }>
      tag: string
    }
  }
  const plan = smokeModule.selectPendingMigrationPlan(
    manifest,
    baselineModule.readUpgradeBaseline()
  )
  const jingleHome = process.env.JINGLE_HOME as string

  const { databasePath, sentinel, sourceRoot } = await smokeModule.createPreviousStateDatabase({
    jingleHome,
    plan,
    workspace
  })
  assert.equal(databasePath, join(jingleHome, "jingle.sqlite"))
  assert.ok(existsSync(join(sourceRoot, "prisma", "schema.prisma")))
  assert.deepEqual(
    readdirSync(join(sourceRoot, "prisma", "migrations"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(),
    plan.previous.map((migration) => migration.name)
  )

  const { initializeDatabase } = await import("../../src/main/db")
  await initializeDatabase()

  assert.deepEqual(await smokeModule.assertUpgradedDatabase(databasePath, manifest, sentinel), {
    createdAt: String(sentinel.createdAt),
    metadata: sentinel.metadata,
    status: sentinel.status,
    threadId: sentinel.threadId,
    title: sentinel.title,
    updatedAt: String(sentinel.updatedAt)
  })
})
