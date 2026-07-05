import type {
  AppendBlockChildrenParameters,
  BlockObjectRequest,
  CreatePageParameters,
  QueryDataSourceParameters,
  SearchParameters
} from "@notionhq/client/build/src/api-endpoints"
import { markdownToBlocks } from "@tryfabric/martian"

import { chunkBlockChildren, prependDateDivider } from "./block"
import { getLocalTimezone } from "./timezone"

type NotionListResponse = {
  has_more?: boolean
  next_cursor?: string | null
  results?: unknown[]
}

type SearchPagesInput = {
  filter?: "page" | "data_source"
  limit?: number
  query?: string
  startCursor?: string
}

type SearchDataSourcesInput = {
  limit?: number
  query?: string
  startCursor?: string
}

export type QueryDataSourceToolInput = {
  dataSourceId: string
  filter?: QueryDataSourceParameters["filter"]
  limit: number
  query?: string
  sorts?: QueryDataSourceParameters["sorts"]
  startCursor?: string
}

export type CreateDatabasePageToolInput = {
  addDateDivider?: boolean
  content?: string
  contentBlocks?: Array<{ type: "bookmark"; url: string }>
  dataSourceId: string
  properties?: Record<string, CreateDatabasePagePropertyInput>
  title: string
  titlePropertyName?: string
}

export type CreateDatabasePagePropertyInput =
  | {
      type: "checkbox"
      value: boolean
    }
  | {
      type: "multi_select"
      value: string[]
    }
  | {
      type: "people"
      value: string[]
    }
  | {
      type: "relation"
      value: string[]
    }
  | {
      type: "number"
      value: number
    }
  | {
      type: "date" | "email" | "phone_number" | "rich_text" | "select" | "status" | "url"
      value: string
    }

export type CreateDatabasePageWritePlan = {
  appendChildrenBatches: BlockObjectRequest[][]
  createRequest: CreatePageParameters
}

export function createSearchRequest(
  input: SearchPagesInput | SearchDataSourcesInput
): SearchParameters {
  const request: SearchParameters = {
    page_size: input.limit ?? 10,
    query: input.query
  }

  if ("filter" in input && input.filter) {
    request.filter = {
      property: "object",
      value: input.filter
    }
  }

  if (input.startCursor) {
    request.start_cursor = input.startCursor
  }

  return request
}

export function createQueryDataSourceRequest(
  input: QueryDataSourceToolInput
): QueryDataSourceParameters {
  const query = input.query?.trim() ?? ""
  const request: QueryDataSourceParameters = {
    data_source_id: input.dataSourceId,
    page_size: input.limit
  }

  if ("filter" in input && input.filter) {
    request.filter = input.filter
  } else if (query) {
    request.filter = {
      and: [
        {
          property: "title",
          title: {
            contains: query
          }
        }
      ]
    }
  }

  if ("sorts" in input && input.sorts) {
    request.sorts = input.sorts
  }

  if (input.startCursor) {
    request.start_cursor = input.startCursor
  }

  return request
}

export function toListToolOutput(response: unknown) {
  const list = response as NotionListResponse
  return {
    hasMore: list.has_more === true,
    nextCursor: list.next_cursor ?? null,
    results: list.results ?? []
  }
}

export function createAppendMarkdownRequests(input: {
  addDateDivider?: boolean
  content: string
  pageId: string
  prepend?: boolean
}): AppendBlockChildrenParameters[] {
  const batches = chunkBlockChildren(createMarkdownBlocks(input.content, input.addDateDivider))
  const orderedBatches = input.prepend ? [...batches].reverse() : batches

  return orderedBatches.map((children) => ({
    block_id: input.pageId,
    children,
    position: {
      type: input.prepend ? "start" : "end"
    }
  }))
}

export function createDatabasePageRequest(
  input: CreateDatabasePageToolInput
): CreatePageParameters {
  return createDatabasePageWritePlan(input).createRequest
}

