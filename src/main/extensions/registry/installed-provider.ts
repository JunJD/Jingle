import { createHash } from "node:crypto"
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs"
import { basename, isAbsolute, join, relative, resolve } from "node:path"
import {
  validateNativeExtensionPackageManifest,
  type NativeExtensionPackageManifest
} from "@shared/native-extensions"
import type { NativeExtensionRuntimePackageMetadata } from "@jingle/extension-api"
import {
  isInstalledExtensionId,
  isInstalledExtensionVersion,
  resolveInstalledExtensionPackageRoot
} from "@jingle/extension-cli/installed-package-path"
import {
  parseInstalledExtensionDescriptorFile,
  type InstalledExtensionDescriptorFile,
  type InstalledExtensionRuntimeArtifactRevision
} from "./descriptor-schema"
import type {
  ExtensionPackageDescriptor,
  ExtensionPackageError,
  LoadedExtensionPackageDescriptor
} from "./types"

const DESCRIPTOR_FILE_NAME = "jingle.extension.json"
const EXTENSION_PACKAGE_TEMPORARY_DIRECTORY_PREFIX = ".jingle-extension-tmp-"

export class InstalledExtensionProvider {
  constructor(private readonly extensionsRoot: string) {}

  listPackages(): ExtensionPackageDescriptor[] {
    if (!existsSync(this.extensionsRoot)) {
      return []
    }

    return readdirSync(this.extensionsRoot)
      .filter((extensionId) => isInstalledExtensionId(extensionId))
      .sort((left, right) => left.localeCompare(right))
      .flatMap((extensionId) => this.listExtensionVersionPackages(extensionId))
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  private listExtensionVersionPackages(extensionId: string): ExtensionPackageDescriptor[] {
    const extensionRoot = join(this.extensionsRoot, extensionId)
    if (!safeIsDirectory(extensionRoot)) {
      return []
    }

    const versionEntries: string[] = []
    for (const version of readdirSync(extensionRoot)) {
      if (isExtensionPackageTemporaryDirectory(version)) {
        continue
      }
      if (!isInstalledExtensionVersion(version)) {
        continue
      }
      const versionRoot = resolveInstalledExtensionPackageRoot(this.extensionsRoot, {
        id: extensionId,
        version
      })
      if (safeIsDirectory(versionRoot)) {
        versionEntries.push(versionRoot)
      }
    }
    versionEntries.sort((left, right) => left.localeCompare(right))

    return versionEntries.map((packageRoot) => this.readPackage(packageRoot, extensionId))
  }

  private readPackage(packageRoot: string, fallbackId: string): ExtensionPackageDescriptor {
    const descriptorRef = this.resolveDescriptorPath(packageRoot)
    try {
      if (!descriptorRef) {
        return failedPackage({
          code: "descriptor_missing",
          id: fallbackId,
          message: `Installed extension descriptor is missing: ${join(packageRoot, DESCRIPTOR_FILE_NAME)}`,
          rootDir: packageRoot
        })
      }

      const descriptor = parseInstalledExtensionDescriptorFile(
        JSON.parse(readFileSync(descriptorRef, "utf8"))
      )
      if (descriptor.id !== fallbackId || descriptor.version !== basename(packageRoot)) {
        throw new Error(
          `Installed extension descriptor identity ${descriptor.id}@${descriptor.version} does not match package path ${fallbackId}@${basename(packageRoot)}`
        )
      }
      return this.readLoadedPackage(packageRoot, descriptor)
    } catch (error) {
      return failedPackage({
        code: "descriptor_invalid",
        id: fallbackId,
        message: error instanceof Error ? error.message : String(error),
        rootDir: packageRoot
      })
    }
  }

  private resolveDescriptorPath(packageRoot: string): string | null {
    const descriptorPath = join(packageRoot, DESCRIPTOR_FILE_NAME)
    if (existsSync(descriptorPath)) {
      return descriptorPath
    }

    return null
  }

  private readLoadedPackage(
    packageRoot: string,
    descriptor: InstalledExtensionDescriptorFile
  ): ExtensionPackageDescriptor {
    const errors: ExtensionPackageError[] = []
    const manifestPath = resolvePackageRelativePath({
      code: "manifest_invalid",
      errors,
      fieldName: "manifest",
      packageRelativePath: descriptor.manifest,
      packageRoot
    })
    const runtimeMetadataPath = descriptor.runtimeMetadata
      ? resolvePackageRelativePath({
          code: "runtime_metadata_invalid",
          errors,
          fieldName: "runtimeMetadata",
          packageRelativePath: descriptor.runtimeMetadata,
          packageRoot
        })
      : null
    const assetsDir = resolvePackageRelativePath({
      code: "asset_path_invalid",
      errors,
      fieldName: "assets",
      packageRelativePath: descriptor.assets,
      packageRoot
    })
    const runtimeModulePath = descriptor.runtime
      ? resolvePackageRelativePath({
          code: "runtime_invalid",
          errors,
          fieldName: "runtime",
          packageRelativePath: descriptor.runtime,
          packageRoot
        })
      : null
    const mainModulePath = descriptor.main
      ? resolvePackageRelativePath({
          code: "main_invalid",
          errors,
          fieldName: "main",
          packageRelativePath: descriptor.main,
          packageRoot
        })
      : null

    const manifest = readJsonFile<NativeExtensionPackageManifest>({
      code: "manifest_invalid",
      errors,
      filePath: manifestPath,
      missingCode: "manifest_missing"
    })
    const runtimeMetadata = descriptor.runtimeMetadata
      ? readJsonFile<NativeExtensionRuntimePackageMetadata>({
          code: "runtime_metadata_invalid",
          errors,
          filePath: runtimeMetadataPath,
          missingCode: "runtime_metadata_missing"
        })
      : null

    if (assetsDir && !safeIsDirectory(assetsDir)) {
      errors.push({
        code: "asset_path_invalid",
        message: `Installed extension assets directory does not exist: ${assetsDir}`
      })
    }

    if (runtimeModulePath && !existsSync(runtimeModulePath)) {
      errors.push({
        code: "runtime_missing",
        message: `Installed extension runtime module does not exist: ${runtimeModulePath}`
      })
    }

    const runtimeArtifactRevision = verifyRuntimeArtifactRevision({
      errors,
      expectedRevision: descriptor.runtimeArtifactRevision,
      runtimeModulePath
    })

    if (mainModulePath && !existsSync(mainModulePath)) {
      errors.push({
        code: "main_missing",
        message: `Installed extension main module does not exist: ${mainModulePath}`
      })
    }

    if (manifest) {
      try {
        validateNativeExtensionPackageManifest(manifest)
      } catch (error) {
        errors.push({
          code: "manifest_invalid",
          message: error instanceof Error ? error.message : String(error)
        })
      }
      if (manifest.name !== descriptor.id) {
        errors.push({
          code: "manifest_invalid",
          message: `Installed extension manifest name "${manifest.name}" does not match descriptor id "${descriptor.id}"`
        })
      }
    }

    if (runtimeMetadata && runtimeMetadata.extensionName !== descriptor.id) {
      errors.push({
        code: "runtime_metadata_invalid",
        message: `Installed extension runtime metadata "${runtimeMetadata.extensionName}" does not match descriptor id "${descriptor.id}"`
      })
    }

    if (errors.length > 0 || !assetsDir || !manifest) {
      return {
        assetsDir,
        enabled: false,
        errors,
        id: descriptor.id,
        rootDir: packageRoot,
        source: "installed",
        status: "error",
        trust: descriptor.trust,
        version: descriptor.version
      }
    }

    return {
      assetsDir,
      enabled: true,
      errors: [],
      id: descriptor.id,
      main: mainModulePath
        ? {
            extensionName: descriptor.id,
            kind: "module",
            modulePath: mainModulePath,
            trust: descriptor.trust,
            version: descriptor.version
          }
        : null,
      manifest,
      rootDir: packageRoot,
      runtime: runtimeModulePath
        ? {
            extensionName: descriptor.id,
            kind: "module",
            modulePath: runtimeModulePath,
            runtimeArtifactRevision: runtimeArtifactRevision
              ? { kind: "available", revision: runtimeArtifactRevision }
              : { kind: "unavailable", reason: "legacy-descriptor" },
            version: descriptor.version
          }
        : null,
      runtimeMetadata,
      source: "installed",
      status: "loaded",
      trust: descriptor.trust,
      version: descriptor.version
    } satisfies LoadedExtensionPackageDescriptor
  }
}

function verifyRuntimeArtifactRevision(input: {
  errors: ExtensionPackageError[]
  expectedRevision: InstalledExtensionRuntimeArtifactRevision | null
  runtimeModulePath: string | null
}): InstalledExtensionRuntimeArtifactRevision | null {
  if (!input.expectedRevision) {
    return null
  }
  if (!input.runtimeModulePath || !existsSync(input.runtimeModulePath)) {
    return null
  }

  const digest = input.expectedRevision.slice("sha256:".length)
  if (basename(input.runtimeModulePath) !== `runtime-${digest}.mjs`) {
    input.errors.push({
      code: "runtime_artifact_revision_invalid",
      message: "Installed extension runtime path does not match its content revision"
    })
    return null
  }

  try {
    const actualRevision = `sha256:${createHash("sha256")
      .update(readFileSync(input.runtimeModulePath))
      .digest("hex")}` as InstalledExtensionRuntimeArtifactRevision
    if (actualRevision !== input.expectedRevision) {
      input.errors.push({
        code: "runtime_artifact_revision_invalid",
        message: "Installed extension runtime content does not match its declared revision"
      })
      return null
    }
    return actualRevision
  } catch {
    input.errors.push({
      code: "runtime_artifact_revision_invalid",
      message: "Installed extension runtime content revision could not be verified"
    })
    return null
  }
}

function isExtensionPackageTemporaryDirectory(name: string): boolean {
  return name.startsWith(EXTENSION_PACKAGE_TEMPORARY_DIRECTORY_PREFIX)
}

function failedPackage(input: {
  code: ExtensionPackageError["code"]
  id: string
  message: string
  rootDir: string
}): ExtensionPackageDescriptor {
  return {
    assetsDir: null,
    enabled: false,
    errors: [
      {
        code: input.code,
        message: input.message
      }
    ],
    id: input.id,
    rootDir: input.rootDir,
    source: "installed",
    status: "error",
    trust: "untrusted",
    version: null
  }
}

function readJsonFile<T>(input: {
  code: ExtensionPackageError["code"]
  errors: ExtensionPackageError[]
  filePath: string | null
  missingCode: ExtensionPackageError["code"]
}): T | null {
  if (!input.filePath) {
    return null
  }

  if (!existsSync(input.filePath)) {
    input.errors.push({
      code: input.missingCode,
      message: `Installed extension file does not exist: ${input.filePath}`
    })
    return null
  }

  try {
    return JSON.parse(readFileSync(input.filePath, "utf8")) as T
  } catch (error) {
    input.errors.push({
      code: input.code,
      message: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

function resolvePackageRelativePath(input: {
  code: ExtensionPackageError["code"]
  errors: ExtensionPackageError[]
  fieldName: string
  packageRelativePath: string
  packageRoot: string
}): string | null {
  const resolvedPath = resolve(input.packageRoot, input.packageRelativePath)
  const relativePath = relative(resolve(input.packageRoot), resolvedPath)
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    input.errors.push({
      code: input.code,
      message: `Installed extension ${input.fieldName} path escapes package root`
    })
    return null
  }

  return resolvedPath
}

function safeIsDirectory(filePath: string): boolean {
  try {
    return lstatSync(filePath).isDirectory()
  } catch {
    return false
  }
}
