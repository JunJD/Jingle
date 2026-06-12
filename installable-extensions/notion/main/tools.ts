import { z } from "zod/v4"
import { runWithExtensionRuntimeSdk } from "@openwork/extension-api"
import {
  createAppendMarkdownRequest,
  createDatabasePageRequest,
  createQueryDataSourceRequest,
  createSearchRequest,
  toListToolOutput,
  type CreateDatabasePageToolInput,
  type QueryDataSourceToolInput,
  type SearchDatabaseToolInput
} from "../domain/ai-tools"
import { getNotionClient } from "../domain/client"
import { getPageContent, getPageMarkdown, searchPages, serializeNotionError } from "../domain/page-content"
import type {
  ExtensionRuntimeSdkContextValue,
  ExtensionToolConfirmation,
  ExtensionToolContext,
  ExtensionToolDefinition
} from "@openwork/extension-api"
import { NOTION_AI_TOOL_HOST_REQUEST_ID } from "../identity"

// Keep AI tools on main/domain helpers instead of UI command modules.
const notionObjectIdSchema = z.string().trim().min(1)
const notionObjectFilterSchema = z.enum(["page", "data_source"])

const addToPageInputSchema = z.object({
  addDateDivider: z.boolean().optional().default(false),
  content: z.string().trim().min(1),
  pageId: notionObjectIdSchema,
  prepend: z.boolean().optional().default(false)
})

const createPageInputSchema = z.object({
  content: z.string().trim().optional().default(""),
  databaseId: notionObjectIdSchema,
  title: z.string().trim().min(1)
})

const createDatabasePageInputSchema = z.object({
  addDateDivider: z.boolean().optional().default(false),
  content: z.string().trim().optional().default(""),
  contentBlocks: z
    .array(
      z.object({
        type: z.literal("bookmark"),
        url: z.string().trim().min(1)
      })
    )
    .optional(),
  dataSourceId: notionObjectIdSchema,
  properties: z
    .record(
      z.string(),
      z.union([
        z.object({
          type: z.literal("checkbox"),
          value: z.boolean()
        }),
        z.object({
          type: z.literal("multi_select"),
          value: z.array(z.string().trim().min(1))
        }),
        z.object({
          type: z.literal("people"),
          value: z.array(z.string().trim().min(1))
        }),
        z.object({
          type: z.literal("relation"),
          value: z.array(z.string().trim().min(1))
        }),
        z.object({
          type: z.literal("number"),
          value: z.number()
        }),
        z.object({
          type: z.enum(["date", "email", "phone_number", "rich_text", "select", "status", "url"]),
          value: z.string().trim().min(1)
        })
      ])
    )
    .optional(),
  title: z.string().trim().min(1),
  titlePropertyName: z.string().trim().optional()
})

const getDatabasesInputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(100),
  query: z.string().trim().optional().default(""),
  startCursor: z.string().trim().min(1).optional()
})

const getPageInputSchema = z.object({
  pageId: notionObjectIdSchema
})

const getPageMarkdownInputSchema = z.object({
  pageId: notionObjectIdSchema
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
  query: z.string().trim().optional().default(""),
  sorts: z.array(z.record(z.string(), z.unknown())).optional(),
  startCursor: z.string().trim().min(1).optional()
})

const searchDatabaseInputSchema = z.object({
  databaseId: notionObjectIdSchema,
  limit: z.number().int().min(1).max(100).optional().default(25),
  query: z.string().trim().optional().default(""),
  startCursor: z.string().trim().min(1).optional()
})

const searchPagesInputSchema = z.object({
  filter: notionObjectFilterSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  query: z.string().trim().optional(),
  searchText: z.string().trim().optional(),
  startCursor: z.string().trim().min(1).optional()
})

