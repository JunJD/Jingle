import { Dirent, promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import type {
  LauncherSearchCacheState,
  LauncherSearchRequest,
  LauncherSearchResult
} from "../../../../shared/launcher-search"
import type { LauncherSearchProvider, LauncherSearchProviderResponse } from "../types"

interface LauncherApplicationRecord {
  id: string
  keywords: string[]
  name: string
  path: string
}

const MAX_SCAN_DEPTH = 3
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
const MAC_APPLICATION_DIRECTORIES = [
  "/Applications",
  path.join(os.homedir(), "Applications"),
  "/System/Applications",
  "/System/Applications/Utilities",
  "/System/Library/CoreServices/Applications"
]

let applicationCatalogPromise: Promise<LauncherApplicationRecord[]> | null = null

function normalizeSearchValue(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function buildSearchKeywords(name: string): string[] {
  const normalizedName = name
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  const compactName = normalizedName.replace(/\s+/g, "")
  const segments = normalizedName.split(" ").filter(Boolean)
  const acronym = segments.length > 1 ? segments.map((segment) => segment[0]).join("") : ""

  return uniqueStrings([name, normalizedName, compactName, acronym].map(normalizeSearchValue))
}

async function collectMacApplicationPaths(
  directoryPath: string,
  depth: number,
  target: Set<string>
): Promise<void> {
  let entries: Dirent[] = []

  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true })
  } catch {
    return
  }

  await Promise.all(
    entries.map(async (entry) => {
      if (entry.name.startsWith(".")) {
        return
      }

      const fullPath = path.join(directoryPath, entry.name)
      const isApplicationBundle = entry.name.endsWith(".app")

      if (isApplicationBundle && (entry.isDirectory() || entry.isSymbolicLink())) {
        target.add(fullPath)
        return
      }

      if (!entry.isDirectory() || depth <= 0) {
        return
      }

      await collectMacApplicationPaths(fullPath, depth - 1, target)
    })
  )
}

async function loadMacApplications(): Promise<LauncherApplicationRecord[]> {
  const applicationPaths = new Set<string>()

  await Promise.all(
    MAC_APPLICATION_DIRECTORIES.map((directoryPath) =>
      collectMacApplicationPaths(directoryPath, MAX_SCAN_DEPTH, applicationPaths)
    )
  )

  return [...applicationPaths]
    .map((applicationPath) => {
      const name = path.basename(applicationPath, ".app")

      return {
        id: applicationPath,
        keywords: buildSearchKeywords(name),
        name,
        path: applicationPath
      }
    })
    .sort((left, right) => collator.compare(left.name, right.name))
}

async function loadApplicationCatalog(): Promise<LauncherApplicationRecord[]> {
  switch (process.platform) {
    case "darwin":
      return loadMacApplications()
    default:
      return []
  }
}

async function getApplicationCatalog(): Promise<LauncherApplicationRecord[]> {
  if (!applicationCatalogPromise) {
    applicationCatalogPromise = loadApplicationCatalog()
  }

  return applicationCatalogPromise
}

function scoreApplicationMatch(application: LauncherApplicationRecord, query: string): number {
  let score = -1

  for (const keyword of application.keywords) {
    if (keyword === query) {
      score = Math.max(score, 900)
      continue
    }

    if (keyword.startsWith(query)) {
      score = Math.max(score, 720 - Math.min(keyword.length - query.length, 120))
      continue
    }

    const substringIndex = keyword.indexOf(query)
    if (substringIndex >= 0) {
      score = Math.max(score, 520 - substringIndex * 4)
    }
  }

  const normalizedPath = normalizeSearchValue(application.path)
  const pathIndex = normalizedPath.indexOf(query)
  if (pathIndex >= 0) {
    score = Math.max(score, 260 - pathIndex)
  }

  return score
}

function mapApplicationResult(
  application: LauncherApplicationRecord,
  score: number
): LauncherSearchResult {
  return {
    action: {
      applicationPath: application.path,
      type: "launch-application"
    },
    id: application.id,
    kind: "application",
    score,
    source: "applications",
    subtitle: application.path,
    title: application.name,
    trailingLabel: ""
  }
}

async function searchApplications(
  request: LauncherSearchRequest
): Promise<LauncherSearchProviderResponse> {
  const startedAt = Date.now()
  const cacheState: LauncherSearchCacheState = applicationCatalogPromise ? "warm" : "cold"
  const query = normalizeSearchValue(request.query)

  if (!query) {
    return {
      diagnostic: {
        cacheState,
        durationMs: Date.now() - startedAt,
        matchCount: 0,
        returnedCount: 0,
        scannedCount: 0,
        source: "applications"
      },
      results: []
    }
  }

  const catalog = await getApplicationCatalog()
  const matches = catalog
    .map((application) => ({
      application,
      score: scoreApplicationMatch(application, query)
    }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return collator.compare(left.application.name, right.application.name)
    })

  const results = matches
    .slice(0, Math.max(request.limit, 1))
    .map((entry) => mapApplicationResult(entry.application, entry.score))

  return {
    diagnostic: {
      cacheState,
      durationMs: Date.now() - startedAt,
      matchCount: matches.length,
      returnedCount: results.length,
      scannedCount: catalog.length,
      source: "applications"
    },
    results
  }
}

export const applicationsLauncherSearchProvider: LauncherSearchProvider = {
  search: searchApplications,
  source: "applications",
  warmup: async () => {
    await getApplicationCatalog()
  }
}
