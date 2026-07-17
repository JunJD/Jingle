import { APIErrorCode, isNotionClientError } from "@notionhq/client"
import { z } from "zod/v4"
import { runWithExtensionRuntimeSdk } from "@jingle/extension-api"
import {
  createAppendBlockChildrenRequests,
  createAppendMarkdownRequests,
  createDatabasePageWritePlan,
  createQueryDataSourceRequest,
  createSearchRequest,
  toListToolOutput,
  type CreateDatabasePageToolInput,
  type QueryDataSourceToolInput
} from "../domain/ai-tools"
import { getNotionClient } from "../domain/client"
import { getPageContent, getPageMarkdown, serializeNotionError } from "../domain/page-content"
import type {
  ExtensionRuntimeSdkContextValue,
  ExtensionToolConfirmation,
  ExtensionToolContext,
  ExtensionToolDefinition
} from "@jingle/extension-api"
import { NOTION_AI_TOOL_HOST_REQUEST_ID } from "../identity"

// Keep AI tools on main/domain helpers instead of UI command modules.
const notionObjectIdSchema = z.string().trim().min(1)
const notionObjectFilterSchema = z.enum(["page", "data_source"])

const addToPageInputSchema = z
  .object({
    addDateDivider: z.boolean().optional().default(false),
    content: z.string().trim().min(1),
    pageId: notionObjectIdSchema,
    prepend: z.boolean().optional().default(false)
  })
  .strict()

const createDatabasePageInputSchema = z
  .object({
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
  .strict()

const getDatabasesInputSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional().default(100),
    query: z.string().trim().optional().default(""),
    startCursor: z.string().trim().min(1).optional()
  })
  .strict()

const getPageInputSchema = z
  .object({
    pageId: notionObjectIdSchema
  })
  .strict()

const getPageMarkdownInputSchema = z
  .object({
    pageId: notionObjectIdSchema
  })
  .strict()

const retrievePageInputSchema = z
  .object({
    pageId: notionObjectIdSchema
  })
  .strict()

const listBlockChildrenInputSchema = z
  .object({
    blockId: notionObjectIdSchema,
    limit: z.number().int().min(1).max(100).optional().default(25)
  })
  .strict()

const retrieveDataSourceInputSchema = z
  .object({
    dataSourceId: notionObjectIdSchema
  })
  .strict()

const queryDataSourceInputSchema = z
  .object({
    dataSourceId: notionObjectIdSchema,
    filter: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().min(1).max(100).optional().default(25),
    query: z.string().trim().optional().default(""),
    sorts: z.array(z.record(z.string(), z.unknown())).optional(),
    startCursor: z.string().trim().min(1).optional()
  })
  .strict()

const searchPagesInputSchema = z
  .object({
    filter: notionObjectFilterSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
    query: z.string().trim().optional(),
    startCursor: z.string().trim().min(1).optional()
  })
  .strict()

type AddToPageInput = z.infer<typeof addToPageInputSchema>
type CreateDatabasePageInput = z.infer<typeof createDatabasePageInputSchema>
type GetDatabasesInput = z.infer<typeof getDatabasesInputSchema>
type GetPageInput = z.infer<typeof getPageInputSchema>
type GetPageMarkdownInput = z.infer<typeof getPageMarkdownInputSchema>
type ListBlockChildrenInput = z.infer<typeof listBlockChildrenInputSchema>
type QueryDataSourceInput = QueryDataSourceToolInput & z.infer<typeof queryDataSourceInputSchema>
type RetrieveDataSourceInput = z.infer<typeof retrieveDataSourceInputSchema>
type RetrievePageInput = z.infer<typeof retrievePageInputSchema>
type SearchPagesInput = z.infer<typeof searchPagesInputSchema>

type RecoverableInvalidPropertyOptionResult = {
  code: "invalid_property_option"
  dataSourceId: string
  message: string
  nextAction: string
  status: "error"
}

type RecoverableDataSourceNotFoundResult = {
  code: "notion_data_source_not_found"
  dataSourceId: string
  message: string
  nextAction: string
  status: "error"
}

