export type LocalStartItemKind = "application" | "file" | "directory"

export interface LocalStartItem {
  id: string
  kind: LocalStartItemKind
  title: string
  path: string
  createdAt: string
  updatedAt: string
  useCount: number
  lastUsedAt: string | null
}

export interface CreateLocalStartItemInput {
  kind: LocalStartItemKind
  title: string
  path: string
}
