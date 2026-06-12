import type { PageProperty } from "./property"

export interface Page {
  object: "page" | "database"
  id: string
  parent_page_id?: string
  parent_database_id?: string
  created_by?: string
  last_edited_time?: number
  last_edited_user?: string
  title: string | null
  icon_emoji: string | null
  icon_file: string | null
  icon_external: string | null
  url?: string
  properties: Record<string, PageProperty>
}
