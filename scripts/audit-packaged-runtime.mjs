import { execFileSync } from "node:child_process"
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(process.argv[2] ?? "dist")
const forbiddenMacLinkPrefixes = ["/opt/homebrew/", "/usr/local/opt/"]
const machOMagicHexValues = new Set([
  "cafebabe",
  "cafebabf",
  "cefaedfe",
  "cffaedfe",
  "bebafeca",
  "bfbafeca",
  "feedface",
  "feedfacf"
])
const supportedRuntimeArchitectures = new Set(["arm64", "x64"])
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

function hasNativeFileExtension(path) {
  const name = basename(path).toLowerCase()
  return (
    name.endsWith(".node") ||
    name.endsWith(".exe") ||
    name.endsWith(".dll") ||
    name.endsWith(".dylib") ||
    name.endsWith(".so") ||
    name.includes(".so.")
  )
}

function findNativeFiles(resourcesPath) {
  return collectMatching(resourcesPath, (path, entry) => {
    if (entry.isDirectory()) {
      return false
    }

    if (basename(path).toLowerCase().endsWith(".node")) {
      return statSync(path).isFile()
    }

    return (
      path.split(sep).includes("app.asar.unpacked") &&
      (hasNativeFileExtension(path) || Boolean(entry.mode & 0o111)) &&
      statSync(path).isFile()
    )
  }).sort()
}

function isMachOFile(path) {
  const file = openSync(path, "r")
  const header = Buffer.alloc(4)
  try {
    const bytesRead = readSync(file, header, 0, header.length, 0)
    return bytesRead === header.length && machOMagicHexValues.has(header.toString("hex"))
  } finally {
    closeSync(file)
  }
}

function readBinaryHeader(path, maximumBytes = 4096) {
  const file = openSync(path, "r")
  const header = Buffer.alloc(Math.min(statSync(path).size, maximumBytes))
  try {
    const bytesRead = readSync(file, header, 0, header.length, 0)
    return header.subarray(0, bytesRead)
  } finally {
    closeSync(file)
  }
}

function readUnsigned(buffer, offset, bytes, littleEndian) {
  if (offset + bytes > buffer.length) {
    throw new Error("Native binary header is truncated.")
  }
  if (bytes === 2) {
    return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset)
  }
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset)
}

function architectureFromCpuType(cpuType) {
  switch (cpuType) {
    case 0x0100000c:
      return "arm64"
    case 0x01000007:
      return "x64"
    default:
      return `cpu-0x${cpuType.toString(16)}`
  }
}

function readMachOArchitectures(buffer, magic) {
  const isFat =
    magic === "cafebabe" || magic === "bebafeca" || magic === "cafebabf" || magic === "bfbafeca"
  const littleEndian =
    magic === "cefaedfe" || magic === "cffaedfe" || magic === "bebafeca" || magic === "bfbafeca"
  if (!isFat) {
    return [architectureFromCpuType(readUnsigned(buffer, 4, 4, littleEndian))]
  }

  const isFat64 = magic === "cafebabf" || magic === "bfbafeca"
  const architectureCount = readUnsigned(buffer, 4, 4, littleEndian)
  if (architectureCount < 1 || architectureCount > 32) {
    throw new Error(`Native Mach-O has invalid architecture count ${architectureCount}.`)
  }
  const entrySize = isFat64 ? 32 : 20
  const architectures = []
  for (let index = 0; index < architectureCount; index += 1) {
    const entryOffset = 8 + index * entrySize
    architectures.push(architectureFromCpuType(readUnsigned(buffer, entryOffset, 4, littleEndian)))
  }
  return architectures
}

