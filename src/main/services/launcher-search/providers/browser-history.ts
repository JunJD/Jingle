import PinyinMatch from "pinyin-match"
import { execFile } from "node:child_process"
import { Dirent, promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { createLauncherHistoryKey } from "@shared/launcher-history"
import type {
  LauncherSearchRequest,
  LauncherSearchResult
} from "@shared/launcher-search"
import type { LauncherSearchProvider, LauncherSearchProviderResponse } from "../types"

type ChromiumBrowser = "chrome" | "edge"

interface ChromiumBrowserRoot {
  browser: ChromiumBrowser
  browserLabel: string
  rootPath: string
}

interface BrowserHistoryProfile {
  browser: ChromiumBrowser
  browserLabel: string
  historyPath: string
  id: string
}

interface BrowserHistoryRow {
  last_visit_time: number
  title: string | null
  url: string
  visit_count: number
}

interface BrowserHistoryCandidate {
  historyKey: string
  id: string
  match?: [number, number]
  score: number
  subtitle: string
  title: string
  url: string
  visitedAtMs: number
  visitCount: number
}

const execFileAsync = promisify(execFile)
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
const CHROMIUM_BROWSER_ROOTS: ChromiumBrowserRoot[] = [
  {
    browser: "chrome",
    browserLabel: "Chrome",
    rootPath: path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome")
  },
  {
    browser: "edge",
    browserLabel: "Edge",
    rootPath: path.join(os.homedir(), "Library", "Application Support", "Microsoft Edge")
  }
]

function normalizeSearchValue(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''")
}

function escapeSqlLike(value: string): string {
  return value.replace(/([%_\\])/g, "\\$1")
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

function chromiumTimeToUnixMilliseconds(value: number): number {
  return Math.max(0, Math.floor(value / 1000 - 11644473600000))
}

function getRecencyBoost(visitedAtMs: number): number {
  const ageMs = Date.now() - visitedAtMs

  if (ageMs <= 24 * 60 * 60 * 1000) {
    return 18
  }

  if (ageMs <= 7 * 24 * 60 * 60 * 1000) {
    return 12
  }

  if (ageMs <= 30 * 24 * 60 * 60 * 1000) {
    return 6
  }

  return 0
}

function getUrlHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "")
  } catch {
    return ""
  }
}

function getUrlDisplayTitle(url: string): string {
  try {
    const parsedUrl = new URL(url)
    const pathname = parsedUrl.pathname === "/" ? "" : parsedUrl.pathname
    return `${parsedUrl.hostname.replace(/^www\./i, "")}${pathname}`
  } catch {
    return url
  }
}

function compareBrowserHistoryCandidates(
  left: BrowserHistoryCandidate,
  right: BrowserHistoryCandidate
): number {
  if (right.score !== left.score) {
    return right.score - left.score
  }

  if (right.visitedAtMs !== left.visitedAtMs) {
    return right.visitedAtMs - left.visitedAtMs
  }

  if (right.visitCount !== left.visitCount) {
    return right.visitCount - left.visitCount
  }

  const titleOrder = collator.compare(left.title, right.title)
  if (titleOrder !== 0) {
    return titleOrder
  }

  return collator.compare(left.url, right.url)
}

function dedupeBrowserHistoryCandidates(
  candidates: BrowserHistoryCandidate[]
): BrowserHistoryCandidate[] {
  const candidatesByVisibleIdentity = new Map<string, BrowserHistoryCandidate>()

  for (const candidate of candidates) {
    const visibleIdentity = `${normalizeSearchValue(candidate.title)}|${normalizeSearchValue(candidate.subtitle)}`
    const existing = candidatesByVisibleIdentity.get(visibleIdentity)

    if (!existing || compareBrowserHistoryCandidates(candidate, existing) < 0) {
      candidatesByVisibleIdentity.set(visibleIdentity, candidate)
    }
  }

  return [...candidatesByVisibleIdentity.values()]
}

