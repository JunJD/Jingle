import { promises as fs } from "node:fs"
import { createHash } from "node:crypto"
import { EventEmitter } from "node:events"
import { shell } from "electron"
import { v4 as uuid } from "uuid"
import type { Prisma } from "@prisma/client"
import {
  getArtifactCapabilities,
  supportsArtifactAction,
  type ArtifactActionId,
  type ArtifactActionResolution,
  type ArtifactChangedEvent,
  type ArtifactPresentationReceipt,
  type ArtifactRecord,
  type PresentArtifactsRequest,
  type PresentArtifactsResult
} from "../../shared/artifacts"
import { assertSafePublicHttpUrl } from "../services/web-tools/url-guard"
import { getPrismaClient } from "../db/client"
import {
  decodeArtifactRecord,
  toArtifactPersistenceFields,
  type ArtifactRecordDraft,
  type ArtifactPersistenceRow
} from "./types"
import { normalizePresentArtifact } from "./normalizers"
import { materializeManagedArtifactCopy, resolveManagedArtifactPath } from "./storage"

type ArtifactModel = Prisma.ArtifactGetPayload<Record<string, never>>
const artifactEvents = new EventEmitter()

function mapArtifactModel(row: ArtifactModel): ArtifactPersistenceRow {
  return {
    artifactId: row.artifactId,
    artifactKey: row.artifactKey,
    createdAt: row.createdAt,
    kind: row.kind as ArtifactRecord["kind"],
    messageId: row.messageId,
    mimeType: row.mimeType,
    payloadJson: row.payloadJson,
    previewText: row.previewText,
    runId: row.runId,
    sizeBytes: row.sizeBytes,
    sourceType: row.sourceType as ArtifactPersistenceRow["sourceType"],
    sourceUri: row.sourceUri,
    status: row.status as ArtifactPersistenceRow["status"],
    subtitle: row.subtitle,
    threadId: row.threadId,
    title: row.title,
    toolCallId: row.toolCallId,
    updatedAt: row.updatedAt
  }
}

async function notifyArtifactsChanged(threadId: string): Promise<void> {
  const artifacts = await listArtifacts(threadId)
  artifactEvents.emit("changed", {
    artifacts,
    threadId
  } satisfies ArtifactChangedEvent)
}

export function onArtifactsChanged(listener: (event: ArtifactChangedEvent) => void): () => void {
  artifactEvents.on("changed", listener)
  return () => {
    artifactEvents.off("changed", listener)
  }
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys)
  }
  if (!value || typeof value !== "object") {
    return value
  }

  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortObjectKeys((value as Record<string, unknown>)[key])
      return acc
    }, {})
}

function hashRequestContent(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortObjectKeys(value)))
    .digest("hex")
}

function buildArtifactUpdateData(
  artifactKey: string,
  dedupeKey: string | null,
  draft: ArtifactRecordDraft,
  now: bigint
): Prisma.ArtifactUncheckedCreateInput {
  const persistence = toArtifactPersistenceFields({
    payload: draft.payload,
    source: draft.source
  })

  return {
    artifactId: uuid(),
    artifactKey,
    createdAt: now,
    dedupeKey,
    kind: draft.kind,
    messageId: draft.messageId,
    mimeType: draft.mimeType,
    payloadJson: persistence.payloadJson,
    previewText: draft.previewText,
    runId: draft.runId,
    sizeBytes: draft.sizeBytes === null ? null : BigInt(draft.sizeBytes),
    sourceType: persistence.sourceType,
    sourceUri: persistence.sourceUri,
    status: draft.status,
    subtitle: draft.subtitle,
    threadId: draft.threadId,
    title: draft.title,
    toolCallId: draft.toolCallId,
    updatedAt: now
  }
}

function hasArtifactChanges(
  existing: ArtifactModel,
  draft: ArtifactRecordDraft,
  artifactKey: string,
  dedupeKey: string | null
): boolean {
  const persistence = toArtifactPersistenceFields({
    payload: draft.payload,
    source: draft.source
  })

  return (
    existing.artifactKey !== artifactKey ||
    existing.dedupeKey !== dedupeKey ||
    existing.kind !== draft.kind ||
    existing.title !== draft.title ||
    existing.subtitle !== draft.subtitle ||
    existing.sourceType !== persistence.sourceType ||
    existing.sourceUri !== persistence.sourceUri ||
    existing.mimeType !== draft.mimeType ||
    existing.sizeBytes !== (draft.sizeBytes === null ? null : BigInt(draft.sizeBytes)) ||
    existing.previewText !== draft.previewText ||
    existing.payloadJson !== persistence.payloadJson ||
    existing.status !== draft.status ||
    existing.runId !== draft.runId ||
    existing.messageId !== draft.messageId ||
    existing.toolCallId !== draft.toolCallId
  )
}

