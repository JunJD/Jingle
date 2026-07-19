import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"
import { PrismaClient } from "@prisma/client"

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const GIT_OBJECT_PATTERN = /^[0-9a-f]{40}$/
const baselinePath = fileURLToPath(new URL("./baselines/v0.0.1.json", import.meta.url))

function fail(message) {
  throw new Error(`Release upgrade baseline: ${message}`)
}

function assertExactKeys(value, keys, owner) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${owner} must be an object`)
  }
  const actualKeys = Object.keys(value).sort()
  const expectedKeys = [...keys].sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    fail(`${owner} has invalid keys: ${actualKeys.join(", ")}`)
  }
}

function assertSha256(value, owner) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(`${owner} must be a lowercase SHA-256 digest`)
  }
}

function assertGitObject(value, owner) {
  if (typeof value !== "string" || !GIT_OBJECT_PATTERN.test(value)) {
    fail(`${owner} must be a lowercase 40-character Git object id`)
  }
}

export function readUpgradeBaseline(path = baselinePath) {
  const parsed = JSON.parse(readFileSync(path, "utf8"))
  assertExactKeys(
    parsed,
    [
      "assets",
      "migrations",
      "prismaVersion",
      "repository",
      "sourceCommit",
      "tag",
      "tagObject",
      "version",
      "windowKind"
    ],
    "manifest"
  )
  if (parsed.version !== 1 || parsed.tag !== "v0.0.1") {
    fail("manifest version or release tag is unsupported")
  }
  assertGitObject(parsed.tagObject, "tagObject")
  assertGitObject(parsed.sourceCommit, "sourceCommit")
  if (parsed.repository !== "JunJD/Jingle") {
    fail("repository must be the reviewed public Jingle repository")
  }
  if (parsed.windowKind !== "launcher") {
    fail("v0.0.1 must use its reviewed Launcher window topology")
  }
  if (typeof parsed.prismaVersion !== "string" || parsed.prismaVersion.length === 0) {
    fail("prismaVersion is required")
  }

  assertExactKeys(parsed.assets, ["darwin-arm64", "linux-x64", "win32-x64"], "assets")
  for (const [key, asset] of Object.entries(parsed.assets)) {
    assertExactKeys(asset, ["name", "sha256", "size"], `asset ${key}`)
    if (typeof asset.name !== "string" || asset.name.length === 0) {
      fail(`asset ${key} name is required`)
    }
    assertSha256(asset.sha256, `asset ${key} sha256`)
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
      fail(`asset ${key} size must be a positive integer`)
    }
  }

  if (!Array.isArray(parsed.migrations) || parsed.migrations.length === 0) {
    fail("migrations must be a non-empty array")
  }
  const migrationNames = new Set()
  for (const migration of parsed.migrations) {
    assertExactKeys(migration, ["name", "sha256"], "migration")
    if (typeof migration.name !== "string" || migration.name.length === 0) {
      fail("migration name is required")
    }
    if (migrationNames.has(migration.name)) fail(`duplicate migration ${migration.name}`)
    migrationNames.add(migration.name)
    assertSha256(migration.sha256, `migration ${migration.name} sha256`)
  }
  const sortedNames = [...migrationNames].sort()
  if (JSON.stringify(sortedNames) !== JSON.stringify([...migrationNames])) {
    fail("migrations must be sorted by name")
  }
  return parsed
}

export function selectUpgradeAsset(baseline, platform = process.platform, arch = process.arch) {
  const key = `${platform}-${arch}`
  const asset = baseline.assets[key]
  if (!asset) fail(`v0.0.1 has no reviewed asset for ${key}`)
  return asset
}

export function selectReleaseAssetMetadata(baseline, release, platform, arch) {
  if (
    !release ||
    typeof release !== "object" ||
    release.tag_name !== baseline.tag ||
    release.draft !== false ||
    release.prerelease !== false ||
    !Array.isArray(release.assets)
  ) {
    fail(`GitHub release metadata for ${baseline.tag} is invalid`)
  }
  const expected = selectUpgradeAsset(baseline, platform, arch)
  const matches = release.assets.filter((asset) => asset?.name === expected.name)
  if (matches.length !== 1) {
    fail(`GitHub release must contain exactly one asset named ${expected.name}`)
  }
  const asset = matches[0]
  if (
    asset.size !== expected.size ||
    asset.digest !== `sha256:${expected.sha256}` ||
    typeof asset.url !== "string" ||
    !/^https:\/\/api\.github\.com\/repos\/JunJD\/Jingle\/releases\/assets\/[0-9]+$/.test(asset.url)
  ) {
    fail(`GitHub release asset ${expected.name} does not match the baseline manifest`)
  }
  return { ...expected, apiUrl: asset.url }
}

export function verifyDownloadedUpgradeAsset(path, asset) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    fail(`downloaded asset is missing: ${asset.name}`)
  }
  const size = statSync(path).size
  const sha256 = digestFile(path)
  if (size !== asset.size || sha256 !== asset.sha256) {
    fail(`downloaded asset ${asset.name} failed size or digest verification`)
  }
  return path
}

export async function downloadUpgradeAsset(input) {
  const baseline = input.baseline ?? readUpgradeBaseline(input.baselinePath)
  const repository = input.repository ?? process.env.GITHUB_REPOSITORY
  const token = input.token ?? process.env.GITHUB_TOKEN
  if (repository !== baseline.repository) {
    fail(`GitHub repository ${String(repository)} does not match ${baseline.repository}`)
  }
  if (typeof token !== "string" || token.length === 0) {
    fail("GITHUB_TOKEN is required to download the reviewed release asset")
  }
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "Jingle-release-upgrade-smoke",
    "X-GitHub-Api-Version": "2022-11-28"
  }
  const releaseResponse = await fetch(
    `https://api.github.com/repos/${baseline.repository}/releases/tags/${baseline.tag}`,
    { headers, signal: AbortSignal.timeout(120_000) }
  )
  if (!releaseResponse.ok) {
    fail(`GitHub release metadata request failed with status ${releaseResponse.status}`)
  }
  const release = await releaseResponse.json()
  const asset = selectReleaseAssetMetadata(
    baseline,
    release,
    input.platform ?? process.platform,
    input.arch ?? process.arch
  )
  const outputRoot = resolve(input.outputRoot)
  if (!lstatSync(outputRoot).isDirectory()) {
    fail("upgrade asset output root must be an existing directory")
  }
  const outputPath = join(outputRoot, asset.name)
  if (pathEntryExists(outputPath)) {
    fail(`upgrade asset output already exists: ${asset.name}`)
  }
  const assetResponse = await fetch(asset.apiUrl, {
    headers: { ...headers, Accept: "application/octet-stream" },
    redirect: "follow",
    signal: AbortSignal.timeout(300_000)
  })
  if (!assetResponse.ok || !assetResponse.body) {
    fail(`GitHub release asset request failed with status ${assetResponse.status}`)
  }
  const hash = createHash("sha256")
  let size = 0
  const verifier = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      size += chunk.length
      callback(null, chunk)
    }
  })
  try {
    await pipeline(
      Readable.fromWeb(assetResponse.body),
      verifier,
      createWriteStream(outputPath, { flags: "wx", mode: 0o600 })
    )
    const sha256 = hash.digest("hex")
    if (size !== asset.size || sha256 !== asset.sha256) {
      fail(`downloaded asset ${asset.name} failed size or digest verification`)
    }
    return { asset, path: outputPath }
  } catch (error) {
    rmSync(outputPath, { force: true })
    throw error
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true
    })
    const stderrChunks = []
    const stdoutChunks = []
    child.stdout?.on("data", (chunk) => {
      stdoutChunks.push(chunk)
    })
    child.stderr?.on("data", (chunk) => {
      stderrChunks.push(chunk)
    })
    child.once("error", reject)
    child.once("close", (code, signal) => {
      if (code === 0) {
        const stdout = Buffer.concat(stdoutChunks)
        resolvePromise(options.bufferOutput ? stdout : stdout.toString("utf8").trim())
        return
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim()
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim()
      const detail = stderr || stdout
      reject(
        new Error(
          `${basename(command)} exited with code ${String(code)} signal ${String(signal)}${detail ? `: ${detail}` : ""}`
        )
      )
    })
  })
}

