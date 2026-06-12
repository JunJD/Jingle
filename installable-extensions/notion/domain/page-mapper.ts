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
    created_by:
      "created_by" in notionPage && notionPage.created_by.object === "user"
        ? notionPage.created_by.id
        : undefined,
    parent_page_id:
      "parent" in notionPage && "page_id" in notionPage.parent ? notionPage.parent.page_id : undefined,
    parent_database_id:
      "parent" in notionPage && "database_id" in notionPage.parent
        ? notionPage.parent.database_id
        : undefined,
    last_edited_time:
      "last_edited_time" in notionPage ? new Date(notionPage.last_edited_time).getTime() : undefined,
    last_edited_user:
      "last_edited_by" in notionPage && notionPage.last_edited_by.object === "user"
        ? notionPage.last_edited_by.id
        : undefined,
    icon_emoji:
      "icon" in notionPage && notionPage.icon?.type === "emoji" ? notionPage.icon.emoji : null,
    icon_file: "icon" in notionPage && notionPage.icon?.type === "file" ? notionPage.icon.file.url : null,
    icon_external:
      "icon" in notionPage && notionPage.icon?.type === "external"
        ? notionPage.icon.external.url
        : null,
    url: "url" in notionPage ? notionPage.url : undefined
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
