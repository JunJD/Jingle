import { NotionToMarkdown } from "notion-to-md"

import { getNotionClient } from "./client"
import { pageMapper } from "./page-mapper"

type NotionBlockListResponse = {
  has_more?: boolean
  next_cursor?: string | null
  results?: Record<string, unknown>[]
}

export type PageMarkdownResult =
  | {
      blockCount: 0
      markdown: string
      pageId: string
      status: "empty"
    }
  | {
      blockCount: number
      markdown: string
      pageId: string
      status: "success"
    }

export function serializeNotionError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  return JSON.stringify(error)
}

export async function searchPages(query?: string, nextCursor?: string, pageSize: number = 25) {
  const notion = getNotionClient()
  const database = await notion.search({
    sort: {
      direction: "descending",
      timestamp: "last_edited_time"
    },
    page_size: pageSize,
    query,
    ...(nextCursor && { start_cursor: nextCursor })
  })

  return {
    pages: database.results.map(pageMapper),
    hasMore: database.has_more,
    nextCursor: database.next_cursor
  }
}

export async function listPageChildBlocks(pageId: string): Promise<Record<string, unknown>[]> {
  const notion = getNotionClient()
  const results: Record<string, unknown>[] = []
  let startCursor: string | undefined

  do {
    const response = (await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100,
      ...(startCursor ? { start_cursor: startCursor } : {})
    })) as NotionBlockListResponse

    results.push(...(response.results ?? []))
    startCursor = response.has_more === true ? (response.next_cursor ?? undefined) : undefined
  } while (startCursor)

  return results
}

export async function getPageMarkdown(pageId: string): Promise<PageMarkdownResult> {
  const notion = getNotionClient()
  const results = await listPageChildBlocks(pageId)

  if (results.length === 0) {
    return {
      blockCount: 0,
      markdown: "*Page is empty*",
      pageId,
      status: "empty"
    }
  }

  const n2m = new NotionToMarkdown({ notionClient: notion })
  const markdownBlocks = await n2m.blocksToMarkdown(
    results as Parameters<NotionToMarkdown["blocksToMarkdown"]>[0]
  )

  return {
    blockCount: results.length,
    markdown: normalizeToolMarkdown(n2m.toMarkdownString(markdownBlocks).parent),
    pageId,
    status: "success"
  }
}

export async function getPageContent(pageId: string) {
  const page = await getPageMarkdown(pageId)

  return {
    blockCount: page.blockCount,
    content: page.markdown,
    pageId: page.pageId,
    status: page.status
  }
}

function normalizeToolMarkdown(markdown: string): string {
  return markdown.replace(/\n{3,}/g, "\n\n").trim()
}