function runGit(repositoryRoot, args, options = {}) {
  return runCommand("git", args, {
    ...options,
    cwd: repositoryRoot,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" }
  })
}

async function materializeRawGitFiles(repositoryRoot, sourceCommit, sourceRoot) {
  const treeOutput = await runGit(
    repositoryRoot,
    [
      "ls-tree",
      "-r",
      "-z",
      "--full-tree",
      sourceCommit,
      "--",
      "prisma",
      "prisma.config.ts",
      "scripts/run-prisma-jingle-db.mjs",
      "scripts/lib/run-local-command.mjs"
    ],
    { bufferOutput: true }
  )
  const entries = treeOutput
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(entry)
      if (!match) fail(`pinned source contains an unsupported tree entry: ${entry}`)
      return { mode: match[1], objectId: match[2], path: match[3] }
    })
  const requiredPaths = new Set([
    "prisma.config.ts",
    "prisma/schema.prisma",
    "prisma/migrations/migration_lock.toml",
    "scripts/run-prisma-jingle-db.mjs",
    "scripts/lib/run-local-command.mjs"
  ])
  for (const entry of entries) {
    requiredPaths.delete(entry.path)
    const outputPath = join(sourceRoot, ...entry.path.split("/"))
    mkdirSync(dirname(outputPath), { recursive: true })
    const content = await runGit(repositoryRoot, ["cat-file", "blob", entry.objectId], {
      bufferOutput: true
    })
    writeFileSync(outputPath, content, { mode: entry.mode === "100755" ? 0o755 : 0o644 })
  }
  if (requiredPaths.size > 0) {
    fail(`pinned source is missing required files: ${[...requiredPaths].join(", ")}`)
  }
}

