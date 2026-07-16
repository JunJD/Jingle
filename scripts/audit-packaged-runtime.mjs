import { execFileSync } from "node:child_process"
import { existsSync, lstatSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve, sep } from "node:path"

const root = resolve(process.argv[2] ?? "dist")
const forbiddenMacLinkPrefixes = ["/opt/homebrew/", "/usr/local/opt/"]
const requiredExternalPackages = ["@prisma/client", "just-bash"]
const requiredPrismaMigrationNames = readdirSync(resolve("prisma/migrations"), {
  withFileTypes: true
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right))
const forbiddenRuntimePackages = [
  {
    name: "electron",
    reason: "Electron is already the app runtime and must not be copied into packaged node_modules."
  },
  {
    name: "prisma",
    reason: "The Prisma CLI package is build/codegen tooling; packaged runtime should use @prisma/client plus .prisma/client."
  },
  {
    name: "@prisma/engines",
    reason: "Prisma engine tooling should not be packaged as a runtime dependency."
  },
  {
    name: "@mongodb-js/zstd",
    reason: "just-bash native codecs are not enabled in the packaged runtime."
  },
  {
    name: "node-liblzma",
    reason: "just-bash native codecs are not enabled in the packaged runtime."
  }
]
const forbiddenRuntimeFilePatterns = [
  {
    pattern: /(^|[/\\])schema-engine(?:-|$)/,
    reason: "Prisma schema-engine is CLI/codegen tooling and should not be packaged."
  },
  {
    pattern: /\.map$/,
    reason: "Source maps should not be published in packaged runtime artifacts."
  }
]

function collectMatching(start, predicate, matches = []) {
  if (!existsSync(start)) {
    return matches
  }

  const entry = lstatSync(start)
  if (predicate(start, entry)) {
    matches.push(start)
  }

  if (!entry.isDirectory()) {
    return matches
  }

  for (const child of readdirSync(start)) {
    collectMatching(join(start, child), predicate, matches)
  }
  return matches
}

function findPackagedApps() {
  return collectMatching(root, (path, entry) => {
    if (!entry.isDirectory()) {
      return false
    }

    if (path.endsWith(".app")) {
      return existsSync(join(path, "Contents", "Resources", "app.asar"))
    }

    return !path.split(sep).some((part) => part.endsWith(".app")) && existsSync(join(path, "resources", "app.asar"))
  })
    .map((appPath) => {
      const macResourcesPath = join(appPath, "Contents", "Resources")
      if (existsSync(join(macResourcesPath, "app.asar"))) {
        return {
          appPath,
          appAsarPath: join(macResourcesPath, "app.asar"),
          executablePath: findMacAppExecutable(appPath),
          resourcesPath: macResourcesPath
        }
      }

      const resourcesPath = join(appPath, "resources")
      return {
        appPath,
        appAsarPath: join(resourcesPath, "app.asar"),
        executablePath: findRootAppExecutable(appPath),
        resourcesPath
      }
    })
    .sort((left, right) => left.appPath.localeCompare(right.appPath))
}

function findMacAppExecutable(appPath) {
  const macosPath = join(appPath, "Contents", "MacOS")
  if (!existsSync(macosPath)) {
    return null
  }

  for (const child of readdirSync(macosPath).sort()) {
    const childPath = join(macosPath, child)
    if (statSync(childPath).mode & 0o111) {
      return childPath
    }
  }
  return null
}

function selectRootAppExecutableCandidate(candidates) {
  if (candidates.length === 0) {
    return null
  }

  const jingleExecutable = candidates.find((path) =>
    basename(path).toLowerCase().includes("jingle")
  )
  if (jingleExecutable) {
    return jingleExecutable
  }

  if (candidates.length === 1) {
    return candidates[0]
  }

  throw new Error(
    `Could not identify the Jingle app executable. Candidates: ${candidates.join(", ")}`
  )
}

function findRootAppExecutable(appPath) {
  const candidates = []

  for (const child of readdirSync(appPath).sort()) {
    const childPath = join(appPath, child)
    const childStats = statSync(childPath)
    if (!childStats.isFile()) {
      continue
    }

    const lowerName = child.toLowerCase()
    if (process.platform === "win32") {
      if (lowerName.endsWith(".exe") && !lowerName.startsWith("uninstall")) {
        candidates.push(childPath)
      }
      continue
    }

    if ((childStats.mode & 0o111) && lowerName !== "chrome-sandbox") {
      candidates.push(childPath)
    }
  }

  return selectRootAppExecutableCandidate(candidates)
}