function getBrowserHistoryMatch(
  row: BrowserHistoryRow,
  query: string
): { match?: [number, number]; score: number; title: string } | null {
  const resolvedTitle = row.title?.trim() || getUrlDisplayTitle(row.url)
  const normalizedTitle = normalizeSearchValue(resolvedTitle)
  const normalizedUrl = normalizeSearchValue(row.url)
  const normalizedHostname = normalizeSearchValue(getUrlHostname(row.url))
  let bestMatch: { match?: [number, number]; score: number; title: string } | null = null

  const titleLiteralScore = scoreKeywordMatch(normalizedTitle, query)
  if (titleLiteralScore >= 0) {
    bestMatch = {
      match: getTitleMatchRange(resolvedTitle, query),
      score: titleLiteralScore,
      title: resolvedTitle
    }
  }

  const titlePinyinScore = scorePinyinMatch(resolvedTitle, query)
  if (titlePinyinScore && (!bestMatch || titlePinyinScore.score > bestMatch.score)) {
    bestMatch = {
      match: titlePinyinScore.match,
      score: titlePinyinScore.score,
      title: resolvedTitle
    }
  }

  const hostnameScore = scoreKeywordMatch(normalizedHostname, query)
  if (hostnameScore >= 0) {
    const nextMatch = {
      score: hostnameScore + 8,
      title: resolvedTitle
    }
    if (!bestMatch || nextMatch.score > bestMatch.score) {
      bestMatch = nextMatch
    }
  }

  const urlScore = scoreKeywordMatch(normalizedUrl, query)
  if (urlScore >= 0) {
    const nextMatch = {
      score: urlScore + 4,
      title: resolvedTitle
    }
    if (!bestMatch || nextMatch.score > bestMatch.score) {
      bestMatch = nextMatch
    }
  }

  return bestMatch
}

async function copyChromiumHistoryDatabase(historyPath: string): Promise<string> {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "jingle-browser-history-"))
  const snapshotPath = path.join(tempDirectory, "History")
  await fs.copyFile(historyPath, snapshotPath)

  await Promise.all(
    ["-wal", "-shm"].map(async (suffix) => {
      const sourcePath = `${historyPath}${suffix}`
      const targetPath = `${snapshotPath}${suffix}`

      try {
        await fs.copyFile(sourcePath, targetPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error
        }
      }
    })
  )

  return tempDirectory
}

async function queryChromiumHistoryRows(params: {
  historyPath: string
  limit: number
  query: string
}): Promise<BrowserHistoryRow[]> {
  const { historyPath, limit, query } = params
  const sqlQuery = escapeSqlLiteral(escapeSqlLike(query))
  const tempDirectory = await copyChromiumHistoryDatabase(historyPath)
  const snapshotPath = path.join(tempDirectory, "History")
  const sql = `
    SELECT
      url,
      title,
      visit_count,
      last_visit_time
    FROM urls
    WHERE
      hidden = 0
      AND url LIKE 'http%'
      AND (
        lower(COALESCE(title, '')) LIKE lower('%${sqlQuery}%') ESCAPE '\\'
        OR lower(url) LIKE lower('%${sqlQuery}%') ESCAPE '\\'
      )
    ORDER BY last_visit_time DESC
    LIMIT ${Math.max(limit, 1)};
  `

  try {
    const { stdout } = await execFileAsync("/usr/bin/sqlite3", ["-json", snapshotPath, sql], {
      maxBuffer: 8 * 1024 * 1024
    })
    const rows = stdout.toString().trim()
    return rows ? (JSON.parse(rows) as BrowserHistoryRow[]) : []
  } finally {
    await fs.rm(tempDirectory, { force: true, recursive: true })
  }
}

async function scanChromiumBrowserProfiles(
  root: ChromiumBrowserRoot
): Promise<BrowserHistoryProfile[]> {
  let entries: Dirent[] = []

  try {
    entries = await fs.readdir(root.rootPath, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []
    }

    throw error
  }

  const profileDirectoryNames = entries.flatMap((entry) => {
    if (!entry.isDirectory()) {
      return []
    }

    return entry.name === "Default" || entry.name.startsWith("Profile ") ? [entry.name] : []
  })

  const availableProfiles = await Promise.all(
    profileDirectoryNames.map(async (profileDirectoryName) => {
      const historyPath = path.join(root.rootPath, profileDirectoryName, "History")

      try {
        await fs.access(historyPath)
        return {
          browser: root.browser,
          browserLabel: root.browserLabel,
          historyPath,
          id: `${root.browser}:${profileDirectoryName}`
        } satisfies BrowserHistoryProfile
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null
        }

        throw error
      }
    })
  )

  return availableProfiles.filter((profile): profile is BrowserHistoryProfile => profile !== null)
}

