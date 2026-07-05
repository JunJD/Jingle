export interface NotionIdentityProfile {
  aiToolHostRequestId: string
  extensionId: string
  extensionTitle: string
  providerId: string
  subjectTerms: readonly string[]
}

export const NOTION_IDENTITY: NotionIdentityProfile = {
  aiToolHostRequestId: "notion-ai-tool-host-request",
  extensionId: "notion",
  extensionTitle: "Notion",
  providerId: "notion",
  subjectTerms: ["notion"]
}

export const NOTION_EXTENSION_ID = NOTION_IDENTITY.extensionId
export const NOTION_EXTENSION_TITLE = NOTION_IDENTITY.extensionTitle
export const NOTION_PROVIDER_ID = NOTION_IDENTITY.providerId
export const NOTION_SUBJECT_TERMS = NOTION_IDENTITY.subjectTerms
export const NOTION_AI_TOOL_HOST_REQUEST_ID = NOTION_IDENTITY.aiToolHostRequestId

export const NOTION_COMMAND_NAMES = {
  addTextToPage: "add-text-to-page",
  createDatabasePage: "create-database-page",
  quickCapture: "quick-capture",
  searchPage: "search-page"
} as const

export type NotionCommandName = (typeof NOTION_COMMAND_NAMES)[keyof typeof NOTION_COMMAND_NAMES]

export function createNotionCommandUrl(commandName: NotionCommandName): string {
  return `jingle://extensions/${NOTION_EXTENSION_ID}/${commandName}`
}

export function createNotionIntentId(input: {
  commandName: NotionCommandName
  query: string
}): string {
  return `${NOTION_EXTENSION_ID}:${input.commandName}:intent:${input.query}`
}
