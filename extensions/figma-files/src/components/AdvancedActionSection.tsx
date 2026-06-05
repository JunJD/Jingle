import { Action, ActionPanel, Icon, Toast, showToast } from "@openwork/extension-api"
import { clearFiles } from "../cache"
import { clearVisitedFiles } from "../lib/fileStorage"

function getErrorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined
}

export default function AdvancedActionSection(props: {
  clearRecentFiles: () => Promise<void>
  reloadFiles: () => Promise<unknown>
}) {
  async function handleReloadFiles(): Promise<void> {
    try {
      await clearFiles()
      await props.reloadFiles()
      await showToast({
        style: Toast.Style.Success,
        title: "Reloaded Figma Files"
      })
    } catch (error) {
      await showToast({
        message: getErrorMessage(error),
        style: Toast.Style.Failure,
        title: "Failed to Reload Files"
      })
    }
  }

  async function handleClearVisited(): Promise<void> {
    try {
      await clearVisitedFiles()
      await props.clearRecentFiles()
      await showToast({
        style: Toast.Style.Success,
        title: "Cleared Recent Files"
      })
    } catch (error) {
      await showToast({
        message: getErrorMessage(error),
        style: Toast.Style.Failure,
        title: "Failed to Clear Recent Files"
      })
    }
  }

  return (
    <ActionPanel.Section title="Maintenance">
      <Action
        icon={Icon.ArrowDownCircle}
        onAction={() => {
          void handleReloadFiles()
        }}
        title="Reload Files"
      />
      <Action
        icon={Icon.Trash}
        onAction={() => {
          void handleClearVisited()
        }}
        title="Clear Recent Files"
      />
    </ActionPanel.Section>
  )
}