function findNativeFiles(resourcesPath) {
  return collectMatching(resourcesPath, (path, entry) => {
    if (entry.isDirectory()) {
      return false
    }

    const name = basename(path)
    if (name.endsWith(".node")) {
      return statSync(path).isFile()
    }

    return path.split(sep).includes("app.asar.unpacked") && Boolean(entry.mode & 0o111) && statSync(path).isFile()
  }).sort()
}

function otoolLinkedLibraries(path) {
  const output = execFileSync("otool", ["-L", path], { encoding: "utf-8" })
  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(" ")[0])
    .filter(Boolean)
}

function assertMacNativeLinks({ resourcesPath }) {
  if (process.platform !== "darwin") {
    return
  }

  const offenders = []

  for (const filePath of findNativeFiles(resourcesPath)) {
    const linkedLibraries = otoolLinkedLibraries(filePath)
    for (const libraryPath of linkedLibraries) {
      if (forbiddenMacLinkPrefixes.some((prefix) => libraryPath.startsWith(prefix))) {
        offenders.push({ filePath, libraryPath })
      }
    }
  }

  if (offenders.length > 0) {
    const details = offenders.map(({ filePath, libraryPath }) => `  ${filePath}\n    -> ${libraryPath}`).join("\n")
    throw new Error(`Packaged native dependency links to a local package-manager path:\n${details}`)
  }
}

function packagePathFragments(packageName) {
  const parts = packageName.split("/")
  if (packageName.startsWith("@")) {
    return parts.slice(0, 2)
  }

  return [parts[0]]
}

function findAsarCli() {
  const asarCliPath = resolve("node_modules/@electron/asar/bin/asar.js")
  if (!existsSync(asarCliPath)) {
    throw new Error(`Could not find @electron/asar CLI: ${asarCliPath}`)
  }

  return asarCliPath
}

function assertForbiddenRuntimeNotPackaged({ appAsarPath, resourcesPath }) {
  const asarCliPath = findAsarCli()

  const asarEntries = execFileSync(process.execPath, [asarCliPath, "list", appAsarPath], {
    encoding: "utf-8",
    maxBuffer: 128 * 1024 * 1024
  }).split("\n")

  for (const { name: packageName, reason } of forbiddenRuntimePackages) {
    const packageParts = packagePathFragments(packageName)
    const packageAsarPrefix = `/node_modules/${packageParts.join("/")}`
    const packagedInAsar = asarEntries.some((entry) => entry === packageAsarPrefix || entry.startsWith(`${packageAsarPrefix}/`))
    if (packagedInAsar) {
      throw new Error(`${packageName} should not be packaged in app.asar. ${reason}`)
    }

    const unpackedPath = join(resourcesPath, "app.asar.unpacked", "node_modules", ...packageParts)
    if (existsSync(unpackedPath)) {
      throw new Error(`${packageName} should not be unpacked: ${unpackedPath}\n${reason}`)
    }
  }

  const unpackedEntries = collectMatching(join(resourcesPath, "app.asar.unpacked"), () => true)
  for (const { pattern, reason } of forbiddenRuntimeFilePatterns) {
    const asarMatch = asarEntries.find((entry) => pattern.test(entry))
    if (asarMatch) {
      throw new Error(`Forbidden packaged runtime file in app.asar: ${asarMatch}\n${reason}`)
    }

    const unpackedMatch = unpackedEntries.find((entry) => pattern.test(entry))
    if (unpackedMatch) {
      throw new Error(`Forbidden unpacked runtime file: ${unpackedMatch}\n${reason}`)
    }
  }
}

