import { execFile } from "child_process"
import { realpath } from "fs/promises"
import { basename, resolve } from "path"
import { promisify } from "util"
import type { JingleWorkspaceIdentity } from "@shared/jingle-memory"

const execFileAsync = promisify(execFile)

async function resolveCanonicalWorkspacePath(workspacePath: string): Promise<string> {
  const resolved = resolve(workspacePath)

  try {
    return await realpath(resolved)
  } catch {
    return resolved
  }
}

async function resolveGitRoot(workspacePath: string): Promise<string | null> {
  try {
    const result = await execFileAsync("git", ["-C", workspacePath, "rev-parse", "--show-toplevel"], {
      timeout: 2_000
    })
    const gitRoot = result.stdout.trim()
    return gitRoot.length > 0 ? gitRoot : null
  } catch {
    return null
  }
}

export async function resolveJingleWorkspaceIdentity(
  workspacePath: string
): Promise<JingleWorkspaceIdentity> {
  const canonicalWorkspacePath = await resolveCanonicalWorkspacePath(workspacePath)
  const gitRoot = await resolveGitRoot(canonicalWorkspacePath)

  return {
    canonicalWorkspacePath,
    displayName: basename(canonicalWorkspacePath) || canonicalWorkspacePath,
    ...(gitRoot ? { gitRoot, worktreeRoot: gitRoot } : {}),
    workspaceKey: canonicalWorkspacePath
  }
}
