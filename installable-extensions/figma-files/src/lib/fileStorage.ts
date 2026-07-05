import { LocalStorage } from "@jingle/extension-api"
import type { FigmaFile } from "../types"

export interface FileCollectionConfig {
  maxItems: number
  storageKey: string
}

export const STARRED_CONFIG: FileCollectionConfig = {
  maxItems: 10,
  storageKey: "starred-files"
}

export const VISITED_CONFIG: FileCollectionConfig = {
  maxItems: 5,
  storageKey: "visited-figma-files"
}

export async function loadFileCollection(config: FileCollectionConfig): Promise<FigmaFile[]> {
  const stored = await LocalStorage.getItem<FigmaFile[]>(config.storageKey)
  return Array.isArray(stored) ? stored : []
}

export async function saveFileCollection(
  config: FileCollectionConfig,
  files: FigmaFile[]
): Promise<void> {
  await LocalStorage.setItem(config.storageKey, files)
}

export async function clearVisitedFiles(): Promise<void> {
  await LocalStorage.removeItem(VISITED_CONFIG.storageKey)
}
