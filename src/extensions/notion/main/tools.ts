import { z } from "zod/v4"
import type { ExtensionToolContext, ExtensionToolDefinition } from "@shared/extension-sources"

const NOTION_VERSION = "2026-03-11"
const DEFAULT_NOTION_API_BASE_URL = "https://api.notion.com/v1"

const notionObjectIdSchema = z.string().trim().min(1)

const searchNotionInputSchema = z.object({
  filter: z.enum(["page", "data_source"]).optional(),
  limit: z.number().int().min(1).max(100).optional().default(10),
  query: z.string().trim().optional().default("")
})

const retrievePageInputSchema = z.object({
  pageId: notionObjectIdSchema
})

const listBlockChildrenInputSchema = z.object({
  blockId: notionObjectIdSchema,
  limit: z.number().int().min(1).max(100).optional().default(25)
})

const retrieveDataSourceInputSchema = z.object({
  dataSourceId: notionObjectIdSchema
})

const queryDataSourceInputSchema = z.object({
  dataSourceId: notionObjectIdSchema,
  filter: z.record(z.string(), z.unknown()).optional(),
  limit: z.number().int().min(1).max(100).optional().default(25),
  sorts: z.array(z.record(z.string(), z.unknown())).optional()
})

type SearchNotionInput = z.infer<typeof searchNotionInputSchema>
type RetrievePageInput = z.infer<typeof retrievePageInputSchema>
type ListBlockChildrenInput = z.infer<typeof listBlockChildrenInputSchema>
type RetrieveDataSourceInput = z.infer<typeof retrieveDataSourceInputSchema>
type QueryDataSourceInput = z.infer<typeof queryDataSourceInputSchema>

interface NotionPreferences {
  accessToken: string
  apiBaseUrl: string
}

type NotionPageOrDatabaseObject = Record<string, unknown> & {
  id?: unknown
  object?: unknown
  url?: unknown
}

interface NotionListResponse {
  has_more?: boolean
  next_cursor?: string | null
  results?: NotionPageOrDatabaseObject[]
}

function resolveNotionPreferences(ctx: ExtensionToolContext): NotionPreferences {
  const preferences = ctx.extensionPreferences
  const apiBaseUrl = String(preferences.apiBaseUrl ?? "").trim()

  return {
    accessToken: String(preferences.accessToken ?? "").trim(),
    apiBaseUrl: (apiBaseUrl || DEFAULT_NOTION_API_BASE_URL).replace(/\/+$/, "")
  }
}

