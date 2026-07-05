import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { presentArtifacts } from "../../../src/main/artifacts/service"
import { closeDatabase, createThread, initializeDatabase, updateThread } from "../../../src/main/db"
import type { ArtifactRecord } from "../../../src/shared/artifacts"

export async function seedManagedFileArtifactFixture(params: {
  content: Buffer | string
  fileName: string
  mimeType: string
  jingleHome: string
  title: string
}): Promise<{
  artifact: ArtifactRecord
  artifactId: string
  managedPath: string
  threadId: string
}> {
  await closeDatabase()
  await initializeDatabase()

  const threadId = randomUUID()
  const sourceDir = join(params.jingleHome, "artifact-fixtures", threadId)
  const sourcePath = join(sourceDir, params.fileName)

  mkdirSync(sourceDir, { recursive: true })
  writeFileSync(sourcePath, params.content)

  await createThread(threadId)
  await updateThread(threadId, { title: `BDD Artifact Contract ${params.title}` })

  const result = await presentArtifacts({
    artifacts: [
      {
        artifactKey: `bdd-artifact:${randomUUID()}`,
        kind: "file",
        mimeType: params.mimeType,
        path: sourcePath,
        sourceType: "managed-file-path",
        title: params.title
      }
    ],
    idempotencyKey: `bdd-artifact-presentation:${randomUUID()}`,
    threadId
  })

  if (result.type === "idempotency-conflict") {
    throw new Error(`Unexpected artifact fixture idempotency conflict for ${params.title}`)
  }

  const artifact = result.artifacts[0]
  if (!artifact || artifact.source.type !== "managed-file-path") {
    throw new Error(`Managed artifact fixture for ${params.title} did not create a file artifact.`)
  }

  return {
    artifact,
    artifactId: artifact.id,
    managedPath: artifact.source.uri,
    threadId
  }
}