type RecoverablePageOrBlockNotFoundResult = {
  code: "notion_page_or_block_not_found"
  message: string
  nextAction: string
  objectId: string
  objectKind: "block" | "page"
  status: "error"
}

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
    dataIdentity: { kind: "unavailable" },
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

async function appendBlockChildrenRequestsInOrder(
  notion: NotionClient,
  requests: Array<Record<string, unknown>>
): Promise<Array<{ results?: unknown[] }>> {
  const responses: Array<{ results?: unknown[] }> = []
  // Notion inserts block batches positionally, so multi-batch writes must preserve request order.
  await requests.reduce<Promise<void>>(
    (previousAppend, request) =>
      previousAppend.then(async () => {
        responses.push(await notion.blocks.children.append(request))
      }),
    Promise.resolve()
  )
  return responses
}

async function addToPageTool(ctx: ExtensionToolContext, input: unknown): Promise<unknown> {
  const parsedInput = input as AddToPageInput

  return runWithNotionClient(ctx, async (notion) => {
    try {
      const responses = await appendBlockChildrenRequestsInOrder(
        notion,
        createAppendMarkdownRequests(parsedInput)
      )
      const appendedBlockCount = responses.reduce(
        (total, response) => total + (response.results?.length ?? 0),
        0
      )

      return {
        appendedBlockCount,
        pageId: parsedInput.pageId
      }
    } catch (error) {
      const recoverableResult = toRecoverablePageOrBlockNotFoundResult(error, {
        objectId: parsedInput.pageId,
        objectKind: "page"
      })
      if (recoverableResult) {
        return recoverableResult
      }

      throw error
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

async function createDatabasePageConfirmation(
  ctx: ExtensionToolContext,
  input: unknown
): Promise<ExtensionToolConfirmation> {
  const parsedInput = input as CreateDatabasePageInput
  let dataSourceName = parsedInput.dataSourceId

  await runWithNotionClient(ctx, async (notion) => {
    try {
      const dataSource = await notion.dataSources.retrieve({
        data_source_id: parsedInput.dataSourceId
      })
      if (
        dataSource &&
        typeof dataSource === "object" &&
        "title" in dataSource &&
        Array.isArray(dataSource.title)
      ) {
        dataSourceName = dataSource.title[0]?.plain_text ?? dataSourceName
      }
    } catch {
      // Keep the raw id when metadata lookup fails.
    }
  })

  return {
    info: [
      { name: "Title", value: parsedInput.title },
      { name: "Content", value: parsedInput.content },
      { name: "In data source", value: dataSourceName }
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
  const parsedInput = input as RetrievePageInput
  return runWithNotionClient(ctx, async (notion) => {
    try {
      return await notion.pages.retrieve({
        page_id: parsedInput.pageId
      })
    } catch (error) {
      const recoverableResult = toRecoverablePageOrBlockNotFoundResult(error, {
        objectId: parsedInput.pageId,
        objectKind: "page"
      })
      if (recoverableResult) {
        return recoverableResult
      }

      throw error
    }
  })
}

async function listBlockChildrenTool(ctx: ExtensionToolContext, input: unknown): Promise<unknown> {
  const parsedInput = input as ListBlockChildrenInput
  return runWithNotionClient(ctx, async (notion) => {
    try {
      return await notion.blocks.children.list({
        block_id: parsedInput.blockId,
        page_size: parsedInput.limit
      })
    } catch (error) {
      const recoverableResult = toRecoverablePageOrBlockNotFoundResult(error, {
        objectId: parsedInput.blockId,
        objectKind: "block"
      })
      if (recoverableResult) {
        return recoverableResult
      }

      throw error
    }
  })
}

async function retrieveDataSourceTool(ctx: ExtensionToolContext, input: unknown): Promise<unknown> {
  const parsedInput = input as RetrieveDataSourceInput
  return runWithNotionClient(ctx, async (notion) => {
    try {
      return await notion.dataSources.retrieve({
        data_source_id: parsedInput.dataSourceId
      })
    } catch (error) {
      const recoverableResult = toRecoverableDataSourceNotFoundResult(error, parsedInput)
      if (recoverableResult) {
        return recoverableResult
      }

      throw error
    }
  })
}

async function queryDataSourceTool(ctx: ExtensionToolContext, input: unknown): Promise<unknown> {
  const parsedInput = input as QueryDataSourceInput
  return runWithNotionClient(ctx, async (notion) => {
    try {
      const response = await notion.dataSources.query(createQueryDataSourceRequest(parsedInput))
      return toListToolOutput(response)
    } catch (error) {
      const recoverableResult = toRecoverableDataSourceNotFoundResult(error, parsedInput)
      if (recoverableResult) {
        return recoverableResult
      }

      throw error
    }
  })
}

async function searchPagesTool(ctx: ExtensionToolContext, input: unknown): Promise<unknown> {
  const parsedInput = input as SearchPagesInput

  return runWithNotionClient(ctx, async (notion) => {
    const response = await notion.search(createSearchRequest(parsedInput))
    return toListToolOutput(response)
  })
}

async function createDatabasePageTool(ctx: ExtensionToolContext, input: unknown): Promise<unknown> {
  const parsedInput = input as CreateDatabasePageInput

  return runWithNotionClient(ctx, async (notion) => {
    const writePlan = createDatabasePageWritePlan(parsedInput as CreateDatabasePageToolInput)
    let page: unknown

    try {
      page = await notion.pages.create(writePlan.createRequest)
    } catch (error) {
      const recoverableResult =
        toRecoverableCreatePageErrorResult(error, parsedInput) ??
        toRecoverableDataSourceNotFoundResult(error, parsedInput)
      if (recoverableResult) {
        return recoverableResult
      }

      throw error
    }

    if (writePlan.appendChildrenBatches.length > 0) {
      await appendBlockChildrenRequestsInOrder(
        notion,
        createAppendBlockChildrenRequests({
          childrenBatches: writePlan.appendChildrenBatches,
          pageId: getCreatedPageId(page)
        })
      )
    }

    return page
  })
}

function getCreatedPageId(page: unknown): string {
  if (page && typeof page === "object" && "id" in page && typeof page.id === "string") {
    return page.id
  }

  throw new Error("Notion create page response did not include a page id")
}

function toRecoverableCreatePageErrorResult(
  error: unknown,
  input: CreateDatabasePageInput
): RecoverableInvalidPropertyOptionResult | null {
  if (
    !isNotionClientError(error) ||
    error.code !== APIErrorCode.ValidationError ||
    !error.message.includes("invalid select option")
  ) {
    return null
  }

  return {
    code: "invalid_property_option",
    dataSourceId: input.dataSourceId,
    message: error.message,
    nextAction:
      "Call retrieveDataSource for this dataSourceId and retry with existing select, status, or multi_select option ids.",
    status: "error"
  }
}

function toRecoverableDataSourceNotFoundResult(
  error: unknown,
  input: { dataSourceId: string }
): RecoverableDataSourceNotFoundResult | null {
  if (!isNotionClientError(error) || error.code !== APIErrorCode.ObjectNotFound) {
    return null
  }

  return {
    code: "notion_data_source_not_found",
    dataSourceId: input.dataSourceId,
    message: error.message,
    nextAction:
      "Search Notion again with searchPages or getDatabases for a shared data source, then retry with an id returned by Notion. If no shared data source is found, tell the user to share the database with the connected integration.",
    status: "error"
  }
}

function toRecoverablePageOrBlockNotFoundResult(
  error: unknown,
  input: { objectId: string; objectKind: "block" | "page" }
): RecoverablePageOrBlockNotFoundResult | null {
  if (!isNotionClientError(error) || error.code !== APIErrorCode.ObjectNotFound) {
    return null
  }

  const objectLabel = input.objectKind === "page" ? "page" : "page or block"

  return {
    code: "notion_page_or_block_not_found",
    message: error.message,
    nextAction: `Search Notion again with searchPages for a shared ${objectLabel}, then retry with an id returned by Notion. If no shared ${objectLabel} is found, tell the user to share it with the connected integration or provide a current id.`,
    objectId: input.objectId,
    objectKind: input.objectKind,
    status: "error"
  }
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
          return createDatabasePageConfirmation(ctx, input)
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
