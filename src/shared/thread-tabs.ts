export interface OpenFile {
  path: string
  name: string
}

export interface OpenArtifactTab {
  artifactId: string
}

export function getArtifactTabId(artifactId: string): string {
  return `artifact:${artifactId}`
}

export function getFileTabId(filePath: string): string {
  return `file:${encodeURIComponent(filePath)}`
}

export function getVisibleContentTabIds(
  openFiles: OpenFile[],
  openArtifacts: OpenArtifactTab[]
): string[] {
  return [
    ...openFiles.map((file) => getFileTabId(file.path)),
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
