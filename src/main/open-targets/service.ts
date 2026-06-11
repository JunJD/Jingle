import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"
import { shell } from "electron"
import type {
  ListOpenTargetsRequest,
  ListOpenTargetsResponse,
  OpenTarget,
  OpenTargetRequest
} from "@shared/open-targets"
import type { LauncherSearchResult } from "@shared/launcher-search"
import {
  applicationsLauncherSearchProvider,
  getApplicationIconDataUrl
} from "../services/launcher-search/providers/applications"

interface MacApplicationTarget {
  id: string
  query: string
  label: string
  fallbackAppPath?: string
  openStrategy?: "cursor-cli" | "open-app"
}

const MAC_APPLICATION_TARGETS: MacApplicationTarget[] = [
  {
    id: "cursor",
    query: "cursor",
    label: "Cursor",
    fallbackAppPath: "/Applications/Cursor.app",
    openStrategy: "cursor-cli"
  },
  {
    id: "visual-studio-code",
    query: "visual studio code",
    label: "Visual Studio Code",
    fallbackAppPath: "/Applications/Visual Studio Code.app",
    openStrategy: "open-app"
  }
]

const MAC_SYSTEM_TARGETS: OpenTarget[] = [
  {
    id: "finder",
    kind: "file-manager",
    label: "Finder"
  },
  {
    id: "terminal",
    kind: "terminal",
    label: "Terminal",
    appPath: "/System/Applications/Utilities/Terminal.app"
  }
]

const MAC_TERMINAL_APP_PATH = "/System/Applications/Utilities/Terminal.app"
const MAC_FINDER_APP_PATH = "/System/Library/CoreServices/Finder.app"

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

function spawnDetached(command: string, args: string[]): Promise<void> {
  return spawnDetachedWithEnv(command, args)
}

function spawnDetachedWithEnv(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      env,
      stdio: "ignore"
    })

    child.once("error", reject)
    child.once("spawn", () => resolve())
    child.unref()
  })
}

async function openWithMacApplication(folderPath: string, appPath: string): Promise<void> {
  await spawnDetached("open", ["-a", appPath, folderPath])
}

async function openWithCursorCli(folderPath: string, appPath: string): Promise<void> {
  const electronBin = path.join(appPath, "Contents", "MacOS", "Cursor")
  const cliJs = path.join(appPath, "Contents", "Resources", "app", "out", "cli.js")
  if (!(await pathExists(electronBin)) || !(await pathExists(cliJs))) {
    await openWithMacApplication(folderPath, appPath)
    return
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    VSCODE_NODE_OPTIONS: process.env.NODE_OPTIONS,
    VSCODE_NODE_REPL_EXTERNAL_MODULE: process.env.NODE_REPL_EXTERNAL_MODULE
  }
  delete env.NODE_OPTIONS
  delete env.NODE_REPL_EXTERNAL_MODULE

  await spawnDetachedWithEnv(electronBin, [cliJs, folderPath], env)
}

async function openInMacTerminal(folderPath: string): Promise<void> {
  await spawnDetached("open", ["-a", "Terminal", folderPath])
}

async function openFolderInFileManager(folderPath: string): Promise<void> {
  if (process.env.OPENWORK_BDD === "1") {
    return
  }

  if (process.platform === "darwin") {
    await spawnDetached("open", [folderPath])
    return
  }

  const error = await shell.openPath(folderPath)
  if (error) {
    throw new Error(error)
  }
}

function getOpenPathApplicationPath(result: LauncherSearchResult): string | null {
  if (result.action.type !== "open-path" || result.action.target.kind !== "application") {
    return null
  }

  return result.action.target.path
}

async function findApplicationTarget(target: MacApplicationTarget): Promise<OpenTarget | null> {
  const searchResult = await applicationsLauncherSearchProvider.search({
    limit: 8,
    query: target.query
  })
  const matchedResult =
    searchResult.results.find((result) => result.title === target.label) ??
    searchResult.results.find(
      (result) => getOpenPathApplicationPath(result) === target.fallbackAppPath
    )
  const appPath = matchedResult
    ? getOpenPathApplicationPath(matchedResult)
    : (target.fallbackAppPath ?? null)

  if (!appPath || !(await pathExists(appPath))) {
    return null
  }

  return {
    appPath,
    iconDataUrl: matchedResult?.iconDataUrl ?? (await getApplicationIconDataUrl(appPath)),
    id: target.id,
    kind: "application",
    label: target.label
  }
}

async function buildMacTargets(): Promise<OpenTarget[]> {
  const applicationTargets: OpenTarget[] = []

  for (const target of MAC_APPLICATION_TARGETS) {
    const applicationTarget = await findApplicationTarget(target)
    if (applicationTarget) {
      applicationTargets.push(applicationTarget)
    }
  }

  const terminalIconDataUrl = await getApplicationIconDataUrl(MAC_TERMINAL_APP_PATH)

  return [
    ...applicationTargets,
    {
      ...MAC_SYSTEM_TARGETS[0],
      iconDataUrl: await getApplicationIconDataUrl(MAC_FINDER_APP_PATH)
    },
    {
      ...MAC_SYSTEM_TARGETS[1],
      iconDataUrl: terminalIconDataUrl
    }
  ]
}

function assertDirectoryPath(folderPath: string): string {
  const requestedPath = folderPath.trim()
  if (!requestedPath) {
    throw new Error("Missing folder path")
  }

  return path.resolve(requestedPath)
}

export class OpenTargetsService {
  async listTargets(request: ListOpenTargetsRequest): Promise<ListOpenTargetsResponse> {
    assertDirectoryPath(request.folderPath)

    if (process.platform === "darwin") {
      return {
        targets: await buildMacTargets()
      }
    }

    return {
      targets: [
        {
          id: "system",
          kind: "file-manager",
          label: "System"
        }
      ]
    }
  }

  async openTarget(request: OpenTargetRequest): Promise<void> {
    const folderPath = assertDirectoryPath(request.folderPath)

    if (process.env.OPENWORK_BDD === "1") {
      return
    }

    if (process.platform !== "darwin") {
      await openFolderInFileManager(folderPath)
      return
    }

    if (request.targetId === "finder") {
      await openFolderInFileManager(folderPath)
      return
    }

    if (request.targetId === "terminal") {
      await openInMacTerminal(folderPath)
      return
    }

    const applicationTarget = MAC_APPLICATION_TARGETS.find(
      (target) => target.id === request.targetId
    )
    if (!applicationTarget) {
      throw new Error(`Unsupported open target: ${request.targetId}`)
    }

    const discoveredTarget = await findApplicationTarget(applicationTarget)
    if (!discoveredTarget?.appPath) {
      throw new Error(`Open target is unavailable: ${request.targetId}`)
    }

    if (applicationTarget.openStrategy === "cursor-cli") {
      await openWithCursorCli(folderPath, discoveredTarget.appPath)
      return
    }

    await openWithMacApplication(folderPath, discoveredTarget.appPath)
  }
}
