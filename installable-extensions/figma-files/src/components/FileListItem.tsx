import {
  Action,
  ActionPanel,
  getPreferenceValues,
  Icon,
  Keyboard,
  List
} from "@jingle/extension-api"
import { useMemo } from "react"
import { useFigmaRuntimeCopy } from "../copy"
import { openFigmaBranch, openFigmaFile, fileBrowserUrl } from "../open"
import type { FigmaBranch, FigmaFile, FigmaFilesPreferences } from "../types"
import AdvancedActionSection from "./AdvancedActionSection"
import FilePagesList from "./FilePagesList"

function formatRelativeEditTime(value: string): string {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return "Edited recently"
  }

  const diffMs = Date.now() - timestamp
  const minutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(diffMs / 3600000)
  const days = Math.floor(diffMs / 86400000)

  if (minutes < 1) {
    return "Edited just now"
  }
  if (minutes < 60) {
    return `Edited ${minutes}m ago`
  }
  if (hours < 24) {
    return `Edited ${hours}h ago`
  }
  if (days < 30) {
    return `Edited ${days}d ago`
  }

  return `Edited ${new Date(timestamp).toLocaleDateString()}`
}

function createBranchActions(params: {
  branches: FigmaBranch[]
  file: FigmaFile
  openIn: FigmaFilesPreferences["open_in"]
}): React.JSX.Element | null {
  if (params.branches.length === 0) {
    return null
  }

  return (
    <ActionPanel.Submenu
      icon="branch.svg"
      shortcut={{
        macOS: { key: "b", modifiers: ["cmd"] },
        Windows: { key: "b", modifiers: ["ctrl"] }
      }}
      title="Open Branch"
    >
      {params.branches.map((branch) => (
        <Action
          key={branch.key}
          icon="branch.svg"
          onAction={() => openFigmaBranch(params.file, branch, params.openIn)}
          title={branch.name}
        />
      ))}
    </ActionPanel.Submenu>
  )
}

export default function FileListItem(props: {
  clearRecentFiles: () => Promise<void>
  file: FigmaFile
  isStarred: boolean
  onVisit: (file: FigmaFile) => Promise<void>
  projectName: string
  reloadFiles: () => Promise<unknown>
  starredCount: number
  starredLimit: number
  teamName: string
  toggleStar: (file: FigmaFile) => Promise<void>
}): React.JSX.Element {
  const copy = useFigmaRuntimeCopy()
  const preferences = getPreferenceValues<FigmaFilesPreferences>()
  const accessories: List.Item.Accessory[] = [
    {
      text: formatRelativeEditTime(props.file.last_modified)
    }
  ]

  if (props.file.branches.length > 0) {
    accessories.push({
      tag: {
        value: `${props.file.branches.length} branch${props.file.branches.length === 1 ? "" : "es"}`
      }
    })
  }

  const starActionTitle = props.isStarred ? copy.removeFromStarredFiles : copy.addToStarredFiles
  const starredLimitReached = !props.isStarred && props.starredCount >= props.starredLimit
  const pagesTarget = useMemo(
    () => <FilePagesList file={props.file} onVisit={props.onVisit} />,
    [props.file, props.onVisit]
  )

  return (
    <List.Item
      accessories={accessories}
      icon={props.file.thumbnail_url || "assets/command-icon.png"}
      keywords={[
        props.teamName,
        props.projectName,
        props.file.name,
        ...props.file.branches.map((branch) => branch.name)
      ]}
      subtitle={`${props.teamName} / ${props.projectName}`}
      title={props.file.name}
      actions={
        <ActionPanel>
          <ActionPanel.Section title={props.file.name}>
            <Action
              icon={Icon.ArrowNe}
              onAction={async () => {
                await props.onVisit(props.file)
                await openFigmaFile(props.file, preferences.open_in)
              }}
              title={copy.openFile}
            />
            <Action.CopyToClipboard
              content={fileBrowserUrl(props.file.key)}
              shortcut={Keyboard.Shortcut.Common.Copy}
              title={copy.copyFileLink}
            />
            <Action
              disabled={starredLimitReached}
              icon={props.isStarred ? Icon.PinDisabled : Icon.Pin}
              onAction={() => props.toggleStar(props.file)}
              title={starredLimitReached ? copy.starredFilesLimitReached : starActionTitle}
            />
            <Action.Push icon={Icon.BlankDocument} title={copy.browsePages} target={pagesTarget} />
            {createBranchActions({
              branches: props.file.branches,
              file: props.file,
              openIn: preferences.open_in
            })}
          </ActionPanel.Section>

          <AdvancedActionSection
            clearRecentFiles={props.clearRecentFiles}
            reloadFiles={props.reloadFiles}
          />
        </ActionPanel>
      }
    />
  )
}
