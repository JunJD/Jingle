import type {
  ArtifactPresentationContext,
  ArtifactRecord,
  ArtifactSource,
  ArtifactSourceType,
  ArtifactStatus,
  PresentArtifactInput
} from "../../shared/artifacts"

export type ArtifactRecordDraft = Omit<ArtifactRecord, "createdAt" | "id" | "updatedAt">

export interface ArtifactNormalizer<Input extends PresentArtifactInput = PresentArtifactInput> {
  canHandle: (input: PresentArtifactInput) => input is Input
  kind: Input["kind"]
  normalize: (
    input: Input,
    context: ArtifactPresentationContext
  ) => ArtifactRecordDraft | Promise<ArtifactRecordDraft>
}

export interface ArtifactPersistenceFields {
  payloadJson: string | null
  sourceType: ArtifactSourceType
  sourceUri: string | null
}

export interface ArtifactPersistenceRow extends ArtifactPersistenceFields {
  artifactId: string
  createdAt: bigint
  kind: ArtifactRecord["kind"]
  messageId: string | null
  mimeType: string | null
  previewText: string | null
  runId: string | null
  sizeBytes: bigint | null
  status: ArtifactStatus
  subtitle: string | null
  threadId: string
  title: string
  toolCallId: string | null
  updatedAt: bigint
}

export class ArtifactCodecError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ArtifactCodecError"
  }
}

export function toArtifactPersistenceFields(props: {
  payload: ArtifactRecord["payload"]
  source: ArtifactSource
}): ArtifactPersistenceFields {
  return {
    payloadJson: props.payload ? JSON.stringify(props.payload) : null,
    sourceType: props.source.type,
    sourceUri: props.source.uri
  }
}

export function decodeArtifactSource(props: ArtifactPersistenceFields): ArtifactSource {
  switch (props.sourceType) {
    case "managed-file-path":
    case "external-url":
      if (!props.sourceUri) {
        throw new ArtifactCodecError(`Artifact source ${props.sourceType} requires sourceUri`)
      }

      return {
        type: props.sourceType,
        uri: props.sourceUri
      }
    case "inline-text":
      return {
        type: "inline-text",
        uri: null
      }
    default:
      throw new ArtifactCodecError(
        `Unsupported artifact source type: ${props.sourceType satisfies never}`
      )
  }
}

export function decodeArtifactRecord(row: ArtifactPersistenceRow): ArtifactRecord {
  const source = decodeArtifactSource(row)
  const payload = row.payloadJson ? JSON.parse(row.payloadJson) : null
  const baseRecord = {
    createdAt: new Date(Number(row.createdAt)),
    id: row.artifactId,
    messageId: row.messageId,
    mimeType: row.mimeType,
    previewText: row.previewText,
    runId: row.runId,
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    status: row.status,
    subtitle: row.subtitle,
    threadId: row.threadId,
    title: row.title,
    toolCallId: row.toolCallId,
    updatedAt: new Date(Number(row.updatedAt))
  }

  switch (row.kind) {
    case "file":
      if (source.type !== "managed-file-path") {
        throw new ArtifactCodecError(
          `File artifact requires managed-file-path source, got ${source.type}`
        )
      }

      return {
        ...baseRecord,
        kind: "file",
        payload: null,
        source
      }
    case "patch":
      if (source.type === "inline-text") {
        if (!payload || payload.format !== "diff" || typeof payload.text !== "string") {
          throw new ArtifactCodecError("Inline patch artifact requires diff payload")
        }

        return {
          ...baseRecord,
          kind: "patch",
          payload,
          source
        }
      }

      if (source.type !== "managed-file-path") {
        throw new ArtifactCodecError(
          `Managed patch artifact requires managed-file-path source, got ${source.type}`
        )
      }

      if (payload !== null) {
        throw new ArtifactCodecError("Managed patch artifact must not persist payloadJson")
      }

      return {
        ...baseRecord,
        kind: "patch",
        payload: null,
        source
      }
    case "link":
      if (source.type !== "external-url") {
        throw new ArtifactCodecError(
          `Link artifact requires external-url source, got ${source.type}`
        )
      }

      if (payload !== null) {
        throw new ArtifactCodecError("Link artifact must not persist payloadJson")
      }

      return {
        ...baseRecord,
        kind: "link",
        payload: null,
        source
      }
    case "summary":
      if (source.type !== "inline-text") {
        throw new ArtifactCodecError(
          `Summary artifact requires inline-text source, got ${source.type}`
        )
      }

      if (
        !payload ||
        (payload.format !== "markdown" && payload.format !== "plain") ||
        typeof payload.text !== "string"
      ) {
        throw new ArtifactCodecError("Summary artifact requires text payload")
      }

      return {
        ...baseRecord,
        kind: "summary",
        payload,
        source
      }
    default:
      throw new ArtifactCodecError(`Unsupported artifact kind: ${row.kind satisfies never}`)
  }
}
