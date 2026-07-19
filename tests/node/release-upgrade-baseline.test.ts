import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
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
    baseline: { migrations: unknown[]; repository: string; sourceCommit: string; tagObject: string }
    databasePath: string
    sourceRoot: string
  }>
  readUpgradeBaseline(): {
    assets: Record<string, { name: string; sha256: string; size: number }>
    migrations: unknown[]
    repository: string
    tag: string
    windowKind: "launcher"
  }
  selectReleaseAssetMetadata(
    baseline: {
      assets: Record<string, { name: string; sha256: string; size: number }>
      tag: string
    },
    release: unknown,
    platform: string,
    arch: string
  ): { apiUrl: string; name: string; sha256: string; size: number }
  selectUpgradeAsset(
    baseline: { assets: Record<string, unknown> },
    platform: string,
    arch: string
  ): unknown
  verifyDownloadedUpgradeAsset(
    path: string,
    asset: { name: string; sha256: string; size: number }
  ): string
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
  assert.equal(baseline.repository, "JunJD/Jingle")
  assert.equal(baseline.windowKind, "launcher")
  assert.equal(
    baselineModule.selectUpgradeAsset(baseline, "darwin", "arm64"),
    baseline.assets["darwin-arm64"]
  )
  assert.throws(
    () => baselineModule.selectUpgradeAsset(baseline, "darwin", "x64"),
    /no reviewed asset/
  )
})

test("binds the public release asset API response to the reviewed name, size, and digest", async () => {
  const baselineModule = await baselineModulePromise
  const baseline = baselineModule.readUpgradeBaseline()
  const expected = baseline.assets["linux-x64"]
  const release = {
    assets: [
      {
        digest: `sha256:${expected.sha256}`,
        name: expected.name,
        size: expected.size,
        url: "https://api.github.com/repos/JunJD/Jingle/releases/assets/123456"
      }
    ],
    draft: false,
    prerelease: false,
    tag_name: baseline.tag
  }

  assert.deepEqual(baselineModule.selectReleaseAssetMetadata(baseline, release, "linux", "x64"), {
    ...expected,
    apiUrl: release.assets[0].url
  })
  assert.throws(
    () =>
      baselineModule.selectReleaseAssetMetadata(
        baseline,
        {
          ...release,
          assets: [{ ...release.assets[0], digest: `sha256:${"0".repeat(64)}` }]
        },
        "linux",
        "x64"
      ),
    /does not match/
  )
  assert.throws(
    () =>
      baselineModule.selectReleaseAssetMetadata(
        baseline,
        { ...release, assets: [...release.assets, release.assets[0]] },
        "linux",
        "x64"
      ),
    /exactly one asset/
  )
  assert.throws(
    () => baselineModule.selectReleaseAssetMetadata(baseline, release, "linux", "arm64"),
    /no reviewed asset/
  )
})

test("verifies downloaded upgrade bytes against the reviewed size and digest", async () => {
  const baselineModule = await baselineModulePromise
  const workspace = mkdtempSync(join(tmpdir(), "jingle-v001-upgrade-asset-"))
  const path = join(workspace, "reviewed.bin")
  try {
    const bytes = Buffer.from("reviewed v0.0.1 release bytes")
    writeFileSync(path, bytes)
    const asset = {
      name: "reviewed.bin",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length
    }
    assert.equal(baselineModule.verifyDownloadedUpgradeAsset(path, asset), path)
    assert.throws(
      () => baselineModule.verifyDownloadedUpgradeAsset(path, { ...asset, size: asset.size + 1 }),
      /failed size or digest verification/
    )
    assert.throws(
      () =>
        baselineModule.verifyDownloadedUpgradeAsset(path, {
          ...asset,
          sha256: "0".repeat(64)
        }),
      /failed size or digest verification/
    )
  } finally {
    rmSync(workspace, { force: true, recursive: true })
  }
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
