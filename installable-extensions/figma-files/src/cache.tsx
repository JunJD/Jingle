import { LocalStorage } from "@jingle/extension-api"
import type { FigmaNode, FigmaTeamFiles } from "./types"

const PAGES_CACHE_PREFIX = "figma-pages:"
const PROJECT_FILES_CACHE_KEY = "figma-project-files"
const PROJECT_TTL_CACHE_KEY = "figma-project-ttls"
const PROJECT_TTL_MINUTES = 30

interface ProjectTTLData {
  [projectId: string]: {
    expiresAt: number
    lastFetched: number
  }
}

interface CachedPagesEntry {
  lastModified: string
  pages: FigmaNode[]
}

async function loadProjectTTLs(): Promise<ProjectTTLData> {
  const data = await LocalStorage.getItem<ProjectTTLData>(PROJECT_TTL_CACHE_KEY)
  return data && typeof data === "object" ? data : {}
}

async function saveProjectTTLs(ttlData: ProjectTTLData): Promise<void> {
  await LocalStorage.setItem(PROJECT_TTL_CACHE_KEY, ttlData)
}

export async function getProjectsNeedingRefresh(projectIds: string[]): Promise<string[]> {
  const ttlData = await loadProjectTTLs()
  return projectIds.filter((projectId) => {
    const cached = ttlData[projectId]
    return !cached || Date.now() > cached.expiresAt
  })
}

export async function updateProjectTTLs(projectIds: string[]): Promise<void> {
  const ttlData = await loadProjectTTLs()
  const now = Date.now()
  for (const projectId of projectIds) {
    ttlData[projectId] = {
      expiresAt: now + PROJECT_TTL_MINUTES * 60 * 1000,
      lastFetched: now
    }
  }
  await saveProjectTTLs(ttlData)
}

export async function storeFiles(teamFiles: FigmaTeamFiles[]): Promise<void> {
  await LocalStorage.setItem(PROJECT_FILES_CACHE_KEY, teamFiles)
}

export async function loadFiles(): Promise<FigmaTeamFiles[] | undefined> {
  const data = await LocalStorage.getItem<FigmaTeamFiles[]>(PROJECT_FILES_CACHE_KEY)
  return Array.isArray(data) ? data : undefined
}

function isCachedPagesEntry(value: unknown): value is CachedPagesEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false
  }

  const candidate = value as Partial<CachedPagesEntry>
  return typeof candidate.lastModified === "string" && Array.isArray(candidate.pages)
}

export async function loadPages(
  fileKey: string,
  lastModified: string
): Promise<FigmaNode[] | undefined> {
  const data = await LocalStorage.getItem<unknown>(`${PAGES_CACHE_PREFIX}${fileKey}`)
  if (!isCachedPagesEntry(data)) {
    return undefined
  }

  return data.lastModified === lastModified ? data.pages : undefined
}

export async function storePages(
  fileKey: string,
  lastModified: string,
  pages: FigmaNode[]
): Promise<void> {
  await LocalStorage.setItem(`${PAGES_CACHE_PREFIX}${fileKey}`, {
    lastModified,
    pages
  } satisfies CachedPagesEntry)
}

async function clearPagesCache(): Promise<void> {
  const items = await LocalStorage.allItems()
  const pageCacheKeys: string[] = []
  for (const key of Object.keys(items)) {
    if (key.startsWith(PAGES_CACHE_PREFIX)) {
      pageCacheKeys.push(key)
    }
  }
  await Promise.all(pageCacheKeys.map((key) => LocalStorage.removeItem(key)))
}

export async function clearFiles(): Promise<void> {
  await Promise.all([
    LocalStorage.removeItem(PROJECT_FILES_CACHE_KEY),
    LocalStorage.removeItem(PROJECT_TTL_CACHE_KEY),
    clearPagesCache()
  ])
}
