import PinyinMatch from "pinyin-match"
import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { createLauncherHistoryKey } from "@shared/launcher-history"
import type { LauncherSearchRequest, LauncherSearchResult } from "@shared/launcher-search"
import type {
  LauncherSearchProvider,
  LauncherSearchProviderContext,
  LauncherSearchProviderResponse
} from "../types"

interface MacFileSearchCandidate {
  kind: "file" | "directory"
  match?: [number, number]
  path: string
  score: number
  subtitle: string
  title: string
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
const MAC_FILE_SEARCH_ROOT = os.homedir()
const MAC_FILE_SEARCH_MAX_CANDIDATES = 200
const MAC_FILE_SEARCH_MAX_QUERY_LENGTH = 120
const MAC_FILE_SEARCH_MAX_QUERY_TOKENS = 8
const MAC_FILE_SEARCH_TIMEOUT_MS = 650
const NUL_BYTE = 0
const MAC_FILE_SEARCH_EXCLUDED_ROOTS = new Set(
  [
    path.join(MAC_FILE_SEARCH_ROOT, "Library", "Caches"),
    path.join(MAC_FILE_SEARCH_ROOT, "Library", "Logs"),
    path.join(MAC_FILE_SEARCH_ROOT, "Library", "Developer"),
    path.join(MAC_FILE_SEARCH_ROOT, "Library", "Application Support", "Code", "logs"),
    path.join(MAC_FILE_SEARCH_ROOT, "Library", "Application Support", "Cursor", "logs")
  ].map((rootPath) => path.normalize(rootPath))
)
const MAC_FILE_SEARCH_PACKAGE_EXTENSIONS = new Set([
  ".app",
  ".bundle",
  ".framework",
  ".kext",
  ".pkg",
  ".plugin",
  ".prefpane"
])

function normalizeSearchValue(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

export function resolveMacSpotlightNameQuery(value: string): string | null {
  if (/[\r\n]/.test(value)) {
    return null
  }

  const query = value.replace(/\s+/g, " ").trim()
  if (!query) {
    return null
  }

  if (query.length > MAC_FILE_SEARCH_MAX_QUERY_LENGTH) {
    return null
  }

  if (query.split(" ").length > MAC_FILE_SEARCH_MAX_QUERY_TOKENS) {
    return null
  }

  return query
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

function isExcludedMacFileSearchPath(filePath: string, kind: "file" | "directory"): boolean {
  const normalizedPath = path.normalize(filePath)

  for (const excludedRoot of MAC_FILE_SEARCH_EXCLUDED_ROOTS) {
    if (
      normalizedPath === excludedRoot ||
      normalizedPath.startsWith(`${excludedRoot}${path.sep}`)
    ) {
      return true
    }
  }

  if (kind === "directory") {
    const extension = path.extname(normalizedPath).toLowerCase()
    if (MAC_FILE_SEARCH_PACKAGE_EXTENSIONS.has(extension)) {
      return true
    }
  }

  return false
}

function getFileSearchSubtitle(filePath: string): string {
  const directoryPath = path.dirname(filePath)
  if (directoryPath === MAC_FILE_SEARCH_ROOT) {
    return "~"
  }

  if (directoryPath.startsWith(`${MAC_FILE_SEARCH_ROOT}${path.sep}`)) {
    return `~${directoryPath.slice(MAC_FILE_SEARCH_ROOT.length)}`
  }

  return directoryPath
}

function findNulByteIndex(buffer: Buffer): number {
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === NUL_BYTE) {
      return index
    }
  }

  return -1
}

function getFileSearchMatch(params: {
  kind: "file" | "directory"
  query: string
  filePath: string
}): { match?: [number, number]; score: number; title: string } | null {
  const { filePath, kind, query } = params
  const title = path.basename(filePath)
  const titleWithoutExtension =
    kind === "file" ? path.basename(filePath, path.extname(filePath)) : title
  const normalizedTitle = normalizeSearchValue(title)
  const normalizedTitleWithoutExtension = normalizeSearchValue(titleWithoutExtension)
  const normalizedPath = normalizeSearchValue(filePath)
  const normalizedParent = normalizeSearchValue(path.basename(path.dirname(filePath)))
  let bestMatch: { match?: [number, number]; score: number; title: string } | null = null

  for (const candidateTitle of [title, titleWithoutExtension]) {
    const literalScore = scoreKeywordMatch(normalizeSearchValue(candidateTitle), query)
    if (literalScore >= 0) {
      const nextMatch = {
        match: getTitleMatchRange(title, query),
        score: literalScore,
        title
      }

      if (!bestMatch || nextMatch.score > bestMatch.score) {
        bestMatch = nextMatch
      }
    }

    const pinyinScore = scorePinyinMatch(candidateTitle, query)
    if (pinyinScore && (!bestMatch || pinyinScore.score > bestMatch.score)) {
      bestMatch = {
        match: pinyinScore.match,
        score: pinyinScore.score,
        title
      }
    }
  }

  for (const [value, bonus] of [
    [normalizedTitle, 0],
    [normalizedTitleWithoutExtension, 2],
    [normalizedParent, 6],
    [normalizedPath, 4]
  ] as const) {
    const score = scoreKeywordMatch(value, query)
    if (score < 0) {
      continue
    }

    const nextMatch = {
      score: score + bonus,
      title
    }

    if (!bestMatch || nextMatch.score > bestMatch.score) {
      bestMatch = nextMatch
    }
  }

  return bestMatch
}

interface MacSpotlightPathCollection {
  kind: "complete" | "partial"
  paths: string[]
}

async function collectMacSpotlightPaths(
  query: string,
  limit: number,
  signal: AbortSignal
): Promise<MacSpotlightPathCollection> {
  signal.throwIfAborted()
  const candidateLimit = Math.min(Math.max(limit * 10, limit), MAC_FILE_SEARCH_MAX_CANDIDATES)

  return new Promise((resolve, reject) => {
    const paths: string[] = []
    let stdoutBuffer = Buffer.alloc(0)
    let stderr = ""
    let killedForLimit = false
    let killedForTimeout = false
    let settled = false

    const child = spawn(
      "/usr/bin/mdfind",
      ["-0", "-onlyin", MAC_FILE_SEARCH_ROOT, "-name", query],
      {
        stdio: ["ignore", "pipe", "pipe"]
      }
    )

    const settle = (next: () => void): void => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      signal.removeEventListener("abort", handleAbort)
      next()
    }

    const handleAbort = (): void => {
      child.kill("SIGTERM")
      settle(() =>
        reject(
          signal.reason instanceof Error ? signal.reason : new Error("File search was cancelled.")
        )
      )
    }

    signal.addEventListener("abort", handleAbort, { once: true })

    const timeout = setTimeout(() => {
      killedForTimeout = true
      child.kill("SIGTERM")
      settle(() => resolve({ kind: "partial", paths: [...paths] }))
    }, MAC_FILE_SEARCH_TIMEOUT_MS)

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer = Buffer.concat([stdoutBuffer, chunk])

      while (true) {
        const separatorIndex = findNulByteIndex(stdoutBuffer)
        if (separatorIndex < 0) {
          break
        }

        const nextPath = stdoutBuffer.subarray(0, separatorIndex).toString()
        stdoutBuffer = stdoutBuffer.subarray(separatorIndex + 1)

        if (!nextPath) {
          continue
        }

        paths.push(nextPath)

        if (paths.length >= candidateLimit) {
          killedForLimit = true
          child.kill("SIGTERM")
          break
        }
      }
    })

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.once("error", (error) => {
      settle(() => reject(error))
    })
    child.once("close", (code, signal) => {
      if ((killedForLimit || killedForTimeout) && signal === "SIGTERM") {
        settle(() => resolve({ kind: killedForTimeout ? "partial" : "complete", paths }))
        return
      }

      if (code === 0) {
        settle(() => resolve({ kind: "complete", paths }))
        return
      }

      settle(() =>
        reject(new Error(stderr.trim() || `mdfind exited with code ${code ?? "unknown"}`))
      )
    })
  })
}

