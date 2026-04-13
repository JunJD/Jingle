import { createHash } from "node:crypto"
import { copyFile, mkdir, rm, stat } from "node:fs/promises"
import { basename, extname, join, resolve } from "node:path"
import { getOpenworkDir } from "../storage"

function sanitizeFileStem(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

function buildManagedArtifactFilename(artifactKey: string, sourcePath: string): string {
  const sourceBaseName = basename(sourcePath)
  const extension = extname(sourceBaseName)
  const rawStem = extension ? sourceBaseName.slice(0, -extension.length) : sourceBaseName
  const safeStem = sanitizeFileStem(rawStem).slice(0, 80) || "artifact"
  const suffix = createHash("sha256")
    .update(`${artifactKey}:${sourcePath}`)
    .digest("hex")
    .slice(0, 12)

  return `${safeStem}-${suffix}${extension}`
}

export function getManagedArtifactsRootDir(): string {
  return join(getOpenworkDir(), "artifacts")
}

export function getManagedArtifactsThreadDir(threadId: string): string {
  return join(getManagedArtifactsRootDir(), threadId)
}

export function resolveManagedArtifactPath(props: {
  artifactKey: string
  sourcePath: string
  threadId: string
}): string {
  return join(
    getManagedArtifactsThreadDir(props.threadId),
    buildManagedArtifactFilename(props.artifactKey, props.sourcePath)
  )
}

export async function materializeManagedArtifactCopy(props: {
  artifactKey: string
  sourcePath: string
  threadId: string
}): Promise<{ path: string; sizeBytes: number }> {
  const targetDir = getManagedArtifactsThreadDir(props.threadId)
  await mkdir(targetDir, { recursive: true })

  const targetPath = resolveManagedArtifactPath(props)

  if (resolve(props.sourcePath) !== resolve(targetPath)) {
    await copyFile(props.sourcePath, targetPath)
  }

  const copiedFileStat = await stat(targetPath)
  if (!copiedFileStat.isFile()) {
    throw new Error(`Managed artifact copy is not a file: ${targetPath}`)
  }

  return {
    path: targetPath,
    sizeBytes: copiedFileStat.size
  }
}

export async function deleteManagedArtifactsForThread(threadId: string): Promise<void> {
  await rm(getManagedArtifactsThreadDir(threadId), {
    force: true,
    recursive: true
  })
}

export async function deleteManagedArtifactFile(path: string): Promise<void> {
  await rm(path, { force: true })
}
