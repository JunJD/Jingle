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

  return candidates.find((path) => basename(path).toLowerCase().includes("openwork")) ?? candidates[0] ?? null
}

function findNativeFiles(resourcesPath) {
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

function findAsarBin() {
  const binName = process.platform === "win32" ? "asar.cmd" : "asar"
  const asarBin = resolve("node_modules/.bin", binName)
  if (!existsSync(asarBin)) {
    throw new Error(`Could not find asar binary: ${asarBin}`)
  }

  return asarBin
}

function assertForbiddenPackagesNotPackaged({ appAsarPath, resourcesPath }) {
  const asarBin = findAsarBin()

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

function runPackagedRuntimeSmoke({ appAsarPath, appPath, executablePath, resourcesPath }) {
  if (!executablePath) {
    throw new Error(`Could not find packaged app executable in ${appPath}`)
  }

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

const packagedApps = findPackagedApps()
if (packagedApps.length === 0) {
  throw new Error(`No packaged app with resources/app.asar found under ${root}`)
}

for (const packagedApp of packagedApps) {
  assertMacNativeLinks(packagedApp)
  assertForbiddenPackagesNotPackaged(packagedApp)
  runPackagedRuntimeSmoke(packagedApp)
  console.log(`packaged runtime audit passed: ${packagedApp.appPath}`)
}
