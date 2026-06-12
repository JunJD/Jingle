import type { RuntimeOpenApplication } from "@openwork/extension-api"
import { closeMainWindow, open } from "@openwork/extension-api"
import type { FigmaBranch, FigmaFile, FigmaNode } from "./types"

const FIGMA_APP_BUNDLE_ID = "com.figma.Desktop"

export function isFigmaApp(app?: RuntimeOpenApplication): boolean {
  if (!app) {
    return false
  }

  return app.bundleId === FIGMA_APP_BUNDLE_ID || app.name?.toLowerCase() === "figma"
}

export function fileBrowserUrl(fileKey: string): string {
  return `https://www.figma.com/file/${fileKey}`
}

export function branchBrowserUrl(fileKey: string, branchKey: string): string {
  return `${fileBrowserUrl(fileKey)}/branch/${branchKey}`
}

export function pageBrowserUrl(fileKey: string, nodeId: string): string {
  return `${fileBrowserUrl(fileKey)}?node-id=${encodeURIComponent(nodeId)}`
}

function fileAppUrl(fileKey: string): string {
  return `figma://file/${fileKey}`
}

function branchAppUrl(fileKey: string, branchKey: string): string {
  return `figma://file/${fileKey}/branch/${branchKey}`
}

function pageAppUrl(fileKey: string, nodeId: string): string {
  return `figma://file/${fileKey}?node-id=${encodeURIComponent(nodeId)}`
}

async function openPreferredUrl(params: {
  appUrl: string
  browserUrl: string
  openIn?: RuntimeOpenApplication
}): Promise<void> {
  const target = isFigmaApp(params.openIn) ? params.appUrl : params.browserUrl

  try {
    await open(target, params.openIn)
  } catch {
    await open(target)
  }

  await closeMainWindow()
}

export async function openFigmaFile(
  file: FigmaFile,
  openIn?: RuntimeOpenApplication
): Promise<void> {
  await openPreferredUrl({
    appUrl: fileAppUrl(file.key),
    browserUrl: fileBrowserUrl(file.key),
    openIn
  })
}

export async function openFigmaBranch(
  file: FigmaFile,
  branch: FigmaBranch,
  openIn?: RuntimeOpenApplication
): Promise<void> {
  await openPreferredUrl({
    appUrl: branchAppUrl(file.key, branch.key),
    browserUrl: branchBrowserUrl(file.key, branch.key),
    openIn
  })
}

export async function openFigmaPage(
  file: FigmaFile,
  node: FigmaNode,
  openIn?: RuntimeOpenApplication
): Promise<void> {
  await openPreferredUrl({
    appUrl: pageAppUrl(file.key, node.id),
    browserUrl: pageBrowserUrl(file.key, node.id),
    openIn
  })
}