type AddToPageInput = z.infer<typeof addToPageInputSchema>
type CreateDatabasePageInput = z.infer<typeof createDatabasePageInputSchema>
type GetDatabasesInput = z.infer<typeof getDatabasesInputSchema>
type GetPageInput = z.infer<typeof getPageInputSchema>
type GetPageMarkdownInput = z.infer<typeof getPageMarkdownInputSchema>
type ListBlockChildrenInput = z.infer<typeof listBlockChildrenInputSchema>
type QueryDataSourceInput = QueryDataSourceToolInput & z.infer<typeof queryDataSourceInputSchema>
type RetrieveDataSourceInput = z.infer<typeof retrieveDataSourceInputSchema>
type RetrievePageInput = z.infer<typeof retrievePageInputSchema>
type SearchDatabaseInput = SearchDatabaseToolInput & z.infer<typeof searchDatabaseInputSchema>
type SearchPagesInput = z.infer<typeof searchPagesInputSchema>

interface NotionClient {
  blocks: {
    children: {
      append(input: Record<string, unknown>): Promise<{ results?: unknown[] }>
      list(input: Record<string, unknown>): Promise<unknown>
    }
  }
  dataSources: {
    query(input: Record<string, unknown>): Promise<unknown>
    retrieve(input: Record<string, unknown>): Promise<unknown>
  }
  pages: {
    create(input: Record<string, unknown>): Promise<unknown>
    retrieve(input: Record<string, unknown>): Promise<unknown>
  }
  search(input: Record<string, unknown>): Promise<unknown>
}

function createMigratedToolSdkContext(ctx: ExtensionToolContext): ExtensionRuntimeSdkContextValue {
  return {
    commandName: ctx.toolName,
    commandPreferences: {},
    extensionName: ctx.extensionName,
    extensionPreferences: ctx.extensionPreferences,
    initialAction: "open",
    locale: "zh-CN",
    mode: "no-view",
    navigation: {
      canPop: false,
      goHome: () => {},
      hideLauncher: async () => {},
      openCommand: async () => {},
      pop: () => {},
      push: () => {}
    },
    requestHost: async () => ({
      id: NOTION_AI_TOOL_HOST_REQUEST_ID,
      ok: true,
      result: null
    }),
    seedQuery: ""
  }
}

async function runWithNotionClient<TOutput>(
  ctx: ExtensionToolContext,
  callback: (notion: NotionClient) => Promise<TOutput>
): Promise<TOutput> {
  return runWithExtensionRuntimeSdk(createMigratedToolSdkContext(ctx), async () => {
    return callback(getNotionClient() as NotionClient)
  })
}

async function addToPageTool(ctx: ExtensionToolContext, input: unknown): Promise<unknown> {
  const parsedInput = input as AddToPageInput

  return runWithNotionClient(ctx, async (notion) => {
    const response = await notion.blocks.children.append(createAppendMarkdownRequest(parsedInput))

    return {
      appendedBlockCount: response.results?.length ?? 0,
      pageId: parsedInput.pageId
    }
  })
}

function addToPageConfirmation(input: unknown): ExtensionToolConfirmation {
  const parsedInput = input as AddToPageInput
  return {
    info: [{ name: "content", value: parsedInput.content }],
    message: "Are you sure you want to add the content to the page?"
  }
}

async function createPageTool(ctx: ExtensionToolContext, input: unknown): Promise<unknown> {
  const parsedInput = input as z.infer<typeof createPageInputSchema>
  return createDatabasePageTool(ctx, {
    addDateDivider: false,
    content: parsedInput.content,
    dataSourceId: parsedInput.databaseId,
    title: parsedInput.title
  } satisfies CreateDatabasePageInput)
}

async function createPageConfirmation(
  ctx: ExtensionToolContext,
  input: unknown
): Promise<ExtensionToolConfirmation> {
  const parsedInput = input as z.infer<typeof createPageInputSchema>
  let databaseName = parsedInput.databaseId

  await runWithNotionClient(ctx, async (notion) => {
    try {
      const dataSource = await notion.dataSources.retrieve({
        data_source_id: parsedInput.databaseId
      })
      if (
        dataSource &&
        typeof dataSource === "object" &&
        "title" in dataSource &&
        Array.isArray(dataSource.title)
      ) {
        databaseName = dataSource.title[0]?.plain_text ?? databaseName
      }
    } catch {
      // Keep the raw id when metadata lookup fails.
    }
  })

  return {
    info: [
      { name: "Title", value: parsedInput.title },
      { name: "Content", value: parsedInput.content },
      { name: "In database", value: databaseName }
    ],
    message: "Are you sure you want to create the page?"
  }
}