async function resolveMacFileSearchCandidate(
  filePath: string,
  query: string,
  signal: AbortSignal
): Promise<MacFileSearchCandidate | null> {
  signal.throwIfAborted()
  let stats: Awaited<ReturnType<typeof fs.stat>>

  try {
    stats = await fs.stat(filePath)
  } catch {
    return null
  }
  signal.throwIfAborted()

  const kind = stats.isDirectory() ? "directory" : stats.isFile() ? "file" : null
  if (!kind || isExcludedMacFileSearchPath(filePath, kind)) {
    return null
  }

  const match = getFileSearchMatch({
    filePath,
    kind,
    query
  })
  if (!match) {
    return null
  }

  return {
    kind,
    match: match.match,
    path: filePath,
    score: match.score,
    subtitle: getFileSearchSubtitle(filePath),
    title: match.title
  }
}

async function searchMacFiles(
  request: LauncherSearchRequest,
  context: LauncherSearchProviderContext
): Promise<LauncherSearchProviderResponse> {
  context.signal.throwIfAborted()
  const query = normalizeSearchValue(request.query)
  if (!query) {
    return {
      kind: "complete",
      results: []
    }
  }

  const spotlightQuery = resolveMacSpotlightNameQuery(request.query)
  if (!spotlightQuery) {
    return {
      kind: "complete",
      results: []
    }
  }

  let collection: MacSpotlightPathCollection

  try {
    collection = await collectMacSpotlightPaths(spotlightQuery, request.limit, context.signal)
  } catch (error) {
    if (context.signal.aborted) {
      throw error
    }
    console.warn("[LauncherSearch][files] Spotlight search failed:", {
      error: error instanceof Error ? error.message : String(error),
      query: request.query
    })

    return {
      kind: "partial",
      results: []
    }
  }

  const candidates = (
    await Promise.all(
      collection.paths.map((candidatePath) =>
        resolveMacFileSearchCandidate(candidatePath, query, context.signal)
      )
    )
  ).filter((candidate): candidate is MacFileSearchCandidate => candidate !== null)
  context.signal.throwIfAborted()

  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }

    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1
    }

    const titleOrder = collator.compare(left.title, right.title)
    if (titleOrder !== 0) {
      return titleOrder
    }

    return collator.compare(left.path, right.path)
  })

  const results: LauncherSearchResult[] = candidates
    .slice(0, Math.max(request.limit, 1))
    .map((candidate) => ({
      action: {
        executor: "shell",
        target: {
          kind: candidate.kind,
          path: candidate.path
        },
        type: "open-path"
      },
      historyKey: createLauncherHistoryKey({
        path: candidate.path,
        type: candidate.kind
      }),
      id: candidate.path,
      kind: candidate.kind,
      match: candidate.match,
      score: candidate.score,
      source: "files",
      subtitle: candidate.subtitle,
      title: candidate.title
    }))

  return {
    kind: collection.kind,
    results
  }
}

class FilesLauncherSearchProvider implements LauncherSearchProvider {
  readonly source = "files" as const

  async search(
    request: LauncherSearchRequest,
    context: LauncherSearchProviderContext = { signal: new AbortController().signal }
  ): Promise<LauncherSearchProviderResponse> {
    context.signal.throwIfAborted()
    if (process.platform !== "darwin") {
      return {
        kind: "complete",
        results: []
      }
    }

    return searchMacFiles(request, context)
  }
}

export const filesLauncherSearchProvider = new FilesLauncherSearchProvider()