export function readNativeBinaryDescriptor(path) {
  const header = readBinaryHeader(path)
  const magic = header.subarray(0, 4).toString("hex")
  if (machOMagicHexValues.has(magic)) {
    return { architectures: readMachOArchitectures(header, magic), format: "mach-o" }
  }

  if (magic === "7f454c46") {
    if (header.length < 20 || (header[5] !== 1 && header[5] !== 2)) {
      throw new Error(`Native ELF header is malformed: ${path}`)
    }
    const machine = readUnsigned(header, 18, 2, header[5] === 1)
    const architecture =
      machine === 0xb7 ? "arm64" : machine === 0x3e ? "x64" : `machine-0x${machine.toString(16)}`
    return { architectures: [architecture], format: "elf" }
  }

  if (header.subarray(0, 2).toString("ascii") === "MZ") {
    if (header.length < 64) {
      throw new Error(`Native PE header is malformed: ${path}`)
    }
    const peOffset = header.readUInt32LE(0x3c)
    if (
      peOffset + 6 > header.length ||
      header.subarray(peOffset, peOffset + 4).toString("hex") !== "50450000"
    ) {
      throw new Error(`Native PE header is malformed: ${path}`)
    }
    const machine = header.readUInt16LE(peOffset + 4)
    const architecture =
      machine === 0xaa64
        ? "arm64"
        : machine === 0x8664
          ? "x64"
          : `machine-0x${machine.toString(16)}`
    return { architectures: [architecture], format: "pe" }
  }

  return null
}

function expectedNativeFormat(platform) {
  switch (platform) {
    case "darwin":
      return "mach-o"
    case "linux":
      return "elf"
    case "win32":
      return "pe"
    default:
      throw new Error(`Unsupported packaged runtime platform: ${platform}`)
  }
}

const computerUseHelperNames = {
  darwin: "jingle-computer-use-macos",
  linux: "jingle-computer-use-linux.py",
  win32: "jingle-computer-use-windows.ps1"
}

export function assertPackagedComputerUseHelper(
  { resourcesPath },
  {
    expectedArchitecture = process.env.JINGLE_BUILD_TARGET_ARCH ?? process.arch,
    platform = process.platform,
    readDescriptor = readNativeBinaryDescriptor
  } = {}
) {
  const helperName = computerUseHelperNames[platform]
  if (!helperName) {
    throw new Error(`Unsupported packaged runtime platform: ${platform}`)
  }

  const helperPath = join(resourcesPath, "app.asar.unpacked", "out", "native", helperName)
  if (!existsSync(helperPath) || !statSync(helperPath).isFile()) {
    throw new Error(`Packaged Computer Use helper is missing: ${helperPath}`)
  }

  const helperStats = statSync(helperPath)
  if (helperStats.size === 0) {
    throw new Error(`Packaged Computer Use helper is empty: ${helperPath}`)
  }

  if (platform === "darwin") {
    if (!(helperStats.mode & 0o111)) {
      throw new Error(`Packaged Computer Use helper is not executable: ${helperPath}`)
    }
    const descriptor = readDescriptor(helperPath)
    if (
      !descriptor ||
      descriptor.format !== "mach-o" ||
      descriptor.architectures.length !== 1 ||
      descriptor.architectures[0] !== expectedArchitecture
    ) {
      throw new Error(
        `Packaged Computer Use helper must be a single-architecture ${expectedArchitecture} Mach-O: ${helperPath}`
      )
    }
  }

  if (platform === "linux") {
    if (!(helperStats.mode & 0o111)) {
      throw new Error(`Packaged Computer Use helper is not executable: ${helperPath}`)
    }
    const firstLine = readFileSync(helperPath, "utf8").split(/\r?\n/, 1)[0]
    if (firstLine !== "#!/usr/bin/env python3") {
      throw new Error(`Packaged Computer Use helper has an invalid Python shebang: ${helperPath}`)
    }
  }
}

