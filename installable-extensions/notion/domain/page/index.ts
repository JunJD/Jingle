import { BlockObjectRequest, UpdatePageParameters } from "@notionhq/client/build/src/api-endpoints"
import { showToast, Toast, Image, Icon } from "@jingle/extension-api"
import { markdownToBlocks } from "@tryfabric/martian"
import { NotionToMarkdown } from "notion-to-md"

import { prependDateDivider } from "../block"
import { handleError } from "../global"
import { getNotionClient } from "../client"
import { pageMapper } from "../page-mapper"
import { getPageMarkdown, searchPages } from "../page-content"
import { isMarkdownPageContent, type PageContent } from "../shared"

import type { Page } from "./types"
export type { Page } from "./types"

export * from "./property"
export {
  getPageContent,
  getPageMarkdown,
  listPageChildBlocks,
  type PageMarkdownResult
} from "../page-content"

export async function fetchPage(pageId: string, silent: boolean = true) {
  try {
    const notion = getNotionClient()
    const page = await notion.pages.retrieve({
      page_id: pageId
    })

    return pageMapper(page)
  } catch (err) {
    if (!silent) return handleError(err, "Failed to fetch page", undefined)

    return undefined
  }
}

export async function deletePage(pageId: string) {
  try {
    const notion = getNotionClient()

    await Promise.all([
      showToast({
        style: Toast.Style.Animated,
        title: "Deleting page"
      }),
      notion.pages.update({
        page_id: pageId,
        archived: true
      })
    ])

    await showToast({
      style: Toast.Style.Success,
      title: "Page deleted"
    })
  } catch (err) {
    return handleError(err, "Failed to delete page", undefined)
  }
}

export async function patchPage(pageId: string, properties: UpdatePageParameters["properties"]) {
  try {
    const notion = getNotionClient()
    const page = await notion.pages.update({
      page_id: pageId,
      properties
    })

    return pageMapper(page)
  } catch (err) {
    return handleError(err, "Failed to update page", undefined)
  }
}

export async function search(query?: string, nextCursor?: string, pageSize: number = 25) {
  return searchPages(query, nextCursor, pageSize)
}

export async function fetchPageContent(pageId: string) {
  try {
    const page = await getPageMarkdown(pageId)

    return {
      markdown: page.markdown
    }
  } catch (err) {
    return handleError(err, "Failed to fetch page content", undefined)
  }
}

export async function fetchPageFirstBlockId(pageId: string) {
  try {
    const notion = getNotionClient()
    const { results } = await notion.blocks.children.list({
      block_id: pageId
    })
    return results[0].id
  } catch (err) {
    return handleError(err, "Failed to fetch page's first block", undefined)
  }
}

type AppendBlockToPageParams = {
  pageId: string
  children: BlockObjectRequest[]
  prepend?: boolean
  addDateDivider?: boolean
}

export async function appendBlockToPage({
  pageId,
  children,
  prepend = false,
  addDateDivider = false
}: AppendBlockToPageParams) {
  try {
    const notion = getNotionClient()

    const childrenToInsert = addDateDivider ? prependDateDivider(children) : children

    const { results } = await notion.blocks.children.append({
      block_id: pageId,
      children: childrenToInsert,
      position: {
        type: prepend ? "start" : "end"
      }
    })

    return results
  } catch (err) {
    return handleError(err, "Failed to add block to the page", undefined)
  }
}

export async function appendToPage(
  pageId: string,
  params: { content: PageContent; addDateDivider?: boolean }
) {
  try {
    const notion = getNotionClient()
    const { content, addDateDivider = false } = params

    const children = isMarkdownPageContent(content)
      ? // casting because converting from the `Block` type in martian to the `BlockObjectRequest` type in notion
        (markdownToBlocks(content) as BlockObjectRequest[])
      : content

    const { results } = await notion.blocks.children.append({
      block_id: pageId,
      children: addDateDivider ? prependDateDivider(children) : children
    })

    const n2m = new NotionToMarkdown({ notionClient: notion })

    return {
      markdown:
        results.length === 0
          ? ""
          : "\n\n" + n2m.toMarkdownString(await n2m.blocksToMarkdown(results))
    }
  } catch (err) {
    return handleError(err, "Failed to add content to the page", {
      markdown: ""
    })
  }
}

export function getPageIcon(page: Page): Image.ImageLike {
  return page.icon_emoji
    ? page.icon_emoji
    : page.icon_file
      ? page.icon_file
      : page.icon_external
        ? page.icon_external
        : page.object === "database"
          ? Icon.List
          : Icon.BlankDocument
}

export function getPageName(page: Page): string {
  return (page.icon_emoji ? page.icon_emoji + " " : "") + (page.title ? page.title : "Untitled")
}
