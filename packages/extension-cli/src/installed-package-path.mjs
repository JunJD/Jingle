import { realpath } from "node:fs/promises"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import semver from "semver"

const installedExtensionIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

export function isInstalledExtensionId(value) {
  return typeof value === "string" && installedExtensionIdPattern.test(value)
}

export function isInstalledExtensionVersion(value) {
  if (typeof value !== "string" || value !== value.toLowerCase()) {
    return false
  }
  const parsed = semver.parse(value, { loose: false })
  if (!parsed) {
    return false
  }
  const canonicalVersion = [
    `${parsed.major}.${parsed.minor}.${parsed.patch}`,
    parsed.prerelease.length > 0 ? `-${parsed.prerelease.join(".")}` : "",
    parsed.build.length > 0 ? `+${parsed.build.join(".")}` : ""
  ].join("")
  return value === canonicalVersion
}

export function parseInstalledExtensionId(value) {
  if (!isInstalledExtensionId(value)) {
    throw packagePathError(
      "Installed extension id must start with a lowercase letter and contain only lowercase letters, numbers, or single hyphens"
    )
  }
  return value
}

export function parseInstalledExtensionVersion(value) {
  if (!isInstalledExtensionVersion(value)) {
    throw packagePathError("Installed extension version must be a lowercase canonical SemVer")
  }
  return value
}

export function compareInstalledExtensionVersionPrecedence(left, right) {
  const leftVersion = parseInstalledExtensionVersion(left)
  const rightVersion = parseInstalledExtensionVersion(right)
  return semver.compare(leftVersion, rightVersion)
}

export function resolveInstalledExtensionPackageRoot(outputRoot, identity) {
  const id = parseInstalledExtensionId(identity?.id)
  const version = parseInstalledExtensionVersion(identity?.version)
  return resolve(outputRoot, id, version)
}

export async function resolveCanonicalInstalledExtensionPackageRoot(outputRoot, identity) {
  const packageRoot = resolveInstalledExtensionPackageRoot(outputRoot, identity)
  const canonicalOutputRoot = await canonicalizeFuturePath(resolve(outputRoot))
  const canonicalPackageRoot = await canonicalizeFuturePath(packageRoot)
  const expectedPackageRoot = resolveInstalledExtensionPackageRoot(canonicalOutputRoot, identity)
  if (canonicalPackageRoot !== expectedPackageRoot) {
    throw packagePathError("Installed extension package path escapes its output root")
  }
  return canonicalPackageRoot
}

export function parseInstalledExtensionPackageRoot(outputRoot, packageRoot) {
  const absoluteOutputRoot = resolve(outputRoot)
  const absolutePackageRoot = resolve(packageRoot)
  const relativePackageRoot = relative(absoluteOutputRoot, absolutePackageRoot)
  const segments = relativePackageRoot.split(sep)
  if (
    relativePackageRoot === "" ||
    relativePackageRoot.startsWith(`..${sep}`) ||
    relativePackageRoot === ".." ||
    segments.length !== 2
  ) {
    throw packagePathError(
      "Installed extension package path must be exactly <output-root>/<extension-id>/<version>"
    )
  }

  const id = parseInstalledExtensionId(segments[0])
  const version = parseInstalledExtensionVersion(segments[1])
  const expectedPackageRoot = resolveInstalledExtensionPackageRoot(absoluteOutputRoot, {
    id,
    version
  })
  if (absolutePackageRoot !== expectedPackageRoot) {
    throw packagePathError("Installed extension package path is not canonical")
  }
  return { id, packageRoot: expectedPackageRoot, version }
}

function packagePathError(message) {
  const error = new Error(message)
  error.code = "JINGLE_EXTENSION_PACKAGE_PATH_INVALID"
  return error
}

async function canonicalizeFuturePath(inputPath) {
  let existingPath = inputPath
  const missingSegments = []

  for (;;) {
    try {
      return join(await realpath(existingPath), ...missingSegments).normalize("NFC")
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error
      }
      const parentPath = dirname(existingPath)
      if (parentPath === existingPath) {
        throw error
      }
      missingSegments.unshift(basename(existingPath))
      existingPath = parentPath
    }
  }
}

function isMissingPathError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