function pathEntryExists(path) {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if (error?.code === "ENOENT") return false
    throw error
  }
}

async function assertGitBaselineIdentity(repositoryRoot, baseline) {
  const tagType = await runGit(repositoryRoot, ["cat-file", "-t", baseline.tagObject])
  if (tagType !== "tag") fail(`tag object ${baseline.tagObject} is not an annotated tag`)
  const tagCommit = await runGit(repositoryRoot, ["rev-parse", `${baseline.tagObject}^{commit}`])
  if (tagCommit !== baseline.sourceCommit) {
    fail(`tag object resolves to ${tagCommit}, expected ${baseline.sourceCommit}`)
  }
  const localTagObject = await runGit(repositoryRoot, ["rev-parse", `refs/tags/${baseline.tag}`])
  if (localTagObject !== baseline.tagObject) {
    fail(`local ${baseline.tag} ref resolves to ${localTagObject}, expected ${baseline.tagObject}`)
  }
}

function digestFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function assertMaterializedMigrations(sourceRoot, baseline) {
  const migrationsRoot = join(sourceRoot, "prisma", "migrations")
  const actualNames = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const expectedNames = baseline.migrations.map((migration) => migration.name)
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    fail(`materialized migration set differs: ${actualNames.join(", ")}`)
  }
  for (const migration of baseline.migrations) {
    const path = join(migrationsRoot, migration.name, "migration.sql")
    if (!existsSync(path) || !statSync(path).isFile()) {
      fail(`materialized migration SQL is missing: ${migration.name}`)
    }
    const digest = digestFile(path)
    if (digest !== migration.sha256) {
      fail(`materialized migration ${migration.name} has digest ${digest}`)
    }
  }
}

