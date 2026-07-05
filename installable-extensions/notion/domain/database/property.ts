import type { DataSourceObjectResponse } from "@notionhq/client/build/src/api-endpoints";

import type { ReadablePropertyType } from "../shared";
import type { Standardized } from "../standardize";

type NotionDatabaseProperty = Extract<DataSourceObjectResponse["properties"][string], { type: ReadablePropertyType }>;
export type DatabaseProperty = Standardized<NotionDatabaseProperty, "config">;
export type DatabasePropertyConfig<T extends ReadablePropertyType> = Extract<
  DatabaseProperty,
  { type: T }
>["config"];
