import { Action, ActionPanel, Icon, Toast, showToast } from "@openwork/extension-api"
import { clearFiles } from "../cache"
import { useFigmaRuntimeCopy } from "../copy"
import { clearVisitedFiles } from "../lib/fileStorage"

function getErrorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined
}

export default function AdvancedActionSection(props: {
  clearRecentFiles: () => Promise<void>
  reloadFiles: () => Promise<unknown>
}) {
  const copy = useFigmaRuntimeCopy()
  async function handleReloadFiles(): Promise<void> {
    try {
      await clearFiles()
      await props.reloadFiles()
      await showToast({
        style: Toast.Style.Success,
        title: copy.reloadedFigmaFiles
      })
    } catch (error) {
      await showToast({
        message: getErrorMessage(error),
        style: Toast.Style.Failure,
        title: copy.failedToReloadFiles
      })
    }
  }

  async function handleClearVisited(): Promise<void> {
    try {
      await clearVisitedFiles()
      await props.clearRecentFiles()
      await showToast({
        style: Toast.Style.Success,
        title: copy.clearedRecentFiles
      })
    } catch (error) {
      await showToast({
        message: getErrorMessage(error),
        style: Toast.Style.Failure,
        title: copy.failedToClearRecentFiles
      })
    }
  }

  return (
    <ActionPanel.Section title={copy.maintenance}>
      <Action
        icon={Icon.ArrowDownCircle}
        onAction={() => {
          void handleReloadFiles()
        }}
        title={copy.reloadFiles}
      />
      <Action
        icon={Icon.Trash}
        onAction={() => {
          void handleClearVisited()
        }}
        title={copy.clearRecentFiles}
      />
    </ActionPanel.Section>
  )
}
