import type { ArtifactRecord } from "./artifacts"

export interface OpenFile {
  path: string
  name: string
}

export interface OpenArtifactTab {
  artifactId: string
  kind: ArtifactRecord["kind"]
  title: string
}

export function getArtifactTabId(artifactId: string): string {
  return `artifact:${artifactId}`
}

export function getVisibleContentTabIds(
  openFiles: OpenFile[],
  openArtifacts: OpenArtifactTab[]
): string[] {
  return [
    ...openFiles.map((file) => file.path),
    ...openArtifacts.map((artifact) => getArtifactTabId(artifact.artifactId))
  ]
}

export function getNextActiveTabAfterClose(props: {
  activeTab: "agent" | string
  closedTabId: string
  openFiles: OpenFile[]
  openArtifacts: OpenArtifactTab[]
}): "agent" | string {
  const { activeTab, closedTabId, openFiles, openArtifacts } = props

  if (activeTab !== closedTabId) {
    return activeTab
  }

  const visibleTabIds = getVisibleContentTabIds(openFiles, openArtifacts)
  const closedIndex = visibleTabIds.findIndex((tabId) => tabId === closedTabId)
  const nextVisibleTabIds = visibleTabIds.filter((tabId) => tabId !== closedTabId)

  return nextVisibleTabIds[Math.max(0, closedIndex - 1)] ?? nextVisibleTabIds[0] ?? "agent"
}

export function syncOpenArtifactTabs(
  openArtifacts: OpenArtifactTab[],
  artifacts: ArtifactRecord[]
): OpenArtifactTab[] {
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
  let hasChanges = false

  const nextOpenArtifacts = openArtifacts.map((tab) => {
    const artifact = artifactsById.get(tab.artifactId)

    if (!artifact) {
      return tab
    }

    if (artifact.kind === tab.kind && artifact.title === tab.title) {
      return tab
    }

    hasChanges = true

    return {
      artifactId: tab.artifactId,
      kind: artifact.kind,
      title: artifact.title
    }
  })

  return hasChanges ? nextOpenArtifacts : openArtifacts
}