function runPackagedRuntimeSmoke({ appAsarPath, appPath, executablePath, resourcesPath }) {
  if (!executablePath) {
    throw new Error(`Could not find packaged app executable in ${appPath}`)
  }

  if (!existsSync(appAsarPath)) {
    throw new Error(`Could not find app.asar in ${appPath}`)
  }

  const smokeHome = mkdtempSync(join(tmpdir(), "jingle-packaged-runtime-"))
  const smokeScript = `
const { execFileSync } = await import("node:child_process")
const { createRequire, builtinModules } = await import("node:module")
const { join, normalize, sep, isAbsolute } = await import("node:path")

const appAsarPath = process.env.JINGLE_PACKAGED_APP_ASAR
const resourcesPath = process.env.JINGLE_PACKAGED_RESOURCES
const requireFromApp = createRequire(join(appAsarPath, "package.json"))
const requireFromSmoke = createRequire(import.meta.url)
const requiredPackages = ${JSON.stringify(requiredExternalPackages)}
const Module = requireFromSmoke("node:module")

function isInside(candidate, parent) {
  const normalizedCandidate = normalize(candidate)
  const normalizedParent = normalize(parent)
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(normalizedParent + sep)
}

function isBuiltinResolvedPath(path) {
  return path.startsWith("node:") || builtinModules.includes(path)
}

const resolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, options) {
  const resolvedPath = resolveFilename.call(this, request, parent, isMain, options)
  if (
    typeof resolvedPath === "string" &&
    !isBuiltinResolvedPath(resolvedPath) &&
    isAbsolute(resolvedPath) &&
    parent?.filename &&
    isInside(parent.filename, resourcesPath) &&
    !isInside(resolvedPath, resourcesPath)
  ) {
    throw new Error(request + " resolved outside packaged resources: " + resolvedPath)
  }
  return resolvedPath
}

for (const packageName of requiredPackages) {
  const resolvedPath = requireFromApp.resolve(packageName)
  if (!isInside(resolvedPath, resourcesPath)) {
    throw new Error(packageName + " resolved outside packaged resources: " + resolvedPath)
  }
  requireFromApp(packageName)
}

const { ripgrepExecutablePath } = requireFromApp("./out/main/ripgrep-executable-audit.js")
const unpackedRoot = join(resourcesPath, "app.asar.unpacked")
if (!isInside(ripgrepExecutablePath, unpackedRoot)) {
  throw new Error("Packaged ripgrep executable resolved outside app.asar.unpacked: " + ripgrepExecutablePath)
}
const ripgrepVersion = execFileSync(ripgrepExecutablePath, ["--version"], { encoding: "utf-8" })
if (!ripgrepVersion.startsWith("ripgrep ")) {
  throw new Error("Packaged ripgrep smoke returned an unexpected version: " + ripgrepVersion)
}

const { Bash } = requireFromApp("just-bash")
const bash = new Bash()
const bashResult = await bash.exec("echo packaged-runtime")
if (bashResult.exitCode !== 0 || bashResult.stdout.trim() !== "packaged-runtime") {
  throw new Error("Packaged just-bash smoke returned an unexpected result.")
}

const { readdirSync } = await import("node:fs")
const { PrismaClient } = requireFromApp("@prisma/client")

const migrationsRoot = join(appAsarPath, "prisma", "migrations")
const migrationNames = readdirSync(migrationsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right))

for (const migrationName of ${JSON.stringify(requiredPrismaMigrationNames)}) {
  if (!migrationNames.includes(migrationName)) {
    throw new Error("Packaged Prisma migration is missing: " + migrationName)
  }
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "file:" + join(process.env.JINGLE_PACKAGED_SMOKE_HOME, "jingle.sqlite")
    }
  }
})

try {
  const { auditDatabaseBootstrap } = requireFromApp("./out/main/database-bootstrap-audit.js")
  await auditDatabaseBootstrap()

  const migrationRows = await prisma.$queryRawUnsafe(
    "SELECT migration_name FROM _prisma_migrations ORDER BY migration_name"
  )
  const appliedMigrationNames = new Set(migrationRows.map((row) => row.migration_name))
  if (appliedMigrationNames.size !== migrationNames.length) {
    throw new Error("Packaged migration count mismatch.")
  }
  for (const migrationName of ${JSON.stringify(requiredPrismaMigrationNames)}) {
    if (!appliedMigrationNames.has(migrationName)) {
      throw new Error("Packaged migration was not applied: " + migrationName)
    }
  }

  const tableRows = await prisma.$queryRawUnsafe(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('threads', 'messages', 'thread_workflows')"
  )
  const tableNames = new Set(tableRows.map((row) => row.name))
  for (const tableName of ["threads", "messages", "thread_workflows"]) {
    if (!tableNames.has(tableName)) {
      throw new Error("Packaged database initialization missed table: " + tableName)
    }
  }
} finally {
  await prisma.$disconnect()
}
`

  try {
    execFileSync(executablePath, ["--input-type=module", "-e", smokeScript], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        JINGLE_HOME: smokeHome,
        JINGLE_PACKAGED_APP_ASAR: appAsarPath,
        JINGLE_PACKAGED_RESOURCES: resourcesPath,
        JINGLE_PACKAGED_SMOKE_HOME: smokeHome
      },
      stdio: "pipe",
      timeout: 120_000
    })
  } finally {
    rmSync(smokeHome, { force: true, recursive: true })
  }
}

const packagedApps = findPackagedApps()
if (packagedApps.length === 0) {
  throw new Error(`No packaged app with resources/app.asar found under ${root}`)
}

for (const packagedApp of packagedApps) {
  assertForbiddenRuntimeNotPackaged(packagedApp)
  assertMacNativeLinks(packagedApp)
  runPackagedRuntimeSmoke(packagedApp)
  console.log(`packaged runtime audit passed: ${packagedApp.appPath}`)
}
