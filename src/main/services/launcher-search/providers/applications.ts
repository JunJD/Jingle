import { app, nativeImage } from "electron"
import PinyinMatch from "pinyin-match"
import { execFile } from "node:child_process"
import { Dirent, promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { createLauncherApplicationHistoryKey } from "../../../../shared/launcher-history"
import type {
  LauncherSearchRequest,
  LauncherSearchResult
} from "../../../../shared/launcher-search"
import type { LauncherSearchProvider, LauncherSearchProviderResponse } from "../types"

interface LauncherApplicationRecord {
  id: string
  bundleName: string
  displayName: string
  keywords: string[]
  path: string
  subtitle: string
}

interface SystemProfilerApplicationEntry {
  _name?: string
  path?: string
}

interface SystemProfilerApplicationsPayload {
  SPApplicationsDataType?: SystemProfilerApplicationEntry[]
}

const MAX_SCAN_DEPTH = 3
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
const execFileAsync = promisify(execFile)
const GENERIC_MAC_APP_ICON =
  "/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns"
const MAC_APPLICATION_DIRECTORIES = [
  "/Applications",
  path.join(os.homedir(), "Applications"),
  "/System/Applications",
  "/System/Applications/Utilities",
  "/System/Library/CoreServices/Applications"
]

let applicationCatalogPromise: Promise<LauncherApplicationRecord[]> | null = null
const applicationIconPromiseCache = new Map<string, Promise<string | undefined>>()

function normalizeSearchValue(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function getTitleMatchRange(title: string, query: string): [number, number] | undefined {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return undefined
  }

  const index = title.toLocaleLowerCase().indexOf(trimmedQuery.toLocaleLowerCase())
  if (index >= 0) {
    return [index, index + trimmedQuery.length - 1]
  }

  return getPinyinMatchRange(title, trimmedQuery)
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function buildSearchKeywords(...names: string[]): string[] {
  const variants: string[] = []

  for (const name of names) {
    if (!name.trim()) {
      continue
    }

    const normalizedName = name
      .replace(/[._-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
    const compactName = normalizedName.replace(/\s+/g, "")
    const segments = normalizedName.split(" ").filter(Boolean)
    const acronym = segments.length > 1 ? segments.map((segment) => segment[0]).join("") : ""

    variants.push(...[name, normalizedName, compactName, acronym].map(normalizeSearchValue))
  }

  return uniqueStrings(variants)
}

function normalizeApplicationContainerLabel(label: string): string {
  const trimmedLabel = label
    .replace(/^\{[0-9a-f-]+\}\s*/i, "")
    .replace(/\.localized$/i, "")
    .trim()

  switch (trimmedLabel) {
    case "Applications":
      return "应用程序"
    case "Utilities":
      return "实用工具"
    default:
      return trimmedLabel
  }
}

function getApplicationSubtitle(applicationPath: string): string {
  const parentDirectoryName = normalizeApplicationContainerLabel(
    path.basename(path.dirname(applicationPath))
  )
  const grandparentDirectoryName = normalizeApplicationContainerLabel(
    path.basename(path.dirname(path.dirname(applicationPath)))
  )

  if (
    parentDirectoryName === "应用程序" &&
    grandparentDirectoryName &&
    grandparentDirectoryName !== "应用程序" &&
    /Applications/i.test(grandparentDirectoryName)
  ) {
    return grandparentDirectoryName
  }

  if (parentDirectoryName) {
    return parentDirectoryName
  }

  if (grandparentDirectoryName) {
    return grandparentDirectoryName
  }

  return "应用程序"
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

async function loadMacApplicationsFromSystemProfiler(): Promise<LauncherApplicationRecord[]> {
  const { stdout } = await execFileAsync(
    "/usr/sbin/system_profiler",
    ["-json", "SPApplicationsDataType"],
    {
      maxBuffer: 64 * 1024 * 1024
    }
  )
  const payload = JSON.parse(stdout.toString()) as SystemProfilerApplicationsPayload
  const applicationsByPath = new Map<string, LauncherApplicationRecord>()

  for (const entry of payload.SPApplicationsDataType ?? []) {
    const applicationPath = entry.path?.trim()
    if (!applicationPath) {
      continue
    }

    const extension = path.extname(applicationPath)
    if (extension !== ".app" && extension !== ".prefPane") {
      continue
    }

    const bundleName = path.basename(applicationPath, extension)
    const displayName = entry._name?.trim() || bundleName

    applicationsByPath.set(applicationPath, {
      bundleName,
      displayName,
      id: applicationPath,
      keywords: buildSearchKeywords(displayName, bundleName),
      path: applicationPath,
      subtitle: getApplicationSubtitle(applicationPath)
    })
  }

  return [...applicationsByPath.values()].sort((left, right) => {
    const displayOrder = collator.compare(left.displayName, right.displayName)
    if (displayOrder !== 0) {
      return displayOrder
    }

    return collator.compare(left.bundleName, right.bundleName)
  })
}

async function loadMacApplications(): Promise<LauncherApplicationRecord[]> {
  try {
    return await loadMacApplicationsFromSystemProfiler()
  } catch {
    // Fall back to directory scanning if system_profiler is unavailable.
  }

  const applicationPaths = new Set<string>()
  await Promise.all(
    MAC_APPLICATION_DIRECTORIES.map((directoryPath) =>
      collectMacApplicationPaths(directoryPath, MAX_SCAN_DEPTH, applicationPaths)
    )
  )

  return [...applicationPaths]
    .map((applicationPath) => {
      const extension = path.extname(applicationPath)
      const bundleName = path.basename(applicationPath, extension)

      return {
        bundleName,
        displayName: bundleName,
        id: applicationPath,
        keywords: buildSearchKeywords(bundleName),
        path: applicationPath,
        subtitle: getApplicationSubtitle(applicationPath)
      }
    })
    .sort((left, right) => collator.compare(left.displayName, right.displayName))
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

async function readPlistRawValue(
  plistPath: string,
  key: "CFBundleIconFile" | "CFBundleIconName"
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/plutil", [
      "-extract",
      key,
      "raw",
      "-o",
      "-",
      plistPath
    ])
    const value = stdout.toString().trim()
    return value || undefined
  } catch {
    return undefined
  }
}

async function findExistingIconPath(
  resourcesPath: string,
  iconBaseNames: string[]
): Promise<string | undefined> {
  for (const iconBaseName of iconBaseNames) {
    const normalizedBaseName = iconBaseName.trim()
    if (!normalizedBaseName) {
      continue
    }

    const iconCandidates = [
      normalizedBaseName,
      `${normalizedBaseName}.icns`,
      `${normalizedBaseName}.png`,
      `${normalizedBaseName}.tiff`
    ]

    for (const iconCandidate of iconCandidates) {
      const iconPath = path.join(resourcesPath, iconCandidate)

      try {
        await fs.access(iconPath)
        return iconPath
      } catch {
        // Continue to the next candidate.
      }
    }
  }

  return undefined
}

async function resolveMacApplicationIconPath(applicationPath: string): Promise<string | undefined> {
  const infoPlistPath = path.join(applicationPath, "Contents", "Info.plist")
  const resourcesPath = path.join(applicationPath, "Contents", "Resources")
  const bundleName = path.basename(applicationPath, path.extname(applicationPath))
  const iconBaseNames = uniqueStrings([
    (await readPlistRawValue(infoPlistPath, "CFBundleIconFile")) ?? "",
    (await readPlistRawValue(infoPlistPath, "CFBundleIconName")) ?? "",
    bundleName,
    bundleName.replace(/\s+/g, ""),
    "AppIcon"
  ])

  const resolvedIconPath = await findExistingIconPath(resourcesPath, iconBaseNames)
  if (resolvedIconPath) {
    return resolvedIconPath
  }

  try {
    const resourceEntries = await fs.readdir(resourcesPath)
    const fallbackIcon = resourceEntries
      .filter((entry) => /\.(icns|png|tiff)$/i.test(entry))
      .sort((left, right) => {
        const leftScore = left.toLowerCase().endsWith(".icns") ? 0 : 1
        const rightScore = right.toLowerCase().endsWith(".icns") ? 0 : 1
        if (leftScore !== rightScore) {
          return leftScore - rightScore
        }

        return collator.compare(left, right)
      })[0]

    if (fallbackIcon) {
      return path.join(resourcesPath, fallbackIcon)
    }
  } catch {
    // Ignore missing Resources directories and fall back below.
  }

  return GENERIC_MAC_APP_ICON
}

async function createIconDataUrlFromPath(iconPath: string): Promise<string | undefined> {
  try {
    const thumbnail = await nativeImage.createThumbnailFromPath(iconPath, {
      height: 64,
      width: 64
    })
    if (!thumbnail.isEmpty()) {
      return thumbnail.toDataURL()
    }
  } catch {
    // Fall back to createFromPath below.
  }

  try {
    const icon = nativeImage.createFromPath(iconPath)
    if (!icon.isEmpty()) {
      return icon
        .resize({
          height: 64,
          quality: "best",
          width: 64
        })
        .toDataURL()
    }
  } catch {
    return undefined
  }

  return undefined
}

function scoreKeywordMatch(keyword: string, query: string): number {
  if (!query) {
    return -1
  }

  if (keyword === query) {
    return 120
  }

  if (keyword.startsWith(query)) {
    return 100
  }

  const includesIndex = keyword.indexOf(query)
  if (includesIndex >= 0) {
    return 70 - Math.min(includesIndex, 20)
  }

  return -1
}

function getPinyinMatchRange(value: string, query: string): [number, number] | undefined {
  const match = PinyinMatch.match(value, query)
  return Array.isArray(match) ? match : undefined
}

function scorePinyinMatch(
  value: string,
  query: string
): { match: [number, number]; score: number } | null {
  if (!query) {
    return null
  }

  const match = getPinyinMatchRange(value, query)
  if (!match) {
    return null
  }

  const [start, end] = match
  const span = end - start

  return {
    match,
    score: 68 - Math.min(start, 10) * 3 - Math.min(span, 6)
  }
}

function getApplicationMatch(
  application: LauncherApplicationRecord,
  query: string
): {
  match?: [number, number]
  score: number
  title: string
} | null {
  const candidates = [
    {
      normalizedValue: normalizeSearchValue(application.displayName),
      title: application.displayName,
      value: application.displayName
    },
    {
      normalizedValue: normalizeSearchValue(application.bundleName),
      title: application.bundleName,
      value: application.bundleName
    }
  ]
  let bestMatch: { match?: [number, number]; score: number; title: string } | null = null

  for (const candidate of candidates) {
    const literalScore = scoreKeywordMatch(candidate.normalizedValue, query)
    if (literalScore >= 0) {
      const nextMatch = {
        match: getTitleMatchRange(candidate.title, query),
        score: literalScore,
        title: candidate.title
      }

      if (!bestMatch || nextMatch.score > bestMatch.score) {
        bestMatch = nextMatch
      }
    }

    const pinyinScore = scorePinyinMatch(candidate.value, query)
    if (!pinyinScore) {
      continue
    }

    const nextMatch = {
      match: pinyinScore.match,
      score: pinyinScore.score,
      title: candidate.title
    }

    if (!bestMatch || nextMatch.score > bestMatch.score) {
      bestMatch = nextMatch
    }
  }

  if (bestMatch) {
    return bestMatch
  }

  let bestKeywordScore = -1

  for (const keyword of application.keywords) {
    const score = scoreKeywordMatch(keyword, query)
    if (score > bestKeywordScore) {
      bestKeywordScore = score
    }
  }

  if (bestKeywordScore < 0) {
    return null
  }

  return {
    score: bestKeywordScore,
    title: application.displayName
  }
}

export async function getApplicationIconDataUrl(
  applicationPath: string
): Promise<string | undefined> {
  let iconPromise = applicationIconPromiseCache.get(applicationPath)

  if (!iconPromise) {
    iconPromise = (async () => {
      if (process.platform === "darwin") {
        const iconPath = await resolveMacApplicationIconPath(applicationPath)
        if (iconPath) {
          const iconDataUrl = await createIconDataUrlFromPath(iconPath)
          if (iconDataUrl) {
            return iconDataUrl
          }
        }
      }

      try {
        const icon = await app.getFileIcon(applicationPath, { size: "small" })
        if (icon.isEmpty()) {
          return undefined
        }

        return icon.toDataURL()
      } catch {
        return undefined
      }
    })()

    applicationIconPromiseCache.set(applicationPath, iconPromise)
  }

  return iconPromise
}

async function mapApplicationResult(
  application: LauncherApplicationRecord,
  title: string,
  score: number,
  match?: [number, number]
): Promise<LauncherSearchResult> {
  return {
    action: {
      executor: "shell",
      target: {
        kind: "application",
        path: application.path
      },
      type: "open-path"
    },
    historyKey: createLauncherApplicationHistoryKey(application.path),
    id: application.id,
    iconDataUrl: await getApplicationIconDataUrl(application.path),
    kind: "application",
    match,
    score,
    source: "applications",
    subtitle: application.subtitle,
    title
  }
}

async function searchApplications(
  request: LauncherSearchRequest
): Promise<LauncherSearchProviderResponse> {
  const query = normalizeSearchValue(request.query)

  if (!query) {
    return {
      results: []
    }
  }

  const catalog = await getApplicationCatalog()
  const matches: Array<{
    application: LauncherApplicationRecord
    match?: [number, number]
    score: number
    title: string
  }> = []

  for (const application of catalog) {
    const match = getApplicationMatch(application, query)
    if (!match) {
      continue
    }

    matches.push({
      application,
      match: match.match,
      score: match.score,
      title: match.title
    })
  }

  matches.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }

    const titleOrder = collator.compare(left.title, right.title)
    if (titleOrder !== 0) {
      return titleOrder
    }

    return collator.compare(left.application.path, right.application.path)
  })
  const results = await Promise.all(
    matches
      .slice(0, Math.max(request.limit, 1))
      .map((entry) =>
        mapApplicationResult(entry.application, entry.title, entry.score, entry.match)
      )
  )

  return {
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
