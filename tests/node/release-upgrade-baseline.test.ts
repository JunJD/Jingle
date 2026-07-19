import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"
import { promisify } from "node:util"
import { PrismaClient } from "@prisma/client"

interface UpgradeBaselineModule {
  prepareUpgradeBaseline(input: {
    dependencyRoot?: string
    jingleHome: string
    repositoryRoot: string
    workspace: string
  }): Promise<{
    baseline: { migrations: unknown[]; sourceCommit: string; tagObject: string }
    databasePath: string
    sourceRoot: string
  }>
  readUpgradeBaseline(): {
    assets: Record<string, { name: string; sha256: string; size: number }>
    migrations: unknown[]
  }
  selectUpgradeAsset(
    baseline: { assets: Record<string, unknown> },
    platform: string,
    arch: string
  ): unknown
}

const moduleUrl = pathToFileURL(
  join(process.cwd(), "scripts/release-smoke/upgrade-baseline.mjs")
).href
const baselineModulePromise = import(moduleUrl) as Promise<UpgradeBaselineModule>
const execFileAsync = promisify(execFile)

test("pins the reviewed v0.0.1 assets and rejects an unreviewed architecture", async () => {
  const baselineModule = await baselineModulePromise
  const baseline = baselineModule.readUpgradeBaseline()

  assert.deepEqual(Object.keys(baseline.assets).sort(), ["darwin-arm64", "linux-x64", "win32-x64"])
  assert.equal(
    baselineModule.selectUpgradeAsset(baseline, "darwin", "arm64"),
    baseline.assets["darwin-arm64"]
  )
  assert.throws(
    () => baselineModule.selectUpgradeAsset(baseline, "darwin", "x64"),
    /no reviewed asset/
  )
})

test("materializes the exact tag migrations into an isolated empty database", async () => {
  const baselineModule = await baselineModulePromise
  const workspace = mkdtempSync(join(tmpdir(), "jingle-v001-upgrade-baseline-"))
  const jingleHome = join(workspace, "jingle-home")
  const repositoryRoot = join(workspace, "repository")
  try {
    await execFileAsync("git", [
      "clone",
      "--shared",
      "--no-checkout",
      process.cwd(),
      repositoryRoot
    ])
    await execFileAsync("git", [
      "-C",
      repositoryRoot,
      "replace",
      "12bc226bcc506dc412f114cee68f7d1692364962",
      "HEAD"
    ])
    writeFileSync(
      join(repositoryRoot, ".git", "info", "attributes"),
      "prisma.config.ts export-ignore\n"
    )
    const result = await baselineModule.prepareUpgradeBaseline({
      dependencyRoot: process.cwd(),
      jingleHome,
      repositoryRoot,
      workspace
    })

    assert.equal(result.baseline.tagObject, "01fdb3ab2b1100e11c00925d4a72ab058d4fb746")
    assert.equal(result.baseline.sourceCommit, "12bc226bcc506dc412f114cee68f7d1692364962")
    assert.equal(result.baseline.migrations.length, 13)
    assert.ok(existsSync(result.databasePath))
    assert.ok(existsSync(join(result.sourceRoot, "prisma", "schema.prisma")))

    await execFileAsync(
      process.execPath,
      ["scripts/run-prisma-jingle-db.mjs", "migrate", "deploy"],
      {
        cwd: process.cwd(),
        env: { ...process.env, JINGLE_HOME: jingleHome }
      }
    )
    const expectedCurrentMigrations = readdirSync(join(process.cwd(), "prisma", "migrations"), {
      withFileTypes: true
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    const prisma = new PrismaClient({
      datasources: { db: { url: `file:${result.databasePath.replaceAll("\\", "/")}` } }
    })
    try {
      const migrationRows = (await prisma.$queryRawUnsafe(
        "SELECT migration_name FROM _prisma_migrations ORDER BY migration_name"
      )) as Array<{ migration_name: string }>
      assert.deepEqual(
        migrationRows.map((row) => row.migration_name),
        expectedCurrentMigrations
      )
      const threadRows = (await prisma.$queryRawUnsafe(
        "SELECT COUNT(*) AS count FROM threads"
      )) as Array<{ count: bigint }>
      assert.equal(Number(threadRows[0]?.count), 0)
    } finally {
      await prisma.$disconnect()
    }
  } finally {
    rmSync(workspace, { force: true, recursive: true })
  }
})

test("refuses to prepare product data outside the isolated workspace", async () => {
  const baselineModule = await baselineModulePromise
  const workspace = mkdtempSync(join(tmpdir(), "jingle-v001-upgrade-boundary-"))
  const outsideHome = join(tmpdir(), `not-the-release-workspace-${Date.now()}`)

  try {
    await assert.rejects(
      baselineModule.prepareUpgradeBaseline({
        jingleHome: outsideHome,
        repositoryRoot: process.cwd(),
        workspace
      }),
      /direct child of the isolated workspace/
    )
    assert.equal(existsSync(outsideHome), false)

    await assert.rejects(
      baselineModule.prepareUpgradeBaseline({
        jingleHome: join(process.cwd(), "release-baseline-home"),
        repositoryRoot: process.cwd(),
        workspace: process.cwd()
      }),
      /operating system temporary directory/
    )
    assert.equal(existsSync(join(process.cwd(), "release-baseline-home")), false)
  } finally {
    rmSync(workspace, { force: true, recursive: true })
  }
})
