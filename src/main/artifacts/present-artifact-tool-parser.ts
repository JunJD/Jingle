import { stat } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import type { PresentArtifactInput } from "@shared/artifacts"
import { parseToolInputWithSchema } from "../agent/tool-input-schema"
import { assertSafePublicHttpUrl } from "../services/web-tools/url-guard"
import type {
  PresentArtifactToolInput,
  PresentArtifactToolItem
} from "./present-artifact-tool-schema"
import { presentArtifactToolInputSchema } from "./present-artifact-tool-schema"

function ensurePathWithinWorkspace(filePath: string, workspacePath: string): string {
  const resolvedPath = isAbsolute(filePath) ? resolve(filePath) : resolve(workspacePath, filePath)
  const pathRelativeToWorkspace = relative(workspacePath, resolvedPath)

  if (
    pathRelativeToWorkspace === ".." ||
    pathRelativeToWorkspace.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error("present_artifacts only supports files inside the current workspace.")
  }

  return resolvedPath
}

async function buildFileArtifactInput(
  artifact: Extract<PresentArtifactToolItem, { kind: "file" }>,
  workspacePath: string
): Promise<PresentArtifactInput> {
  const normalizedPath = ensurePathWithinWorkspace(artifact.path, workspacePath)
  const fileStats = await stat(normalizedPath)

  if (!fileStats.isFile()) {
    throw new Error(`Artifact path must point to a file: ${normalizedPath}`)
  }

  return {
    artifactKey: "",
    dedupeKey: artifact.dedupeKey,
    kind: "file",
    mimeType: artifact.mimeType ?? null,
    path: normalizedPath,
    previewText: artifact.previewText ?? null,
    sizeBytes: fileStats.size,
    sourceType: "managed-file-path",
    subtitle: artifact.subtitle ?? null,
    title: artifact.title
  }
}

function buildPatchArtifactInput(
  artifact: Extract<PresentArtifactToolItem, { kind: "patch" }>
): PresentArtifactInput {
  return {
    artifactKey: "",
    dedupeKey: artifact.dedupeKey,
    kind: "patch",
    mimeType: artifact.mimeType ?? null,
    patchText: artifact.patchText,
    previewText: artifact.previewText ?? null,
    sourceType: "inline-text",
    subtitle: artifact.subtitle ?? null,
    title: artifact.title
  }
}

async function buildLinkArtifactInput(
  artifact: Extract<PresentArtifactToolItem, { kind: "link" }>
): Promise<PresentArtifactInput> {
  const safeUrl = await assertSafePublicHttpUrl(artifact.url)

  return {
    artifactKey: "",
    dedupeKey: artifact.dedupeKey,
    kind: "link",
    previewText: artifact.previewText ?? null,
    subtitle: artifact.subtitle ?? null,
    title: artifact.title,
    url: safeUrl.toString()
  }
}

function buildSummaryArtifactInput(
  artifact: Extract<PresentArtifactToolItem, { kind: "summary" }>
): PresentArtifactInput {
  return {
    artifactKey: "",
    dedupeKey: artifact.dedupeKey,
    format: artifact.format,
    kind: "summary",
    subtitle: artifact.subtitle ?? null,
    text: artifact.text,
    title: artifact.title
  }
}

async function resolvePresentArtifactToolItem(
  artifact: PresentArtifactToolItem,
  workspacePath: string
): Promise<PresentArtifactInput> {
  switch (artifact.kind) {
    case "file":
      return buildFileArtifactInput(artifact, workspacePath)
    case "patch":
      return buildPatchArtifactInput(artifact)
    case "link":
      return buildLinkArtifactInput(artifact)
    case "summary":
      return buildSummaryArtifactInput(artifact)
  }
}

export async function parsePresentArtifactToolInput(
  input: unknown,
  workspacePath: string
): Promise<PresentArtifactInput[]> {
  const parsed = await parseToolInputWithSchema(
    "present_artifacts",
    presentArtifactToolInputSchema,
    input
  )

  return resolvePresentArtifactToolInput(parsed, workspacePath)
}

export async function resolvePresentArtifactToolInput(
  input: PresentArtifactToolInput,
  workspacePath: string
): Promise<PresentArtifactInput[]> {
  return Promise.all(
    input.artifacts.map((artifact) => resolvePresentArtifactToolItem(artifact, workspacePath))
  )
}