async function requestNotionJson<T>(params: {
  body?: Record<string, unknown>
  method: "GET" | "POST"
  path: string
  preferences: NotionPreferences
}): Promise<T> {
  const response = await fetch(`${params.preferences.apiBaseUrl}${params.path}`, {
    body: params.body ? JSON.stringify(params.body) : undefined,
    headers: {
      Authorization: `Bearer ${params.preferences.accessToken}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION
    },
    method: params.method
  })

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    const message = typeof payload.message === "string" ? payload.message : response.statusText
    throw new Error(`Notion request failed (${response.status}). ${message}`)
  }

  return payload as T
}

function selectPlainText(value: unknown): string {
  if (!Array.isArray(value)) {
    return ""
  }

  return value
    .map((entry) =>
      typeof entry === "object" &&
      entry !== null &&
      "plain_text" in entry &&
      typeof entry.plain_text === "string"
        ? entry.plain_text
        : ""
    )
    .join("")
}

function selectTitleFromProperties(properties: unknown): string {
  if (typeof properties !== "object" || properties === null) {
    return ""
  }

  for (const property of Object.values(properties)) {
    if (
      typeof property === "object" &&
      property !== null &&
      "type" in property &&
      property.type === "title" &&
      "title" in property
    ) {
      return selectPlainText(property.title)
    }
  }

  return ""
}

function summarizeNotionObject(item: NotionPageOrDatabaseObject): Record<string, unknown> {
  const properties = item.properties
  const title =
    typeof item.title === "string"
      ? item.title
      : Array.isArray(item.title)
        ? selectPlainText(item.title)
        : selectTitleFromProperties(properties)

  return {
    archived: item.archived,
    createdTime: item.created_time,
    id: item.id,
    lastEditedTime: item.last_edited_time,
    object: item.object,
    title,
    url: item.url
  }
}

export function createNotionTools(): ExtensionToolDefinition[] {
  const searchNotionTool: ExtensionToolDefinition<SearchNotionInput> = {
    access: "read",
    description: "Search Notion pages or data sources shared with the connected integration.",
    handler: async (ctx, input) => {
      const body: Record<string, unknown> = {
        page_size: input.limit,
        query: input.query
      }
      if (input.filter) {
        body.filter = {
          property: "object",
          value: input.filter
        }
      }

      const response = await requestNotionJson<NotionListResponse>({
        body,
        method: "POST",
        path: "/search",
        preferences: resolveNotionPreferences(ctx)
      })

      return {
        hasMore: response.has_more === true,
        nextCursor: response.next_cursor ?? null,
        results: (response.results ?? []).map(summarizeNotionObject)
      }
    },
    inputSchema: searchNotionInputSchema,
    name: "searchPages",
    title: "Search Pages"
  }

  const retrievePageTool: ExtensionToolDefinition<RetrievePageInput> = {
    access: "read",
    description: "Retrieve a Notion page's metadata and properties.",
    handler: (ctx, input) =>
      requestNotionJson({
        method: "GET",
        path: `/pages/${encodeURIComponent(input.pageId)}`,
        preferences: resolveNotionPreferences(ctx)
      }),
    inputSchema: retrievePageInputSchema,
    name: "retrievePage",
    title: "Retrieve Page"
  }

  const listBlockChildrenTool: ExtensionToolDefinition<ListBlockChildrenInput> = {
    access: "read",
    description: "Retrieve child blocks for a Notion page or block.",
    handler: (ctx, input) =>
      requestNotionJson({
        method: "GET",
        path: `/blocks/${encodeURIComponent(input.blockId)}/children?page_size=${input.limit}`,
        preferences: resolveNotionPreferences(ctx)
      }),
    inputSchema: listBlockChildrenInputSchema,
    name: "listBlockChildren",
    title: "List Block Children"
  }

  const retrieveDataSourceTool: ExtensionToolDefinition<RetrieveDataSourceInput> = {
    access: "read",
    description: "Retrieve a Notion data source schema shared with the connected integration.",
    handler: (ctx, input) =>
      requestNotionJson({
        method: "GET",
        path: `/data_sources/${encodeURIComponent(input.dataSourceId)}`,
        preferences: resolveNotionPreferences(ctx)
      }),
    inputSchema: retrieveDataSourceInputSchema,
    name: "retrieveDataSource",
    title: "Retrieve Data Source"
  }

  const queryDataSourceTool: ExtensionToolDefinition<QueryDataSourceInput> = {
    access: "read",
    description: "Query a Notion data source shared with the connected integration.",
    handler: (ctx, input) => {
      const body: Record<string, unknown> = {
        page_size: input.limit
      }
      if (input.filter) {
        body.filter = input.filter
      }
      if (input.sorts) {
        body.sorts = input.sorts
      }

      return requestNotionJson({
        body,
        method: "POST",
        path: `/data_sources/${encodeURIComponent(input.dataSourceId)}/query`,
        preferences: resolveNotionPreferences(ctx)
      })
    },
    inputSchema: queryDataSourceInputSchema,
    name: "queryDataSource",
    title: "Query Data Source"
  }

  return [
    searchNotionTool,
    retrievePageTool,
    listBlockChildrenTool,
    retrieveDataSourceTool,
    queryDataSourceTool
  ]
}
