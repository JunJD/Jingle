export const EXTENSION_SOURCE_REFERENCE_SCHEME = "openwork-extension-source"
export const WORKSPACE_FILE_REFERENCE_SCHEME = "openwork-workspace-file"

export interface ParsedExtensionSourceReference {
  extensionName: string
  label: string
  sourceId: string
  type: "extension-source"
}

export interface ParsedWorkspaceFileReference {
  label: string
  path: string
  type: "workspace-file"
}

export interface ParsedComposerReferenceText {
  references: Array<ParsedExtensionSourceReference | ParsedWorkspaceFileReference>
  tokens: Array<
    | ParsedExtensionSourceReference
    | ParsedWorkspaceFileReference
    | {
        text: string
        type: "text"
      }
  >
}

const COMPOSER_REFERENCE_MARKDOWN_PATTERN =
  /\[(@[^\]\n]+)\]\((openwork-extension-source|openwork-workspace-file):\/\/([^)\s]+)\)/g

function decodeUriSegment(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function encodeUriPayloadSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => {
    return `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  })
}

export function createExtensionSourceReferenceUri(
  extensionName: string,
  sourceId: string
): string {
  return `${EXTENSION_SOURCE_REFERENCE_SCHEME}://${encodeUriPayloadSegment(extensionName)}/${encodeUriPayloadSegment(sourceId)}`
}

export function createWorkspaceFileReferenceUri(path: string): string {
  return `${WORKSPACE_FILE_REFERENCE_SCHEME}://${encodeUriPayloadSegment(path)}`
}

function parseExtensionSourceReference(
  label: string,
  payload: string
): ParsedExtensionSourceReference | null {
  const [encodedExtensionName, encodedSourceId] = payload.split("/")
  if (!encodedExtensionName || !encodedSourceId) {
    return null
  }

  const extensionName = decodeUriSegment(encodedExtensionName)
  const sourceId = decodeUriSegment(encodedSourceId)
  if (!extensionName || !sourceId) {
    return null
  }

  return {
    extensionName,
    label,
    sourceId,
    type: "extension-source"
  }
}

function parseWorkspaceFileReference(
  label: string,
  payload: string
): ParsedWorkspaceFileReference | null {
  const path = decodeUriSegment(payload)
  if (!path) {
    return null
  }

  return {
    label,
    path,
    type: "workspace-file"
  }
}

export function parseComposerReferenceText(text: string): ParsedComposerReferenceText | null {
  const tokens: ParsedComposerReferenceText["tokens"] = []
  const references: ParsedComposerReferenceText["references"] = []
  let lastIndex = 0

  for (const match of text.matchAll(COMPOSER_REFERENCE_MARKDOWN_PATTERN)) {
    const matchText = match[0]
    const matchIndex = match.index ?? 0
    const label = match[1] ?? ""
    const scheme = match[2]
    const payload = match[3] ?? ""
    const reference =
      scheme === EXTENSION_SOURCE_REFERENCE_SCHEME
        ? parseExtensionSourceReference(label, payload)
        : scheme === WORKSPACE_FILE_REFERENCE_SCHEME
          ? parseWorkspaceFileReference(label, payload)
          : null

    if (!reference) {
      continue
    }

    if (matchIndex > lastIndex) {
      tokens.push({
        text: text.slice(lastIndex, matchIndex),
        type: "text"
      })
    }

    tokens.push(reference)
    references.push(reference)
    lastIndex = matchIndex + matchText.length
  }

  if (references.length === 0) {
    return null
  }

  if (lastIndex < text.length) {
    tokens.push({
      text: text.slice(lastIndex),
      type: "text"
    })
  }

  return {
    references,
    tokens
  }
}

export function extractWorkspaceFileReferencePaths(text: string): Set<string> {
  const parsed = parseComposerReferenceText(text)
  if (!parsed) {
    return new Set()
  }

  return new Set(
    parsed.references
      .filter((reference): reference is ParsedWorkspaceFileReference => {
        return reference.type === "workspace-file"
      })
      .map((reference) => reference.path)
  )
}
