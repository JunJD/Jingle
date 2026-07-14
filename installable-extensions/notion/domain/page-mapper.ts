import type {
  DataSourceObjectResponse,
  DatabaseObjectResponse,
  PageObjectResponse,
  PartialDataSourceObjectResponse,
  PartialDatabaseObjectResponse,
  PartialPageObjectResponse
} from "@notionhq/client/build/src/api-endpoints"
import type { Page } from "./page/types"
import { standardize } from "./standardize"

type NotionObject =
  | PageObjectResponse
  | PartialPageObjectResponse
  | DataSourceObjectResponse
  | PartialDataSourceObjectResponse
  | DatabaseObjectResponse
  | PartialDatabaseObjectResponse

export function pageMapper(notionPage: NotionObject): Page {
  const page: Page = {
    object: notionPage.object === "page" ? "page" : "database",
    id: notionPage.id,
    title: "Untitled",
    properties: {},
    icon_emoji:
      "icon" in notionPage && notionPage.icon?.type === "emoji" ? notionPage.icon.emoji : null,
    icon_file: "icon" in notionPage && notionPage.icon?.type === "file" ? notionPage.icon.file.url : null,
    icon_external:
      "icon" in notionPage && notionPage.icon?.type === "external"
        ? notionPage.icon.external.url
        : null
  }

  if ("created_by" in notionPage && notionPage.created_by.object === "user") {
    page.created_by = notionPage.created_by.id
  }
  if ("parent" in notionPage && "page_id" in notionPage.parent) {
    page.parent_page_id = notionPage.parent.page_id
  }
  if ("parent" in notionPage && "database_id" in notionPage.parent) {
    page.parent_database_id = notionPage.parent.database_id
  }
  if ("last_edited_time" in notionPage) {
    page.last_edited_time = new Date(notionPage.last_edited_time).getTime()
  }
  if ("last_edited_by" in notionPage && notionPage.last_edited_by.object === "user") {
    page.last_edited_user = notionPage.last_edited_by.id
  }
  if ("url" in notionPage) {
    page.url = notionPage.url
  }

  if (notionPage.object === "page" && "properties" in notionPage)
    for (const key in notionPage.properties) {
      const property = notionPage.properties[key]
      page.properties[key] = standardize(property, "value")
      if (property.type === "title" && property.title[0]?.plain_text) {
        page.title = property.title[0].plain_text
      }
    }

  if ("title" in notionPage && notionPage.title[0]?.plain_text) {
    page.title = notionPage.title[0]?.plain_text
  }

  return page
}
