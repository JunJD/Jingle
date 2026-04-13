import { basename } from "node:path"
import type {
  ArtifactPresentationContext,
  PresentArtifactInput,
  PresentFileArtifactInput,
  PresentLinkArtifactInput,
  PresentPatchArtifactInput,
  PresentSummaryArtifactInput
} from "../../shared/artifacts"
import type { ArtifactNormalizer, ArtifactRecordDraft } from "./types"

type AnyArtifactNormalizer =
  | ArtifactNormalizer<PresentFileArtifactInput>
  | ArtifactNormalizer<PresentPatchArtifactInput>
  | ArtifactNormalizer<PresentLinkArtifactInput>
  | ArtifactNormalizer<PresentSummaryArtifactInput>

function createBaseDraft(input: PresentArtifactInput, context: ArtifactPresentationContext) {
  return {
    messageId: context.messageId ?? null,
    mimeType: "mimeType" in input ? (input.mimeType ?? null) : null,
    previewText: "previewText" in input ? (input.previewText ?? null) : null,
    runId: context.runId ?? null,
    sizeBytes: "sizeBytes" in input ? (input.sizeBytes ?? null) : null,
    status: "ready" as const,
    subtitle: input.subtitle ?? null,
    threadId: context.threadId,
    title: input.title ?? null,
    toolCallId: context.toolCallId ?? null
  }
}

const fileArtifactNormalizer: ArtifactNormalizer<PresentFileArtifactInput> = {
  canHandle: (input): input is PresentFileArtifactInput => input.kind === "file",
  kind: "file",
  normalize(input, context): ArtifactRecordDraft {
    const base = createBaseDraft(input, context)
    return {
      ...base,
      kind: "file",
      payload: null,
      source: {
        type: input.sourceType,
        uri: input.path
      },
      title: input.title ?? basename(input.path)
    }
  }
}

const patchArtifactNormalizer: ArtifactNormalizer<PresentPatchArtifactInput> = {
  canHandle: (input): input is PresentPatchArtifactInput => input.kind === "patch",
  kind: "patch",
  normalize(input, context): ArtifactRecordDraft {
    const base = createBaseDraft(input, context)

    if (input.sourceType === "inline-text") {
      return {
        ...base,
        kind: "patch",
        payload: {
          format: "diff",
          text: input.patchText
        },
        previewText: input.previewText ?? input.patchText,
        source: {
          type: "inline-text",
          uri: null
        },
        title: input.title ?? "Patch"
      }
    }

    return {
      ...base,
      kind: "patch",
      payload: null,
      source: {
        type: "managed-file-path",
        uri: input.path
      },
      title: input.title ?? basename(input.path)
    }
  }
}

const linkArtifactNormalizer: ArtifactNormalizer<PresentLinkArtifactInput> = {
  canHandle: (input): input is PresentLinkArtifactInput => input.kind === "link",
  kind: "link",
  normalize(input, context): ArtifactRecordDraft {
    const base = createBaseDraft(input, context)
    return {
      ...base,
      kind: "link",
      payload: null,
      source: {
        type: "external-url",
        uri: input.url
      },
      title: input.title
    }
  }
}

const summaryArtifactNormalizer: ArtifactNormalizer<PresentSummaryArtifactInput> = {
  canHandle: (input): input is PresentSummaryArtifactInput => input.kind === "summary",
  kind: "summary",
  normalize(input, context): ArtifactRecordDraft {
    const base = createBaseDraft(input, context)
    return {
      ...base,
      kind: "summary",
      payload: {
        format: input.format ?? "markdown",
        text: input.text
      },
      previewText: input.text,
      source: {
        type: "inline-text",
        uri: null
      },
      title: input.title
    }
  }
}

const artifactNormalizers: AnyArtifactNormalizer[] = [
  fileArtifactNormalizer,
  patchArtifactNormalizer,
  linkArtifactNormalizer,
  summaryArtifactNormalizer
]

export async function normalizePresentArtifact(
  input: PresentArtifactInput,
  context: ArtifactPresentationContext
): Promise<ArtifactRecordDraft> {
  for (const normalizer of artifactNormalizers) {
    if (normalizer.canHandle(input)) {
      return normalizer.normalize(input as never, context)
    }
  }

  throw new Error(`No artifact normalizer registered for kind "${input.kind}".`)
}
