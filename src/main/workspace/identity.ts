import { execFile } from "child_process"
import { realpath } from "fs/promises"
import { basename, resolve } from "path"
import { promisify } from "util"
import type { JingleWorkspaceIdentity } from "@shared/jingle-memory"

const execFileAsync = promisify(execFile)

interface ResolveJingleWorkspaceIdentityOptions {
  signal?: AbortSignal
}

async function resolveCanonicalWorkspacePath(
  workspacePath: string,
  options: ResolveJingleWorkspaceIdentityOptions
): Promise<string> {
  const resolved = resolve(workspacePath)
  options.signal?.throwIfAborted()

  try {
    const canonicalPath = await realpath(resolved)
    options.signal?.throwIfAborted()
    return canonicalPath
  } catch {
    options.signal?.throwIfAborted()
    return resolved
  }
}

async function resolveGitRoot(
  workspacePath: string,
  options: ResolveJingleWorkspaceIdentityOptions
): Promise<string | null> {
  options.signal?.throwIfAborted()
  try {
    const result = await execFileAsync(
      "git",
      ["-C", workspacePath, "rev-parse", "--show-toplevel"],
      {
        signal: options.signal,
        timeout: 2_000
      }
    )
    options.signal?.throwIfAborted()
    const gitRoot = result.stdout.trim()
    return gitRoot.length > 0 ? gitRoot : null
  } catch {
    options.signal?.throwIfAborted()
    return null
  }
}

export async function resolveJingleWorkspaceIdentity(
  workspacePath: string,
  options: ResolveJingleWorkspaceIdentityOptions = {}
): Promise<JingleWorkspaceIdentity> {
  options.signal?.throwIfAborted()
  const canonicalWorkspacePath = await resolveCanonicalWorkspacePath(workspacePath, options)
  const gitRoot = await resolveGitRoot(canonicalWorkspacePath, options)
  options.signal?.throwIfAborted()

  return {
    canonicalWorkspacePath,
    displayName: basename(canonicalWorkspacePath) || canonicalWorkspacePath,
    ...(gitRoot ? { gitRoot, worktreeRoot: gitRoot } : {}),
    workspaceKey: canonicalWorkspacePath
  }
}