class BrowserHistoryLauncherSearchProvider implements LauncherSearchProvider {
  readonly source = "browser-history" as const
  private profilesPromise: Promise<BrowserHistoryProfile[]> | null = null

  async warmup(): Promise<void> {
    await this.getProfiles()
  }

  async search(request: LauncherSearchRequest): Promise<LauncherSearchProviderResponse> {
    if (process.platform !== "darwin") {
      return { results: [] }
    }

    const trimmedQuery = request.query.trim()
    const normalizedQuery = normalizeSearchValue(trimmedQuery)
    if (!normalizedQuery) {
      return { results: [] }
    }

    const profiles = await this.getProfiles()
    if (profiles.length === 0) {
      return { results: [] }
    }

    const perProfileLimit = Math.max(Math.ceil(request.limit / profiles.length) * 4, 12)
    const candidates = (
      await Promise.all(
        profiles.map((profile) =>
          this.searchProfile(profile, trimmedQuery, normalizedQuery, perProfileLimit)
        )
      )
    ).flat()
    const dedupedCandidates = dedupeBrowserHistoryCandidates(candidates)

    const results = dedupedCandidates
      .sort(compareBrowserHistoryCandidates)
      .slice(0, request.limit)
      .map<LauncherSearchResult>((candidate) => ({
        action: {
          executor: "shell",
          target: {
            url: candidate.url
          },
          type: "open-url"
        },
        historyKey: candidate.historyKey,
        id: candidate.id,
        kind: "url",
        match: candidate.match,
        score: candidate.score,
        source: "browser-history",
        subtitle: candidate.subtitle,
        title: candidate.title
      }))

    return { results }
  }

  private async getProfiles(): Promise<BrowserHistoryProfile[]> {
    if (!this.profilesPromise) {
      this.profilesPromise = Promise.all(
        CHROMIUM_BROWSER_ROOTS.map((root) => scanChromiumBrowserProfiles(root))
      ).then((groups) => groups.flat())
    }

    return this.profilesPromise
  }

  private async searchProfile(
    profile: BrowserHistoryProfile,
    rawQuery: string,
    normalizedQuery: string,
    limit: number
  ): Promise<BrowserHistoryCandidate[]> {
    const rows = await queryChromiumHistoryRows({
      historyPath: profile.historyPath,
      limit,
      query: rawQuery
    })

    return rows
      .map((row) => this.toCandidate(profile, row, normalizedQuery))
      .filter((candidate): candidate is BrowserHistoryCandidate => candidate !== null)
  }

  private toCandidate(
    profile: BrowserHistoryProfile,
    row: BrowserHistoryRow,
    normalizedQuery: string
  ): BrowserHistoryCandidate | null {
    const match = getBrowserHistoryMatch(row, normalizedQuery)
    if (!match) {
      return null
    }

    const visitedAtMs = chromiumTimeToUnixMilliseconds(row.last_visit_time)
    const hostname = getUrlHostname(row.url)

    return {
      historyKey: createLauncherHistoryKey({
        browser: profile.browser,
        type: "browser-history",
        url: row.url
      }),
      id: `${profile.browser}:${row.url}`,
      match: match.match,
      score: match.score + Math.min(row.visit_count, 24) + getRecencyBoost(visitedAtMs),
      subtitle: hostname ? `${hostname} · ${profile.browserLabel}` : profile.browserLabel,
      title: match.title,
      url: row.url,
      visitedAtMs,
      visitCount: row.visit_count
    }
  }
}

export const browserHistoryLauncherSearchProvider = new BrowserHistoryLauncherSearchProvider()