async function getDatabasesTool(ctx: ExtensionToolContext, input: unknown): Promise<unknown> {
  return runWithNotionClient(ctx, async (notion) => {
    const response = await notion.search({
      ...createSearchRequest(input as GetDatabasesInput),
      filter: {
        property: "object",
        value: "data_source"
      }
    })
    return toListToolOutput(response)
  })
}

async function getPageTool(ctx: ExtensionToolContext, input: unknown): Promise<unknown> {
  const parsedInput = input as GetPageInput

  return runWithExtensionRuntimeSdk(createMigratedToolSdkContext(ctx), async () => {
    try {
      return await getPageContent(parsedInput.pageId)
    } catch (error) {
      return {
        content: serializeNotionError(error),
        status: "error"
      }
    }
  })
}

async function getPageMarkdownTool(ctx: ExtensionToolContext, input: unknown): Promise<unknown> {
  const parsedInput = input as GetPageMarkdownInput

  return runWithExtensionRuntimeSdk(createMigratedToolSdkContext(ctx), async () => {
    try {
      return await getPageMarkdown(parsedInput.pageId)
    } catch (error) {
      return {
        markdown: serializeNotionError(error),
        status: "error"
      }
    }
  })
}

async function retrievePageTool(ctx: ExtensionToolContext, input: unknown): Promise<unknown> {
  return runWithNotionClient(ctx, (notion) =>
    notion.pages.retrieve({
      page_id: (input as RetrievePageInput).pageId
    })
  )
}

async function listBlockChildrenTool(ctx: ExtensionToolContext, input: unknown): Promise<unknown> {
  const parsedInput = input as ListBlockChildrenInput
  return runWithNotionClient(ctx, (notion) =>
    notion.blocks.children.list({
      block_id: parsedInput.blockId,
      page_size: parsedInput.limit
    })
  )
}

async function retrieveDataSourceTool(ctx: ExtensionToolContext, input: unknown): Promise<unknown> {
  return runWithNotionClient(ctx, (notion) =>
    notion.dataSources.retrieve({
      data_source_id: (input as RetrieveDataSourceInput).dataSourceId
    })
  )
}

async function searchDatabaseTool(ctx: ExtensionToolContext, input: unknown): Promise<unknown> {
  return runWithNotionClient(ctx, async (notion) => {
    const response = await notion.dataSources.query(
      createQueryDataSourceRequest(input as SearchDatabaseInput)
    )
    return toListToolOutput(response)
  })
}

async function queryDataSourceTool(ctx: ExtensionToolContext, input: unknown): Promise<unknown> {
  return runWithNotionClient(ctx, async (notion) => {
    const response = await notion.dataSources.query(
      createQueryDataSourceRequest(input as QueryDataSourceInput)
    )
    return toListToolOutput(response)
  })
}

async function searchPagesTool(ctx: ExtensionToolContext, input: unknown): Promise<unknown> {
  const parsedInput = input as SearchPagesInput

  if (
    parsedInput.searchText !== undefined &&
    parsedInput.query === undefined &&
    parsedInput.filter === undefined &&
    parsedInput.limit === undefined &&
    parsedInput.startCursor === undefined
  ) {
    return runWithExtensionRuntimeSdk(createMigratedToolSdkContext(ctx), async () => {
      const allPages: Array<{
        id: string
        parent_database_id?: string
        parent_page_id?: string
        title: string
        url?: string
      }> = []
      let cursor: string | undefined
      let hasNextPage = true
      const pageSize = 100

      while (hasNextPage && allPages.length < 250) {
        const result = await searchPages(parsedInput.searchText, cursor, pageSize)
        allPages.push(
          ...result.pages.map((page) => ({
            id: page.id,
            parent_database_id: page.parent_database_id,
            parent_page_id: page.parent_page_id,
            title: page.title ?? "Untitled",
            url: page.url
          }))
        )
        hasNextPage = result.hasMore
        cursor = result.nextCursor ?? undefined
      }

      return allPages
    })
  }

  return runWithNotionClient(ctx, async (notion) => {
    const response = await notion.search(createSearchRequest(parsedInput))
    return toListToolOutput(response)
  })
}