async function materializeBaselineSource(input) {
  const { baseline, dependencyRoot, repositoryRoot, workspace } = input
  await assertGitBaselineIdentity(repositoryRoot, baseline)
  const sourceRoot = join(workspace, "source")
  if (pathEntryExists(sourceRoot)) {
    fail("baseline source workspace must not contain a prior source tree")
  }
  mkdirSync(sourceRoot, { recursive: true })
  await materializeRawGitFiles(repositoryRoot, baseline.sourceCommit, sourceRoot)
  assertMaterializedMigrations(sourceRoot, baseline)

  const installedPrismaVersion = JSON.parse(
    readFileSync(join(dependencyRoot, "node_modules", "prisma", "package.json"), "utf8")
  ).version
  if (installedPrismaVersion !== baseline.prismaVersion) {
    fail(`Prisma ${installedPrismaVersion} cannot materialize baseline ${baseline.prismaVersion}`)
  }
  symlinkSync(
    join(dependencyRoot, "node_modules"),
    join(sourceRoot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir"
  )
  return sourceRoot
}

async function verifyBaselineDatabase(jingleHome, baseline) {
  const databasePath = join(jingleHome, "jingle.sqlite")
  if (!existsSync(databasePath)) fail("Prisma did not create the baseline database")
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  try {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name"
    )
    const expected = baseline.migrations.map((migration) => [migration.name, migration.sha256])
    const actual = rows.map((row) => [row.migration_name, row.checksum])
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail("baseline database migration ledger differs from the manifest")
    }
    if (rows.some((row) => !row.finished_at || row.rolled_back_at)) {
      fail("baseline database contains an incomplete or rolled-back migration")
    }
    const threadRows = await prisma.$queryRawUnsafe("SELECT COUNT(*) AS count FROM threads")
    if (Number(threadRows[0]?.count) !== 0) {
      fail("baseline preparation must not seed product thread data")
    }
  } finally {
    await prisma.$disconnect()
  }
  return databasePath
}

export async function prepareUpgradeBaseline(input) {
  const baseline = readUpgradeBaseline(input.baselinePath)
  const repositoryRoot = resolve(input.repositoryRoot)
  const dependencyRoot = resolve(input.dependencyRoot ?? repositoryRoot)
  const workspace = resolve(input.workspace)
  const jingleHome = resolve(input.jingleHome)
  const workspaceEntry = lstatSync(workspace)
  if (!workspaceEntry.isDirectory() || workspaceEntry.isSymbolicLink()) {
    fail("workspace must be an existing, non-symlink directory")
  }
  const temporaryRoot = realpathSync(tmpdir())
  const realWorkspace = realpathSync(workspace)
  const relativeWorkspace = relative(temporaryRoot, realWorkspace)
  if (
    relativeWorkspace.length === 0 ||
    relativeWorkspace === ".." ||
    relativeWorkspace.startsWith(`..${sep}`) ||
    isAbsolute(relativeWorkspace)
  ) {
    fail("workspace must be an isolated child of the operating system temporary directory")
  }
  if (dirname(jingleHome) !== workspace) {
    fail("jingleHome must be a direct child of the isolated workspace")
  }
  if (pathEntryExists(jingleHome)) {
    fail("jingleHome must not exist before baseline preparation")
  }
  mkdirSync(jingleHome)
  const sourceRoot = await materializeBaselineSource({
    baseline,
    dependencyRoot,
    repositoryRoot,
    workspace
  })
  await runCommand(process.execPath, ["scripts/run-prisma-jingle-db.mjs", "migrate", "deploy"], {
    cwd: sourceRoot,
    env: { ...process.env, JINGLE_HOME: jingleHome }
  })
  const databasePath = await verifyBaselineDatabase(jingleHome, baseline)
  return { baseline, databasePath, sourceRoot }
}