async function getArtifactOrThrow(artifactId: string): Promise<ArtifactRecord> {
  const prisma = getPrismaClient()
  const row = await prisma.artifact.findUnique({
    where: { artifactId }
  })

  if (!row) {
    throw new Error(`Artifact not found: ${artifactId}`)
  }

  return decodeArtifactRecord(mapArtifactModel(row))
}

export async function listArtifacts(threadId: string): Promise<ArtifactRecord[]> {
  const prisma = getPrismaClient()
  const rows = await prisma.artifact.findMany({
    orderBy: {
      createdAt: "desc"
    },
    where: {
      threadId
    }
  })

  return rows.map((row) => decodeArtifactRecord(mapArtifactModel(row)))
}

export async function presentArtifacts(
  request: PresentArtifactsRequest
): Promise<PresentArtifactsResult> {
  const prisma = getPrismaClient()
  const normalizedInputs = request.artifacts.map((artifact) => {
    if (artifact.kind !== "file") {
      return artifact
    }

    return {
      ...artifact,
      path: resolveManagedArtifactPath({
        artifactKey: artifact.artifactKey,
        sourcePath: artifact.path,
        threadId: request.threadId
      })
    }
  })
  const normalizedDrafts = await Promise.all(
    normalizedInputs.map((artifact) => normalizePresentArtifact(artifact, request))
  )
  const contentHash = hashRequestContent({
    artifacts: normalizedDrafts,
    idempotencyKey: request.idempotencyKey,
    threadId: request.threadId
  })
  const existingPresentation = await prisma.artifactPresentation.findUnique({
    where: {
      threadId_idempotencyKey: {
        idempotencyKey: request.idempotencyKey,
        threadId: request.threadId
      }
    }
  })

  let result: PresentArtifactsResult

  if (existingPresentation) {
    if (existingPresentation.contentHash !== contentHash) {
      result = {
        reason: "request-content-mismatch" as const,
        requestIdentity: {
          idempotencyKey: request.idempotencyKey,
          threadId: request.threadId
        },
        type: "idempotency-conflict" as const
      }
    } else {
      const artifactIds = JSON.parse(existingPresentation.artifactIdsJson) as string[]
      const rows = await prisma.artifact.findMany({
        orderBy: {
          createdAt: "desc"
        },
        where: {
          artifactId: {
            in: artifactIds
          }
        }
      })

      result = {
        artifacts: rows.map((row) => decodeArtifactRecord(mapArtifactModel(row))),
        receipts: rows.map<ArtifactPresentationReceipt>((row) => ({
          artifactId: row.artifactId,
          artifactKey: row.artifactKey,
          dedupeKey: row.dedupeKey,
          outcome: "reused"
        })),
        requestIdentity: {
          idempotencyKey: request.idempotencyKey,
          threadId: request.threadId
        },
        type: "replayed" as const
      }
    }
  } else {
    for (const requestInput of request.artifacts) {
      if (requestInput.kind !== "file") {
        continue
      }

      await materializeManagedArtifactCopy({
        artifactKey: requestInput.artifactKey,
        sourcePath: requestInput.path,
        threadId: request.threadId
      })
    }

    result = await prisma.$transaction(async (tx) => {
      const now = BigInt(Date.now())
      const persistedArtifacts: ArtifactModel[] = []
      const receipts: ArtifactPresentationReceipt[] = []

      for (let index = 0; index < normalizedInputs.length; index += 1) {
        const input = normalizedInputs[index]!
        const draft = normalizedDrafts[index]!
        const dedupeKey = input.dedupeKey ?? null
        const existingArtifact =
          dedupeKey === null
            ? null
            : await tx.artifact.findUnique({
                where: {
                  threadId_dedupeKey: {
                    dedupeKey,
                    threadId: request.threadId
                  }
                }
              })

        if (!existingArtifact) {
          const created = await tx.artifact.create({
            data: buildArtifactUpdateData(input.artifactKey, dedupeKey, draft, now)
          })
          persistedArtifacts.push(created)
          receipts.push({
            artifactId: created.artifactId,
            artifactKey: input.artifactKey,
            dedupeKey,
            outcome: "created"
          })
          continue
        }

        if (!hasArtifactChanges(existingArtifact, draft, input.artifactKey, dedupeKey)) {
          persistedArtifacts.push(existingArtifact)
          receipts.push({
            artifactId: existingArtifact.artifactId,
            artifactKey: input.artifactKey,
            dedupeKey,
            outcome: "reused"
          })
          continue
        }

        const updated = await tx.artifact.update({
          data: {
            ...buildArtifactUpdateData(input.artifactKey, dedupeKey, draft, now),
            artifactId: undefined,
            createdAt: undefined
          },
          where: {
            artifactId: existingArtifact.artifactId
          }
        })
        persistedArtifacts.push(updated)
        receipts.push({
          artifactId: updated.artifactId,
          artifactKey: input.artifactKey,
          dedupeKey,
          outcome: "updated"
        })
      }

      const artifactIds = persistedArtifacts.map((artifact) => artifact.artifactId)
      await tx.artifactPresentation.create({
        data: {
          artifactIdsJson: JSON.stringify(artifactIds),
          contentHash,
          createdAt: now,
          idempotencyKey: request.idempotencyKey,
          presentationId: uuid(),
          threadId: request.threadId,
          updatedAt: now
        }
      })

      return {
        artifacts: persistedArtifacts.map((row) => decodeArtifactRecord(mapArtifactModel(row))),
        receipts,
        requestIdentity: {
          idempotencyKey: request.idempotencyKey,
          threadId: request.threadId
        },
        type: "stored" as const
      }
    })
  }

  if (result.type !== "idempotency-conflict") {
    try {
      await notifyArtifactsChanged(request.threadId)
    } catch (error) {
      console.error("[Artifacts] Failed to emit changed event:", error)
    }
  }

  return result
}

