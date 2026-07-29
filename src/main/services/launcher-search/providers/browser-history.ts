import PinyinMatch from "pinyin-match"
import { execFile } from "node:child_process"
import { Dirent, promises as fs, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { createLauncherHistoryKey } from "@shared/launcher-history"
import type { LauncherSearchRequest, LauncherSearchResult } from "@shared/launcher-search"
import type {
  LauncherSearchProvider,
  LauncherSearchProviderContext,
  LauncherSearchProviderResponse
} from "../types"

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

interface BrowserHistorySnapshot {
  expiresAt: number
  fingerprint: string
  generation: number
  readers: number
  retired: boolean
  snapshotPath: string
  tempDirectory: string
}

interface BrowserHistorySnapshotLease {
  release: () => Promise<void>
  snapshotPath: string
}

interface BrowserHistorySnapshotBuild {
  controller: AbortController
  fingerprint: string
  generation: number
  promise: Promise<BrowserHistorySnapshot>
  snapshot?: BrowserHistorySnapshot
  settled: boolean
  waiters: number
}

interface BrowserHistorySnapshotState {
  current?: BrowserHistorySnapshot
  generation: number
  pendingByFingerprint: Map<string, BrowserHistorySnapshotBuild>
  retiredSnapshots: Set<BrowserHistorySnapshot>
}

export interface BrowserHistorySnapshotLeaseManagerOptions {
  copyHistoryDatabase?: typeof copyChromiumHistoryDatabase
  now?: () => number
  onCleanupError?: () => void
  readFingerprint?: typeof readBrowserHistoryFingerprint
  removeDirectory?: (directoryPath: string) => Promise<void>
  snapshotTtlMs?: number
  tempDirectoryRoot?: string
}

const execFileAsync = promisify(execFile)
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
const BROWSER_HISTORY_SNAPSHOT_TTL_MS = 10_000
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

async function copyChromiumHistoryDatabase(params: {
  historyPath: string
  signal: AbortSignal
  tempDirectory: string
}): Promise<void> {
  const { historyPath, signal, tempDirectory } = params
  signal.throwIfAborted()
  const snapshotPath = path.join(tempDirectory, "History")
  await fs.copyFile(historyPath, snapshotPath)
  signal.throwIfAborted()

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
  signal.throwIfAborted()
}

async function readBrowserHistoryFileFingerprint(filePath: string): Promise<string> {
  try {
    const stats = await fs.stat(filePath, { bigint: true })
    return [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].join(":")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "missing"
    }

    throw error
  }
}

async function readBrowserHistoryFingerprint(historyPath: string): Promise<string> {
  const fingerprints = await Promise.all(
    [historyPath, `${historyPath}-wal`, `${historyPath}-shm`].map((filePath) =>
      readBrowserHistoryFileFingerprint(filePath)
    )
  )

  if (fingerprints[0] === "missing") {
    const error = new Error(`Browser history database does not exist: ${historyPath}`)
    ;(error as NodeJS.ErrnoException).code = "ENOENT"
    throw error
  }

  return fingerprints.join("|")
}

function waitForBrowserHistorySnapshot<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()

  return new Promise<T>((resolve, reject) => {
    const handleAbort = (): void => {
      reject(signal.reason)
    }

    signal.addEventListener("abort", handleAbort, { once: true })
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", handleAbort)
    })
  })
}

class BrowserHistorySnapshotChangedError extends Error {
  constructor() {
    super("Browser history changed while its search snapshot was being created.")
    this.name = "BrowserHistorySnapshotChangedError"
  }
}

export class BrowserHistorySnapshotLeaseManager {
  private readonly disposalController = new AbortController()
  private disposed = false
  private readonly cleanupFailureReported = new Set<string>()
  private readonly ownedDirectories = new Set<string>()
  private readonly pendingCleanupDirectories = new Set<string>()
  private readonly states = new Map<string, BrowserHistorySnapshotState>()

  constructor(private readonly options: BrowserHistorySnapshotLeaseManagerOptions = {}) {}

