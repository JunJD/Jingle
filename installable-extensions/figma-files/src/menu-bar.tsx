import {
  getConnectionSecret,
  getPreferenceValues,
  MenuBarExtra,
  openNativeExtensionSettings
} from "@jingle/extension-api"
import { useFigmaRuntimeCopy } from "./copy"
import { useFigmaData } from "./data"
import { openFigmaFile } from "./open"
import type { FigmaFile, FigmaFilesPreferences } from "./types"

function hasConfiguredTeamIds(preferences: FigmaFilesPreferences): boolean {
  return String(preferences.TEAM_ID ?? "")
    .split(",")
    .map((value) => value.trim())
    .some(Boolean)
}

function MenuBarFileItems(props: {
  files: FigmaFile[]
  onOpenFile: (file: FigmaFile) => Promise<void>
}): React.JSX.Element {
  return (
    <>
      {props.files.map((file) => (
        <MenuBarExtra.Item
          key={file.key}
          onAction={() => props.onOpenFile(file)}
          title={file.name || "Untitled"}
        />
      ))}
    </>
  )
}

export default function FigmaFilesMenuBar(): React.JSX.Element {
  const copy = useFigmaRuntimeCopy()
  const preferences = getPreferenceValues<FigmaFilesPreferences>()
  const hasAccessToken = Boolean(getConnectionSecret("accessToken"))
  const hasTeamIds = hasConfiguredTeamIds(preferences)
  const { allFiles, error, isLoading, starredFiles, visitFile, visitedFiles } = useFigmaData(
    hasAccessToken && hasTeamIds
  )

  async function handleOpenFile(file: FigmaFile): Promise<void> {
    await visitFile(file)
    await openFigmaFile(file, preferences.open_in)
  }

  return (
    <MenuBarExtra
      icon="assets/figma-menubar-icon-light.png"
      isLoading={isLoading}
      title="Figma"
      tooltip={copy.searchFigmaFiles}
    >
      {!hasAccessToken ? (
        <MenuBarExtra.Section title={copy.connectFigma}>
          <MenuBarExtra.Item
            onAction={() => {
              void openNativeExtensionSettings({})
            }}
            title={copy.connectFigmaInSettings}
          />
        </MenuBarExtra.Section>
      ) : !hasTeamIds ? (
        <MenuBarExtra.Section title={copy.configureTeamIds}>
          <MenuBarExtra.Item
            onAction={() => {
              void openNativeExtensionSettings({})
            }}
            title={copy.addTeamIds}
          />
        </MenuBarExtra.Section>
      ) : error ? (
        <MenuBarExtra.Section title={copy.failedToLoadFigmaFiles}>
          <MenuBarExtra.Item
            onAction={() => {
              void openNativeExtensionSettings({})
            }}
            title={copy.openExtensionSettings}
          />
        </MenuBarExtra.Section>
      ) : null}

      {starredFiles.length > 0 ? (
        <MenuBarExtra.Section title={copy.starredFiles}>
          <MenuBarFileItems files={starredFiles} onOpenFile={handleOpenFile} />
        </MenuBarExtra.Section>
      ) : null}

      {visitedFiles.length > 0 ? (
        <MenuBarExtra.Section title={copy.recentFiles}>
          <MenuBarFileItems files={visitedFiles} onOpenFile={handleOpenFile} />
        </MenuBarExtra.Section>
      ) : null}

      {allFiles.map((team) =>
        team.files.map((project) => (
          <MenuBarExtra.Section
            key={`${team.name}:${project.projectId}`}
            title={`${team.name} / ${project.name}`}
          >
            {project.files.length > 0 ? (
              <MenuBarFileItems files={project.files} onOpenFile={handleOpenFile} />
            ) : (
              <MenuBarExtra.Item disabled title={copy.emptyProject} />
            )}
          </MenuBarExtra.Section>
        ))
      )}
    </MenuBarExtra>
  )
}
