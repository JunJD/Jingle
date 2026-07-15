import { readFile } from "fs/promises"
import { join } from "path"
import type {
  JingleContextSourceRecord,
  JingleMemoryContextDiagnostic,
  JingleMemoryContextItem,
  JingleMemoryContextKind,
  JingleMemoryScope
} from "@shared/jingle-memory"
import { getJingleHomeDir } from "../storage"

const MAX_FILE_CONTENT_BYTES = 24_000

interface FileContextSource {
  id: string
  kind: Extract<JingleMemoryContextKind, "soul" | "rules" | "instruction_source">
  path: string
  scope: JingleMemoryScope
  sourceLabel: string
}

function listDefaultFileSources(workspacePath: string): FileContextSource[] {
  return [
    {
      id: "global:soul",
      kind: "soul",
      path: join(getJingleHomeDir(), "soul.md"),
      scope: "global",
      sourceLabel: "Global soul.md"
    },
    {
      id: "workspace:soul",
      kind: "soul",
      path: join(workspacePath, ".jingle", "soul.md"),
      scope: "workspace",
      sourceLabel: "Workspace soul.md"
    },
    {
      id: "global:agents",
      kind: "rules",
      path: join(getJingleHomeDir(), "AGENTS.md"),
      scope: "global",
      sourceLabel: "Global AGENTS.md"
    },
    {
      id: "workspace:agents",
      kind: "rules",
      path: join(workspacePath, ".jingle", "AGENTS.md"),
      scope: "workspace",
      sourceLabel: "Workspace AGENTS.md"
    }
  ]
}

function listFileSources(workspacePath: string): FileContextSource[] {
  return listDefaultFileSources(workspacePath)
}

interface JingleMemoryContextReadOptions {
  signal?: AbortSignal
}

async function readFileContextContent(
  path: string,
  options: JingleMemoryContextReadOptions
): Promise<{
  content: string | null
  error: string | null
  exists: boolean
}> {
  options.signal?.throwIfAborted()
  try {
    const content = (
      await readFile(path, {
        encoding: "utf8",
        signal: options.signal
      })
    )
      .slice(0, MAX_FILE_CONTENT_BYTES)
      .trim()
    options.signal?.throwIfAborted()
    return { content: content || null, error: null, exists: true }
  } catch (error) {
    options.signal?.throwIfAborted()
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { content: null, error: null, exists: false }
    }

    return {
      content: null,
      error: error instanceof Error ? error.message : String(error),
      exists: false
    }
  }
}

async function toFileContextItem(
  source: FileContextSource,
  options: JingleMemoryContextReadOptions
): Promise<{
  diagnostic: JingleMemoryContextDiagnostic | null
  item: JingleMemoryContextItem | null
}> {
  const result = await readFileContextContent(source.path, options)
  if (result.error) {
    return {
      diagnostic: {
        error: result.error,
        id: source.id,
        kind: source.kind,
        path: source.path,
        scope: source.scope,
        sourceLabel: source.sourceLabel
      },
      item: null
    }
  }

  if (!result.content) {
    return { diagnostic: null, item: null }
  }

  return {
    diagnostic: null,
    item: {
      content: result.content,
      id: source.id,
      kind: source.kind,
      scope: source.scope,
      sourceLabel: source.sourceLabel,
      sourceType: "file"
    }
  }
}

async function toContextSourceRecord(
  source: FileContextSource,
  options: JingleMemoryContextReadOptions
): Promise<JingleContextSourceRecord> {
  const result = await readFileContextContent(source.path, options)
  return {
    content: result.content,
    error: result.error,
    exists: result.exists,
    id: source.id,
    kind: source.kind,
    path: source.path,
    scope: source.scope,
    sourceLabel: source.sourceLabel
  }
}

export class JingleMemorySourceProvider {
  async listContextItems(
    workspacePath: string,
    options: JingleMemoryContextReadOptions = {}
  ): Promise<{
    diagnostics: JingleMemoryContextDiagnostic[]
    items: JingleMemoryContextItem[]
  }> {
    options.signal?.throwIfAborted()
    const results = await Promise.all(
      listFileSources(workspacePath).map((source) => toFileContextItem(source, options))
    )
    options.signal?.throwIfAborted()
    return {
      diagnostics: results.flatMap((result) => (result.diagnostic ? [result.diagnostic] : [])),
      items: results.flatMap((result) => (result.item ? [result.item] : []))
    }
  }

  async listContextSources(
    workspacePath: string,
    options: JingleMemoryContextReadOptions = {}
  ): Promise<JingleContextSourceRecord[]> {
    options.signal?.throwIfAborted()
    const sources = await Promise.all(
      listFileSources(workspacePath).map((source) => toContextSourceRecord(source, options))
    )
    options.signal?.throwIfAborted()
    return sources
  }
}
