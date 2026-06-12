export interface ExtensionIdentityProfile {
  aiToolHostRequestId: string
  extensionId: string
  extensionTitle: string
  providerId: string
  subjectTerms: readonly string[]
}

export const EXTENSION_IDENTITY = {
  aiToolHostRequestId: "figma-files-ai-tool-host-request",
  extensionId: "figma-files",
  extensionTitle: "Figma File Search",
  providerId: "figma",
  subjectTerms: [
    "figma-files",
    "figma files",
    "figma file search",
    "figma-files-raycast-extension",
    "figma"
  ]
} as const satisfies ExtensionIdentityProfile

export const EXTENSION_ID = EXTENSION_IDENTITY.extensionId
export const EXTENSION_TITLE = EXTENSION_IDENTITY.extensionTitle
export const EXTENSION_PROVIDER_ID = EXTENSION_IDENTITY.providerId
export const EXTENSION_ICON = "assets/command-icon.png"
export const EXTENSION_SUBJECT_TERMS = EXTENSION_IDENTITY.subjectTerms
export const EXTENSION_AI_TOOL_HOST_REQUEST_ID = EXTENSION_IDENTITY.aiToolHostRequestId
