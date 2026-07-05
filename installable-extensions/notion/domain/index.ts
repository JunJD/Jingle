import type {
  DataSourceObjectResponse,
  DatabaseObjectResponse,
  PageObjectResponse,
  PartialDataSourceObjectResponse,
  PartialDatabaseObjectResponse,
  PartialPageObjectResponse
} from "@notionhq/client/build/src/api-endpoints"

export * from "./database";
export * from "./page";
export * from "./shared"
export * from "./user";

export type NotionObject =
  | PageObjectResponse
  | PartialPageObjectResponse
  | DataSourceObjectResponse
  | PartialDataSourceObjectResponse
  | DatabaseObjectResponse
  | PartialDatabaseObjectResponse
