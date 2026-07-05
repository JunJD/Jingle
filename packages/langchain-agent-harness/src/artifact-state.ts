import { ReducedValue, StateSchema } from "@langchain/langgraph"
import { z } from "zod/v4"

export const JINGLE_AGENT_ARTIFACT_KINDS = ["file", "patch", "link", "summary"] as const

export type JingleAgentArtifactKind = (typeof JINGLE_AGENT_ARTIFACT_KINDS)[number]

export const JINGLE_AGENT_ARTIFACT_STATUSES = ["ready", "missing", "stale"] as const

export type JingleAgentArtifactStatus = (typeof JINGLE_AGENT_ARTIFACT_STATUSES)[number]

export const JINGLE_AGENT_ARTIFACT_SOURCE_TYPES = [
  "managed-file-path",
  "external-url",
  "inline-text"
] as const

export type JingleAgentArtifactSourceType = (typeof JINGLE_AGENT_ARTIFACT_SOURCE_TYPES)[number]

export const JINGLE_AGENT_ARTIFACT_WRITE_OUTCOMES = ["created", "updated", "reused"] as const

export type JingleAgentArtifactWriteOutcome = (typeof JINGLE_AGENT_ARTIFACT_WRITE_OUTCOMES)[number]

export interface JingleAgentArtifactPresentationReceipt {
  artifactId: string
  artifactKey: string
  dedupeKey: string | null
  outcome: JingleAgentArtifactWriteOutcome
}

export interface JingleAgentStateArtifactManifest {
  artifactId: string
  artifactKey: string
  kind: JingleAgentArtifactKind
  mimeType: string | null
  runId: string | null
  sizeBytes: number | null
  sourceType: JingleAgentArtifactSourceType
  status: JingleAgentArtifactStatus
  threadId: string
  title: string
  toolCallId: string | null
  updatedAt: string
}

export interface JingleAgentStateArtifactPresentation {
  idempotencyKey: string
  presentedAt: string
  receipts: JingleAgentArtifactPresentationReceipt[]
  resultType: "stored" | "replayed"
  threadId: string
  toolCallId: string | null
}

export interface JingleAgentStateArtifacts {
  manifestsById: Record<string, JingleAgentStateArtifactManifest>
  presentationsByIdempotencyKey: Record<string, JingleAgentStateArtifactPresentation>
}

export interface JingleAgentStateArtifactsUpdate {
  manifests?: JingleAgentStateArtifactManifest[]
  presentations?: JingleAgentStateArtifactPresentation[]
}

export type JingleAgentStateArtifactsReducerInput =
  | JingleAgentStateArtifacts
  | JingleAgentStateArtifactsUpdate

const artifactPresentationReceiptSchema = z.object({
  artifactId: z.string(),
  artifactKey: z.string(),
  dedupeKey: z.string().nullable(),
  outcome: z.enum(JINGLE_AGENT_ARTIFACT_WRITE_OUTCOMES)
})

const jingleAgentStateArtifactManifestSchema = z.object({
  artifactId: z.string(),
  artifactKey: z.string(),
  kind: z.enum(JINGLE_AGENT_ARTIFACT_KINDS),
  mimeType: z.string().nullable(),
  runId: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  sourceType: z.enum(JINGLE_AGENT_ARTIFACT_SOURCE_TYPES),
  status: z.enum(JINGLE_AGENT_ARTIFACT_STATUSES),
  threadId: z.string(),
  title: z.string(),
  toolCallId: z.string().nullable(),
  updatedAt: z.string()
})

const jingleAgentStateArtifactPresentationSchema = z.object({
  idempotencyKey: z.string(),
  presentedAt: z.string(),
  receipts: z.array(artifactPresentationReceiptSchema),
  resultType: z.enum(["stored", "replayed"]),
  threadId: z.string(),
  toolCallId: z.string().nullable()
})

const jingleAgentStateArtifactsSnapshotSchema = z
  .object({
    manifestsById: z.record(z.string(), jingleAgentStateArtifactManifestSchema).default(() => ({})),
    presentationsByIdempotencyKey: z
      .record(z.string(), jingleAgentStateArtifactPresentationSchema)
      .default(() => ({}))
  })
  .strict()

const jingleAgentStateArtifactsSchema = jingleAgentStateArtifactsSnapshotSchema.default(() =>
  createEmptyJingleAgentStateArtifacts()
)

const jingleAgentStateArtifactsUpdateSchema = z
  .union([
    z
      .object({
        manifests: z.array(jingleAgentStateArtifactManifestSchema).optional(),
        presentations: z.array(jingleAgentStateArtifactPresentationSchema).optional()
      })
      .strict(),
    jingleAgentStateArtifactsSnapshotSchema
  ])
  .optional()

export function createEmptyJingleAgentStateArtifacts(): JingleAgentStateArtifacts {
  return {
    manifestsById: {},
    presentationsByIdempotencyKey: {}
  }
}

export function reduceJingleAgentStateArtifacts(
  current: JingleAgentStateArtifacts = createEmptyJingleAgentStateArtifacts(),
  update?: JingleAgentStateArtifactsReducerInput
): JingleAgentStateArtifacts {
  if (!update) {
    return current
  }

  const next: JingleAgentStateArtifacts = {
    manifestsById: { ...current.manifestsById },
    presentationsByIdempotencyKey: { ...current.presentationsByIdempotencyKey }
  }

  if ("manifestsById" in update) {
    for (const [artifactId, manifest] of Object.entries(update.manifestsById)) {
      next.manifestsById[artifactId] = manifest
    }
  } else {
    for (const manifest of update.manifests ?? []) {
      next.manifestsById[manifest.artifactId] = manifest
    }
  }

  if ("presentationsByIdempotencyKey" in update) {
    for (const [idempotencyKey, presentation] of Object.entries(
      update.presentationsByIdempotencyKey
    )) {
      next.presentationsByIdempotencyKey[idempotencyKey] = presentation
    }
  } else {
    for (const presentation of update.presentations ?? []) {
      next.presentationsByIdempotencyKey[presentation.idempotencyKey] = presentation
    }
  }

  return next
}

export const jingleAgentArtifactsValue = new ReducedValue(jingleAgentStateArtifactsSchema, {
  inputSchema: jingleAgentStateArtifactsUpdateSchema,
  reducer: reduceJingleAgentStateArtifacts
})

export const jingleAgentArtifactsStateSchema = new StateSchema({
  artifacts: jingleAgentArtifactsValue
})