export function createDatabasePageWritePlan(
  input: CreateDatabasePageToolInput
): CreateDatabasePageWritePlan {
  const createRequest: CreatePageParameters = {
    parent: {
      data_source_id: input.dataSourceId
    },
    properties: createDatabasePageProperties(input)
  }
  const appendChildrenBatches: BlockObjectRequest[][] = []

  const content = input.content?.trim() ?? ""
  if (input.contentBlocks?.length || content) {
    const batches = chunkBlockChildren(
      createContentBlocks({
        addDateDivider: input.addDateDivider,
        content,
        contentBlocks: input.contentBlocks
      })
    )
    const [firstBatch, ...remainingBatches] = batches

    if (firstBatch) {
      createRequest.children = firstBatch
      appendChildrenBatches.push(...remainingBatches)
    }
  }

  return {
    appendChildrenBatches,
    createRequest
  }
}

export function createAppendBlockChildrenRequests(input: {
  childrenBatches: BlockObjectRequest[][]
  pageId: string
}): AppendBlockChildrenParameters[] {
  return input.childrenBatches.map((children) => ({
    block_id: input.pageId,
    children
  }))
}

export function createMarkdownBlocks(
  content: string,
  addDateDivider?: boolean
): BlockObjectRequest[] {
  return createContentBlocks({ addDateDivider, content })
}

function createContentBlocks(input: {
  addDateDivider?: boolean
  content?: string
  contentBlocks?: Array<{ type: "bookmark"; url: string }>
}): BlockObjectRequest[] {
  const markdown = input.content?.trim() ?? ""
  const blocks = [
    ...(input.contentBlocks?.map(createBookmarkBlock) ?? []),
    ...(markdown ? (markdownToBlocks(markdown) as BlockObjectRequest[]) : [])
  ]

  return input.addDateDivider ? prependDateDivider(blocks) : blocks
}

function createBookmarkBlock(input: { url: string }): BlockObjectRequest {
  return {
    type: "bookmark",
    bookmark: {
      url: input.url
    }
  }
}

function createDatabasePageProperties(
  input: CreateDatabasePageToolInput
): NonNullable<CreatePageParameters["properties"]> {
  const properties: NonNullable<CreatePageParameters["properties"]> = {}

  for (const [propertyName, property] of Object.entries(input.properties ?? {})) {
    properties[propertyName] = createDatabasePagePropertyValue(property)
  }

  properties[input.titlePropertyName?.trim() || "title"] = {
    title: [
      {
        text: {
          content: input.title
        },
        type: "text"
      }
    ]
  }

  return properties
}

function createDatabasePagePropertyValue(
  property: CreateDatabasePagePropertyInput
): NonNullable<CreatePageParameters["properties"]>[string] {
  if (property.type === "checkbox") {
    return {
      checkbox: property.value
    }
  }

  if (property.type === "date") {
    return {
      date: {
        ...(isFullDayDateString(property.value) ? {} : { time_zone: getLocalTimezone() }),
        start: property.value
      }
    }
  }

  if (property.type === "multi_select") {
    return {
      multi_select: property.value.map((id) => ({
        id
      }))
    }
  }

  if (property.type === "people") {
    return {
      people: property.value.map((id) => ({
        id
      }))
    }
  }

  if (property.type === "relation") {
    return {
      relation: property.value.map((id) => ({
        id
      }))
    }
  }

  if (property.type === "number") {
    return {
      number: property.value
    }
  }

  if (property.type === "rich_text") {
    return {
      rich_text: [
        {
          text: {
            content: property.value
          },
          type: "text"
        }
      ]
    }
  }

  if (property.type === "select") {
    return {
      select: {
        id: property.value
      }
    }
  }

  if (property.type === "status") {
    return {
      status: {
        id: property.value
      }
    }
  }

  return {
    [property.type]: property.value
  } as unknown as NonNullable<CreatePageParameters["properties"]>[string]
}

function isFullDayDateString(value: string): boolean {
  return !value.includes("T")
}