  async acquire(historyPath: string, signal: AbortSignal): Promise<BrowserHistorySnapshotLease> {
    if (this.disposed) {
      throw new Error("Browser history snapshot manager is disposed.")
    }
    const acquisitionSignal = AbortSignal.any([signal, this.disposalController.signal])

    for (let attempt = 0; attempt < 3; attempt += 1) {
      acquisitionSignal.throwIfAborted()
      await this.removePendingCleanupDirectories()
      acquisitionSignal.throwIfAborted()
      const cleanupBlocked = this.pendingCleanupDirectories.size > 0
      const fingerprint = await this.readFingerprint(historyPath)
      acquisitionSignal.throwIfAborted()
      const state = this.getState(historyPath)
      if (!cleanupBlocked) {
        await this.removeRetiredSnapshots(state)
      }
      acquisitionSignal.throwIfAborted()
      const current = state.current

      if (current) {
        const isCurrent =
          !current.retired && current.fingerprint === fingerprint && this.now() < current.expiresAt
        if (isCurrent) {
          return this.createLease(state, current)
        }

        this.retireSnapshot(state, current)
        await this.removeRetiredSnapshot(state, current)
      }

      const pending = state.pendingByFingerprint.get(fingerprint)
      if (pending?.controller.signal.aborted) {
        throw new Error(
          "Browser history snapshot cancellation is still pending; refusing to create a replacement snapshot."
        )
      }
      if (!pending && this.pendingCleanupDirectories.size > 0) {
        throw new Error(
          "Browser history snapshot cleanup is blocked; refusing to create another snapshot."
        )
      }
      const build = pending ?? this.startSnapshotBuild(historyPath, fingerprint, state)

      try {
        const lease = await this.waitForBuild(state, build, acquisitionSignal)
        try {
          acquisitionSignal.throwIfAborted()
          return lease
        } catch (error) {
          await lease.release()
          throw error
        }
      } catch (error) {
        if (error instanceof BrowserHistorySnapshotChangedError && attempt < 2) {
          continue
        }

        throw error
      }
    }

    throw new BrowserHistorySnapshotChangedError()
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.disposalController.abort(new Error("Browser history snapshot manager is disposed."))
    const builds: Promise<BrowserHistorySnapshot>[] = []
    for (const state of this.states.values()) {
      for (const build of state.pendingByFingerprint.values()) {
        build.controller.abort(new Error("Browser history snapshot manager is disposed."))
        builds.push(build.promise)
      }
    }
    await Promise.allSettled(builds)

    for (const state of this.states.values()) {
      if (state.current) {
        this.retireSnapshot(state, state.current)
      }
      await this.removeRetiredSnapshots(state)
    }
    await this.removePendingCleanupDirectories()
  }

  disposeSync(): void {
    this.disposed = true
    this.disposalController.abort(new Error("Browser history snapshot manager is disposed."))
    for (const state of this.states.values()) {
      for (const build of state.pendingByFingerprint.values()) {
        build.controller.abort(new Error("Browser history snapshot manager is disposed."))
      }
    }

    for (const directoryPath of this.ownedDirectories) {
      try {
        rmSync(directoryPath, { force: true, recursive: true })
      } catch {
        this.reportCleanupError(directoryPath)
      }
    }
    this.ownedDirectories.clear()
    this.pendingCleanupDirectories.clear()
  }

  private createLease(
    state: BrowserHistorySnapshotState,
    snapshot: BrowserHistorySnapshot
  ): BrowserHistorySnapshotLease {
    snapshot.readers += 1
    let released = false

    return {
      release: async () => {
        if (released) {
          return
        }

        released = true
        snapshot.readers -= 1
        if (!snapshot.retired && this.now() >= snapshot.expiresAt) {
          this.retireSnapshot(state, snapshot)
        }
        await this.removeRetiredSnapshot(state, snapshot)
      },
      snapshotPath: snapshot.snapshotPath
    }
  }