export function assertPackagedNativeArchitectures(
  { executablePath, resourcesPath },
  {
    expectedArchitecture = process.env.JINGLE_BUILD_TARGET_ARCH ?? process.arch,
    platform = process.platform,
    readDescriptor = readNativeBinaryDescriptor
  } = {}
) {
  if (!supportedRuntimeArchitectures.has(expectedArchitecture)) {
    throw new Error(`Unsupported packaged runtime architecture: ${expectedArchitecture}`)
  }
  if (!executablePath) {
    throw new Error("Packaged application executable is missing.")
  }

  const requiredFormat = expectedNativeFormat(platform)
  const candidates = [
    { kind: "application executable", path: executablePath, required: true },
    ...findNativeFiles(resourcesPath).map((path) => ({
      kind: basename(path).toLowerCase().endsWith(".node") ? "native addon" : "native helper",
      path,
      required: hasNativeFileExtension(path)
    }))
  ]

  for (const candidate of candidates) {
    const descriptor = readDescriptor(candidate.path)
    if (!descriptor) {
      if (candidate.required) {
        throw new Error(
          `Packaged ${candidate.kind} is not a recognized native binary: ${candidate.path}`
        )
      }
      continue
    }
    if (descriptor.format !== requiredFormat) {
      throw new Error(
        `Packaged ${candidate.kind} has ${descriptor.format} format, expected ${requiredFormat}: ${candidate.path}`
      )
    }
    if (
      descriptor.architectures.length !== 1 ||
      descriptor.architectures[0] !== expectedArchitecture
    ) {
      throw new Error(
        `Packaged ${candidate.kind} has architectures ${descriptor.architectures.join(", ")}, expected only ${expectedArchitecture}: ${candidate.path}`
      )
    }
  }
}

function otoolLinkedLibraries(path) {
  const output = execFileSync("otool", ["-L", path], { encoding: "utf-8" })
  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(" ")[0])
    .filter(Boolean)
}

export function assertMacNativeLinks(
  { resourcesPath },
  { platform = process.platform, readLinkedLibraries = otoolLinkedLibraries } = {}
) {
  if (platform !== "darwin") {
    return
  }

  const offenders = []

  for (const filePath of findNativeFiles(resourcesPath)) {
    if (!isMachOFile(filePath)) {
      if (filePath.endsWith(".node")) {
        throw new Error(`Packaged native addon is not a Mach-O file: ${filePath}`)
      }
      continue
    }

    const linkedLibraries = readLinkedLibraries(filePath)
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

const {
  diagnosticsBuildIdentity,
  parseDiagnosticsBuildIdentity
} = requireFromApp("./out/main/diagnostics-build-identity-audit.js")
const configuredProvenance = process.env.JINGLE_BUILD_PROVENANCE
const configuredSourceRevision = process.env.JINGLE_BUILD_SOURCE_REVISION
const expectedBuildIdentity =
  configuredProvenance === undefined && configuredSourceRevision === undefined
    ? parseDiagnosticsBuildIdentity({ kind: "untrusted" })
    : parseDiagnosticsBuildIdentity({
        declaredBy: configuredProvenance?.trim(),
        kind: "build-declared",
        sourceRevision: configuredSourceRevision?.trim()
      })
if (JSON.stringify(diagnosticsBuildIdentity) !== JSON.stringify(expectedBuildIdentity)) {
  throw new Error(
    "Packaged diagnostics build identity does not match the build provenance contract."
  )
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

function runPackagedRuntimeAudit() {
  const packagedApps = findPackagedApps()
  if (packagedApps.length === 0) {
    throw new Error(`No packaged app with resources/app.asar found under ${root}`)
  }

  for (const packagedApp of packagedApps) {
    assertForbiddenRuntimeNotPackaged(packagedApp)
    assertPackagedComputerUseHelper(packagedApp)
    assertPackagedNativeArchitectures(packagedApp)
    assertMacNativeLinks(packagedApp)
    runPackagedRuntimeSmoke(packagedApp)
    console.log(`packaged runtime audit passed: ${packagedApp.appPath}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPackagedRuntimeAudit()
}
