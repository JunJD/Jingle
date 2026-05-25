import { execFileSync } from "node:child_process"
import { existsSync, lstatSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve, sep } from "node:path"

const root = resolve(process.argv[2] ?? "dist")
const forbiddenMacLinkPrefixes = ["/opt/homebrew/", "/usr/local/opt/"]
const requiredExternalPackages = ["@prisma/client", "just-bash"]
const forbiddenExternalPackages = ["@mongodb-js/zstd", "node-liblzma"]

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
    return entry.isDirectory() && path.endsWith(".app") && existsSync(join(path, "Contents", "Resources", "app.asar"))
  }).sort()
}

function findAppExecutable(appPath) {
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

function findNativeFiles(appPath) {
  const resourcesPath = join(appPath, "Contents", "Resources")
  return collectMatching(resourcesPath, (path, entry) => {
    if (entry.isDirectory()) {
      return false
    }

    const name = basename(path)
    if (name.endsWith(".node")) {
      return true
    }

    return path.split(sep).includes("app.asar.unpacked") && Boolean(entry.mode & 0o111)
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

function assertMacNativeLinks(appPath) {
  const offenders = []

  for (const filePath of findNativeFiles(appPath)) {
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

function assertForbiddenPackagesNotPackaged(appPath) {
  const resourcesPath = join(appPath, "Contents", "Resources")
  const appAsarPath = join(resourcesPath, "app.asar")
  const asarBin = resolve("node_modules/.bin/asar")
  if (!existsSync(asarBin)) {
    throw new Error(`Could not find asar binary: ${asarBin}`)
  }

  const asarEntries = execFileSync(asarBin, ["list", appAsarPath], {
    encoding: "utf-8",
    maxBuffer: 128 * 1024 * 1024
  }).split("\n")

  for (const packageName of forbiddenExternalPackages) {
    const packageParts = packagePathFragments(packageName)
    const packageAsarPrefix = `/node_modules/${packageParts.join("/")}`
    const packagedInAsar = asarEntries.some((entry) => entry === packageAsarPrefix || entry.startsWith(`${packageAsarPrefix}/`))
    if (packagedInAsar) {
      throw new Error(`${packageName} should not be packaged unless just-bash native codecs are enabled.`)
    }

    const unpackedPath = join(resourcesPath, "app.asar.unpacked", "node_modules", ...packageParts)
    if (existsSync(unpackedPath)) {
      throw new Error(`${packageName} should not be unpacked unless just-bash native codecs are enabled: ${unpackedPath}`)
    }
  }
}

function runPackagedRuntimeSmoke(appPath) {
  const executablePath = findAppExecutable(appPath)
  if (!executablePath) {
    throw new Error(`Could not find packaged app executable in ${appPath}`)
  }

  const resourcesPath = join(appPath, "Contents", "Resources")
  const appAsarPath = join(resourcesPath, "app.asar")
  if (!existsSync(appAsarPath)) {
    throw new Error(`Could not find app.asar in ${appPath}`)
  }

  const smokeHome = mkdtempSync(join(tmpdir(), "openwork-packaged-runtime-"))
  const smokeScript = `
const { createRequire, builtinModules } = await import("node:module")
const { join, normalize, sep, isAbsolute } = await import("node:path")

const appAsarPath = process.env.OPENWORK_PACKAGED_APP_ASAR
const resourcesPath = process.env.OPENWORK_PACKAGED_RESOURCES
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

const { Bash } = requireFromApp("just-bash")
const bash = new Bash()
const bashResult = await bash.exec("echo packaged-runtime")
if (bashResult.exitCode !== 0 || bashResult.stdout.trim() !== "packaged-runtime") {
  throw new Error("Packaged just-bash smoke returned an unexpected result.")
}

const { PrismaClient } = requireFromApp("@prisma/client")
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "file:" + join(process.env.OPENWORK_PACKAGED_SMOKE_HOME, "runtime-smoke.sqlite")
    }
  }
})

try {
  const rows = await prisma.$queryRawUnsafe("SELECT 1 AS ok")
  if (!rows || String(rows[0]?.ok) !== "1") {
    throw new Error("Packaged Prisma SELECT 1 smoke returned an unexpected result.")
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
        OPENWORK_HOME: smokeHome,
        OPENWORK_PACKAGED_APP_ASAR: appAsarPath,
        OPENWORK_PACKAGED_RESOURCES: resourcesPath,
        OPENWORK_PACKAGED_SMOKE_HOME: smokeHome
      },
      stdio: "pipe"
    })
  } finally {
    rmSync(smokeHome, { force: true, recursive: true })
  }
}

const appPaths = findPackagedApps()
if (appPaths.length === 0) {
  throw new Error(`No packaged .app found under ${root}`)
}

for (const appPath of appPaths) {
  assertMacNativeLinks(appPath)
  assertForbiddenPackagesNotPackaged(appPath)
  runPackagedRuntimeSmoke(appPath)
  console.log(`packaged runtime audit passed: ${appPath}`)
}
