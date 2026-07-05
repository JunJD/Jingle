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
  knownAppPath?: string
  openStrategy?: "cursor-cli" | "open-app"
}

const MAC_APPLICATION_TARGETS: MacApplicationTarget[] = [
  {
    id: "cursor",
    query: "cursor",
    label: "Cursor",
    knownAppPath: "/Applications/Cursor.app",
    openStrategy: "cursor-cli"
  },
  {
    id: "visual-studio-code",
    query: "visual studio code",
    label: "Visual Studio Code",
    knownAppPath: "/Applications/Visual Studio Code.app",
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

async function openWithMacApplication(targetPath: string, appPath: string): Promise<void> {
  await spawnDetached("open", ["-a", appPath, targetPath])
}

async function openWithCursorCli(targetPath: string, appPath: string): Promise<void> {
  const electronBin = path.join(appPath, "Contents", "MacOS", "Cursor")
  const cliJs = path.join(appPath, "Contents", "Resources", "app", "out", "cli.js")
  if (!(await pathExists(electronBin)) || !(await pathExists(cliJs))) {
    await openWithMacApplication(targetPath, appPath)
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

  await spawnDetachedWithEnv(electronBin, [cliJs, targetPath], env)
}

async function openInMacTerminal(folderPath: string): Promise<void> {
  await spawnDetached("open", ["-a", "Terminal", folderPath])
}

async function openFolderInFileManager(folderPath: string): Promise<void> {
  if (process.env.JINGLE_BDD === "1") {
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

async function revealPathInMacFileManager(targetPath: string): Promise<void> {
  await spawnDetached("open", ["-R", targetPath])
}

function getOpenPathApplicationPath(result: LauncherSearchResult): string | null {
  if (result.action.type !== "open-path" || result.action.target.kind !== "application") {
    return null
  }

  return result.action.target.path
}

function findMatchedApplicationResult(
  target: MacApplicationTarget,
  results: LauncherSearchResult[]
): LauncherSearchResult | undefined {
  const titleMatch = results.find((result) => result.title === target.label)
  if (titleMatch) {
    return titleMatch
  }

  if (!target.knownAppPath) {
    return undefined
  }

  return results.find((result) => getOpenPathApplicationPath(result) === target.knownAppPath)
}

function resolveMacApplicationTargetPath(
  target: MacApplicationTarget,
  matchedResult: LauncherSearchResult | undefined
): string | null {
  if (matchedResult) {
    return getOpenPathApplicationPath(matchedResult)
  }

  if (target.knownAppPath) {
    return target.knownAppPath
  }

  return null
}

async function resolveMacApplicationTargetIconDataUrl(
  appPath: string,
  matchedResult: LauncherSearchResult | undefined
): Promise<string | undefined> {
  if (matchedResult && matchedResult.iconDataUrl) {
    return matchedResult.iconDataUrl
  }

  return getApplicationIconDataUrl(appPath)
}

async function findApplicationTarget(target: MacApplicationTarget): Promise<OpenTarget | null> {
  const searchResult = await applicationsLauncherSearchProvider.search({
    limit: 8,
    query: target.query
  })
  const matchedResult = findMatchedApplicationResult(target, searchResult.results)
  const appPath = resolveMacApplicationTargetPath(target, matchedResult)

  if (!appPath || !(await pathExists(appPath))) {
    return null
  }

  return {
    appPath,
    iconDataUrl: await resolveMacApplicationTargetIconDataUrl(appPath, matchedResult),
    id: target.id,
    kind: "application",
    label: target.label
  }
}

async function buildMacTargets(): Promise<OpenTarget[]> {
  const [applicationTargets, finderIconDataUrl, terminalIconDataUrl] = await Promise.all([
    Promise.all(MAC_APPLICATION_TARGETS.map(findApplicationTarget)).then((targets) =>
      targets.filter((target): target is OpenTarget => target !== null)
    ),
    getApplicationIconDataUrl(MAC_FINDER_APP_PATH),
    getApplicationIconDataUrl(MAC_TERMINAL_APP_PATH)
  ])

  return [
    ...applicationTargets,
    {
      ...MAC_SYSTEM_TARGETS[0],
      iconDataUrl: finderIconDataUrl
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

function resolveTargetPath(folderPath: string, filePath: string | undefined): string {
  if (filePath === undefined) {
    return folderPath
  }

  const requestedPath = filePath.trim()
  if (!requestedPath) {
    throw new Error("Missing file path")
  }

  if (path.isAbsolute(requestedPath)) {
    return path.resolve(requestedPath)
  }

  return path.resolve(folderPath, requestedPath)
}

function resolveTargetFolderPath(folderPath: string, filePath: string | undefined): string {
  if (!filePath) {
    return folderPath
  }

  return path.dirname(resolveTargetPath(folderPath, filePath))
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
    const targetPath = resolveTargetPath(folderPath, request.filePath)
    const targetFolderPath = resolveTargetFolderPath(folderPath, request.filePath)

    if (process.env.JINGLE_BDD === "1") {
      return
    }

    if (process.platform !== "darwin") {
      await openFolderInFileManager(targetFolderPath)
      return
    }

    if (request.targetId === "finder") {
      if (request.filePath) {
        await revealPathInMacFileManager(targetPath)
      } else {
        await openFolderInFileManager(folderPath)
      }
      return
    }

    if (request.targetId === "terminal") {
      await openInMacTerminal(targetFolderPath)
      return
    }

    const applicationTarget = MAC_APPLICATION_TARGETS.find(
      (target) => target.id === request.targetId
    )
    if (!applicationTarget) {
      throw new Error(`Unsupported open target: ${request.targetId}`)
    }

    const discoveredTarget = await findApplicationTarget(applicationTarget)
    if (!discoveredTarget || !discoveredTarget.appPath) {
      throw new Error(`Open target is unavailable: ${request.targetId}`)
    }

    if (applicationTarget.openStrategy === "cursor-cli") {
      await openWithCursorCli(targetPath, discoveredTarget.appPath)
      return
    }

    await openWithMacApplication(targetPath, discoveredTarget.appPath)
  }
}