  private getState(historyPath: string): BrowserHistorySnapshotState {
    const existing = this.states.get(historyPath)
    if (existing) {
      return existing
    }

    const state: BrowserHistorySnapshotState = {
      generation: 0,
      pendingByFingerprint: new Map(),
      retiredSnapshots: new Set()
    }
    this.states.set(historyPath, state)
    return state
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private readFingerprint(historyPath: string): Promise<string> {
    return (this.options.readFingerprint ?? readBrowserHistoryFingerprint)(historyPath)
  }

  private reportCleanupError(directoryPath: string): void {
    if (this.cleanupFailureReported.has(directoryPath)) {
      return
    }

    this.cleanupFailureReported.add(directoryPath)
    if (this.options.onCleanupError) {
      this.options.onCleanupError()
      return
    }

    console.warn("[LauncherSearch] Failed to clean up a browser history snapshot.")
  }

  private async removeDirectory(directoryPath: string): Promise<boolean> {
    try {
      await (
        this.options.removeDirectory ??
        ((target) => fs.rm(target, { force: true, recursive: true }))
      )(directoryPath)
      this.cleanupFailureReported.delete(directoryPath)
      this.ownedDirectories.delete(directoryPath)
      this.pendingCleanupDirectories.delete(directoryPath)
      return true
    } catch {
      this.pendingCleanupDirectories.add(directoryPath)
      this.reportCleanupError(directoryPath)
      return false
    }
  }

  private async removePendingCleanupDirectories(): Promise<void> {
    await Promise.all(
      [...this.pendingCleanupDirectories].map((directoryPath) =>
        this.removeDirectory(directoryPath)
      )
    )
  }

  private async removeRetiredSnapshot(
    state: BrowserHistorySnapshotState,
    snapshot: BrowserHistorySnapshot
  ): Promise<void> {
    if (!snapshot.retired || snapshot.readers > 0) {
      return
    }

    if (await this.removeDirectory(snapshot.tempDirectory)) {
      state.retiredSnapshots.delete(snapshot)
    }
  }

  private async removeRetiredSnapshots(state: BrowserHistorySnapshotState): Promise<void> {
    await Promise.all(
      [...state.retiredSnapshots].map((snapshot) => this.removeRetiredSnapshot(state, snapshot))
    )
  }

  private retireSnapshot(
    state: BrowserHistorySnapshotState,
    snapshot: BrowserHistorySnapshot
  ): void {
    snapshot.retired = true
    state.retiredSnapshots.add(snapshot)
    if (state.current === snapshot) {
      state.current = undefined
    }
  }

  private startSnapshotBuild(
    historyPath: string,
    fingerprint: string,
    state: BrowserHistorySnapshotState
  ): BrowserHistorySnapshotBuild {
    const controller = new AbortController()
    const generation = state.generation + 1
    state.generation = generation
    const build: BrowserHistorySnapshotBuild = {
      controller,
      fingerprint,
      generation,
      promise: Promise.resolve(undefined as never),
      settled: false,
      waiters: 0
    }

    build.promise = this.buildSnapshot(historyPath, fingerprint, generation, controller.signal)
      .then((snapshot) => {
        build.snapshot = snapshot
        if (generation === state.generation) {
          const previous = state.current
          state.current = snapshot
          if (previous && previous !== snapshot) {
            this.retireSnapshot(state, previous)
            void this.removeRetiredSnapshot(state, previous)
          }
        } else {
          snapshot.retired = true
          state.retiredSnapshots.add(snapshot)
        }

        return snapshot
      })
      .finally(() => {
        build.settled = true
        if (state.pendingByFingerprint.get(fingerprint) === build) {
          state.pendingByFingerprint.delete(fingerprint)
        }
        if (build.snapshot?.retired && build.waiters === 0) {
          void this.removeRetiredSnapshot(state, build.snapshot)
        }
      })

    state.pendingByFingerprint.set(fingerprint, build)
    return build
  }

  private async buildSnapshot(
    historyPath: string,
    fingerprint: string,
    generation: number,
    signal: AbortSignal
  ): Promise<BrowserHistorySnapshot> {
    const tempDirectory = await fs.mkdtemp(
      path.join(this.options.tempDirectoryRoot ?? os.tmpdir(), "jingle-browser-history-")
    )
    this.ownedDirectories.add(tempDirectory)

    try {
      await (this.options.copyHistoryDatabase ?? copyChromiumHistoryDatabase)({
        historyPath,
        signal,
        tempDirectory
      })
      const finalFingerprint = await this.readFingerprint(historyPath)
      signal.throwIfAborted()
      if (finalFingerprint !== fingerprint) {
        throw new BrowserHistorySnapshotChangedError()
      }

      return {
        expiresAt: this.now() + (this.options.snapshotTtlMs ?? BROWSER_HISTORY_SNAPSHOT_TTL_MS),
        fingerprint,
        generation,
        readers: 0,
        retired: false,
        snapshotPath: path.join(tempDirectory, "History"),
        tempDirectory
      }
    } catch (error) {
      await this.removeDirectory(tempDirectory)
      throw error
    }
  }

  private async waitForBuild(
    state: BrowserHistorySnapshotState,
    build: BrowserHistorySnapshotBuild,
    signal: AbortSignal
  ): Promise<BrowserHistorySnapshotLease> {
    build.waiters += 1

    try {
      const snapshot = await waitForBrowserHistorySnapshot(build.promise, signal)
      return this.createLease(state, snapshot)
    } finally {
      build.waiters -= 1
      if (build.waiters === 0 && !build.settled) {
        build.controller.abort(new Error("Browser history snapshot has no active readers."))
      }

      if (build.settled) {
        const snapshot = build.snapshot ?? (await build.promise.catch(() => undefined))
        if (snapshot?.retired && build.waiters === 0) {
          await this.removeRetiredSnapshot(state, snapshot)
        }
      }
    }
  }
}

const browserHistorySnapshotLeaseManager = new BrowserHistorySnapshotLeaseManager()
process.once("exit", () => {
  browserHistorySnapshotLeaseManager.disposeSync()
})

export async function queryChromiumHistoryRows(params: {
  historyPath: string
  limit: number
  query: string
  signal: AbortSignal
  snapshotLeaseManager?: BrowserHistorySnapshotLeaseManager
}): Promise<BrowserHistoryRow[]> {
  const {
    historyPath,
    limit,
    query,
    signal,
    snapshotLeaseManager = browserHistorySnapshotLeaseManager
  } = params
  signal.throwIfAborted()
  const sqlQuery = escapeSqlLiteral(escapeSqlLike(query))
  const lease = await snapshotLeaseManager.acquire(historyPath, signal)
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
        COALESCE(title, '') LIKE '%${sqlQuery}%' ESCAPE '\\'
        OR url LIKE '%${sqlQuery}%' ESCAPE '\\'
      )
    ORDER BY last_visit_time DESC
    LIMIT ${Math.max(limit, 1)};
  `

  try {
    const { stdout } = await execFileAsync("/usr/bin/sqlite3", ["-json", lease.snapshotPath, sql], {
      maxBuffer: 8 * 1024 * 1024,
      signal
    })
    signal.throwIfAborted()
    const rows = stdout.toString().trim()
    return rows ? (JSON.parse(rows) as BrowserHistoryRow[]) : []
  } finally {
    await lease.release()
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

  async warmup(context: LauncherSearchProviderContext): Promise<void> {
    await this.getProfiles(context.signal)
  }

  async search(
    request: LauncherSearchRequest,
    context: LauncherSearchProviderContext = { signal: new AbortController().signal }
  ): Promise<LauncherSearchProviderResponse> {
    context.signal.throwIfAborted()
    if (process.platform !== "darwin") {
      return { kind: "complete", results: [] }
    }

    const trimmedQuery = request.query.trim()
    const normalizedQuery = normalizeSearchValue(trimmedQuery)
    if (!normalizedQuery) {
      return { kind: "complete", results: [] }
    }

    const profiles = await this.getProfiles(context.signal)
    context.signal.throwIfAborted()
    if (profiles.length === 0) {
      return { kind: "complete", results: [] }
    }

    const perProfileLimit = Math.max(Math.ceil(request.limit / profiles.length) * 4, 12)
    const candidates = (
      await Promise.all(
        profiles.map((profile) =>
          this.searchProfile(
            profile,
            trimmedQuery,
            normalizedQuery,
            perProfileLimit,
            context.signal
          )
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

    context.signal.throwIfAborted()
    return { kind: "complete", results }
  }

  private async getProfiles(signal: AbortSignal): Promise<BrowserHistoryProfile[]> {
    signal.throwIfAborted()
    if (!this.profilesPromise) {
      this.profilesPromise = Promise.all(
        CHROMIUM_BROWSER_ROOTS.map((root) => scanChromiumBrowserProfiles(root))
      ).then((groups) => groups.flat())
    }

    const profiles = await this.profilesPromise
    signal.throwIfAborted()
    return profiles
  }

  private async searchProfile(
    profile: BrowserHistoryProfile,
    rawQuery: string,
    normalizedQuery: string,
    limit: number,
    signal: AbortSignal
  ): Promise<BrowserHistoryCandidate[]> {
    const rows = await queryChromiumHistoryRows({
      historyPath: profile.historyPath,
      limit,
      query: rawQuery,
      signal
    })
    signal.throwIfAborted()

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