async function createDatabasePageTool(ctx: ExtensionToolContext, input: unknown): Promise<unknown> {
  const parsedInput = input as CreateDatabasePageInput

  return runWithNotionClient(ctx, (notion) => {
    return notion.pages.create(
      createDatabasePageRequest(parsedInput as CreateDatabasePageToolInput)
    )
  })
}

export function createNotionTools(): ExtensionToolDefinition[] {
  return [
    {
      access: "read",
      description: "Search for pages in Notion.",
      handler: async (ctx, input) => {
        return searchPagesTool(ctx, input)
      },
      inputSchema: searchPagesInputSchema,
      name: "searchPages",
      title: "Search Pages"
    },

    {
      access: "read",
      description: "Get the content of a Notion page.",
      handler: async (ctx, input) => {
        return getPageTool(ctx, input)
      },
      inputSchema: getPageInputSchema,
      name: "getPage",
      title: "Get Page"
    },

    {
      access: "read",
      description: "Retrieve a Notion page's metadata and properties.",
      handler: async (ctx, input) => {
        return retrievePageTool(ctx, input)
      },
      inputSchema: retrievePageInputSchema,
      name: "retrievePage",
      title: "Retrieve Page"
    },

    {
      access: "read",
      description: "Retrieve a Notion page's child blocks as Markdown.",
      handler: async (ctx, input) => {
        return getPageMarkdownTool(ctx, input)
      },
      inputSchema: getPageMarkdownInputSchema,
      name: "getPageMarkdown",
      title: "Get Page Markdown"
    },

    {
      access: "read",
      description: "Retrieve child blocks for a Notion page or block.",
      handler: async (ctx, input) => {
        return listBlockChildrenTool(ctx, input)
      },
      inputSchema: listBlockChildrenInputSchema,
      name: "listBlockChildren",
      title: "List Block Children"
    },

    {
      access: "read",
      description: "Get Notion databases.",
      handler: async (ctx, input) => {
        return getDatabasesTool(ctx, input)
      },
      inputSchema: getDatabasesInputSchema,
      name: "getDatabases",
      title: "Get Databases"
    },

    {
      access: "read",
      description: "Retrieve a Notion data source schema shared with the connected integration.",
      handler: async (ctx, input) => {
        return retrieveDataSourceTool(ctx, input)
      },
      inputSchema: retrieveDataSourceInputSchema,
      name: "retrieveDataSource",
      title: "Retrieve Data Source"
    },

    {
      access: "read",
      description: "Search for pages and/or databases contained in the given Notion database.",
      handler: async (ctx, input) => {
        return searchDatabaseTool(ctx, input)
      },
      inputSchema: searchDatabaseInputSchema,
      name: "searchDatabase",
      title: "Search Database"
    },

    {
      access: "read",
      description: "Query a Notion data source shared with the connected integration.",
      handler: async (ctx, input) => {
        return queryDataSourceTool(ctx, input)
      },
      inputSchema: queryDataSourceInputSchema,
      name: "queryDataSource",
      title: "Query Data Source"
    },

    {
      access: "write",
      approval: {
        confirmation: async (input) => {
          return addToPageConfirmation(input)
        }
      },
      description: "Append markdown to a Notion page.",
      handler: async (ctx, input) => {
        return addToPageTool(ctx, input)
      },
      inputSchema: addToPageInputSchema,
      name: "addToPage",
      title: "Add to Page"
    },

    {
      access: "write",
      approval: {
        confirmation: async (input, ctx) => {
          return createPageConfirmation(ctx, input)
        }
      },
      description: "Create a Notion page in a specific database.",
      handler: async (ctx, input) => {
        return createPageTool(ctx, input)
      },
      inputSchema: createPageInputSchema,
      name: "createPage",
      title: "Create Page"
    },

    {
      access: "write",
      approval: {
        confirmation: async (input, ctx) => {
          return createPageConfirmation(ctx, input)
        }
      },
      description:
        "Create a Notion page in a data source with a title and optional Markdown content.",
      handler: async (ctx, input) => {
        return createDatabasePageTool(ctx, input)
      },
      inputSchema: createDatabasePageInputSchema,
      name: "createDatabasePage",
      title: "Create Database Page"
    }
  ]
}