export async function openArtifact(
  artifactId: string,
  action?: ArtifactActionId
): Promise<ArtifactActionResolution> {
  const artifact = await getArtifactOrThrow(artifactId)
  const capabilities = getArtifactCapabilities(artifact)
  const resolvedAction = action ?? capabilities.primaryAction

  if (!resolvedAction) {
    return { type: "detail" }
  }

  if (!supportsArtifactAction(artifact, resolvedAction)) {
    throw new Error(`Artifact action "${resolvedAction}" is not supported for ${artifact.kind}`)
  }

  switch (artifact.kind) {
    case "summary":
      return { type: "detail" }
    case "link":
      if (resolvedAction === "copy-link") {
        return {
          type: "copy-link",
          value: artifact.source.uri
        }
      }
      await shell.openExternal((await assertSafePublicHttpUrl(artifact.source.uri)).toString())
      return {
        type: "external-browser",
        url: artifact.source.uri
      }
    case "file":
      if (resolvedAction === "reveal-source") {
        shell.showItemInFolder(artifact.source.uri)
        return {
          path: artifact.source.uri,
          type: "reveal-source"
        }
      }
      if (resolvedAction === "download") {
        return {
          type: "download",
          uri: artifact.source.uri
        }
      }
      {
        const error = await shell.openPath(artifact.source.uri)
        if (error) {
          throw new Error(error)
        }
      }
      return {
        path: artifact.source.uri,
        type: "system-default"
      }
    case "patch":
      if (artifact.source.type === "inline-text") {
        return { type: "detail" }
      }
      if (resolvedAction === "reveal-source") {
        shell.showItemInFolder(artifact.source.uri)
        return {
          path: artifact.source.uri,
          type: "reveal-source"
        }
      }
      if (resolvedAction === "download") {
        return {
          type: "download",
          uri: artifact.source.uri
        }
      }
      {
        const error = await shell.openPath(artifact.source.uri)
        if (error) {
          throw new Error(error)
        }
      }
      return {
        path: artifact.source.uri,
        type: "system-default"
      }
  }
}

export async function readArtifactFile(
  artifactId: string,
  mode: "binary" | "text"
): Promise<{
  content: string
  modified_at: string
  size: number
}> {
  const artifact = await getArtifactOrThrow(artifactId)

  if (artifact.source.type !== "managed-file-path") {
    throw new Error("Artifact does not reference a managed file")
  }

  const stat = await fs.stat(artifact.source.uri)
  if (stat.isDirectory()) {
    throw new Error("Cannot read directory as file")
  }

  if (mode === "binary") {
    const buffer = await fs.readFile(artifact.source.uri)
    return {
      content: buffer.toString("base64"),
      modified_at: stat.mtime.toISOString(),
      size: stat.size
    }
  }

  return {
    content: await fs.readFile(artifact.source.uri, "utf-8"),
    modified_at: stat.mtime.toISOString(),
    size: stat.size
  }
}
