import { Action, ActionPanel, getConnectionSecret, getPreferenceValues, Icon, List, openNativeExtensionSettings, useCommandSeedQuery } from "@openwork/extension-api"
import { useMemo, useState } from "react"
import FileListItem from "./components/FileListItem"
import { useFigmaData } from "./data"
import {
  createProjectFilter,
  createTeamFilter,
  FILTER_TYPES,
  filterTeamsByName,
  filterToSpecificProject,
  parseFilterValue
} from "./lib/filterUtils"
import type { FigmaFilesPreferences, FigmaTeamFiles } from "./types"

function hasConfiguredTeamIds(preferences: FigmaFilesPreferences): boolean {
  return String(preferences.TEAM_ID ?? "")
    .split(",")
    .map((value) => value.trim())
    .some(Boolean)
}

function buildVisibleTeams(allFiles: FigmaTeamFiles[], selectedFilter: string): FigmaTeamFiles[] {
  const filter = parseFilterValue(selectedFilter)
  switch (filter.type) {
    case "team":
      return filter.teamName ? filterTeamsByName(allFiles, filter.teamName) : allFiles
    case "project":
      return filter.teamName && filter.projectName
        ? filterToSpecificProject(allFiles, filter.teamName, filter.projectName)
        : allFiles
    default:
      return allFiles
  }
}

function renderOpenSettingsAction(title: string): React.JSX.Element {
  return (
    <Action
      icon={Icon.BlankDocument}
      onAction={() => {
        void openNativeExtensionSettings({})
      }}
      title={title}
    />
  )
}

export default function FigmaFilesIndex(): React.JSX.Element {
  const preferences = getPreferenceValues<FigmaFilesPreferences>()
  const hasAccessToken = Boolean(getConnectionSecret("accessToken"))
  const hasTeamIds = hasConfiguredTeamIds(preferences)
  const seedQuery = useCommandSeedQuery()
  const [searchText, setSearchText] = useState(seedQuery)
  const [selectedFilter, setSelectedFilter] = useState<string>(FILTER_TYPES.ALL)
  const {
    allFiles,
    clearVisitedFiles,
    error,
    isLoading,
    revalidateAllFiles,
    starredFiles,
    starredLimit,
    toggleStar,
    visitFile,
    visitedFiles
  } = useFigmaData(hasAccessToken && hasTeamIds)

  const visibleTeams = useMemo(() => buildVisibleTeams(allFiles, selectedFilter), [allFiles, selectedFilter])
  const showPersonalSections = selectedFilter === FILTER_TYPES.ALL

  return (
    <List
      filtering={{ keepSectionOrder: true }}
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarAccessory={
        <List.Dropdown onChange={(value) => setSelectedFilter(value)} value={selectedFilter}>
          <List.Dropdown.Item title="All Files" value={FILTER_TYPES.ALL} />
          {allFiles.length > 1 ? (
            <List.Dropdown.Section title="Teams">
              {allFiles.map((team) => (
                <List.Dropdown.Item key={team.name} title={team.name} value={createTeamFilter(team.name)} />
              ))}
            </List.Dropdown.Section>
          ) : null}
          {allFiles.map((team) => (
            <List.Dropdown.Section key={team.name} title={team.name}>
              {team.files.map((project) => (
                <List.Dropdown.Item
                  key={`${team.name}:${project.projectId}`}
                  title={project.name}
                  value={createProjectFilter(team.name, project.name)}
                />
              ))}
            </List.Dropdown.Section>
          ))}
        </List.Dropdown>
      }
      searchBarPlaceholder="Search Figma files"
      searchText={searchText}
    >
      {!hasAccessToken ? (
        <List.EmptyView
          actions={<ActionPanel>{renderOpenSettingsAction("Add Figma Access Token")}</ActionPanel>}
          description="Figma File Search needs a personal access token before it can load files."
          title="Connect Figma"
        />
      ) : !hasTeamIds ? (
        <List.EmptyView
          actions={<ActionPanel>{renderOpenSettingsAction("Add Team IDs")}</ActionPanel>}
          description="Add one or more Figma team IDs in Settings to load team files."
          title="Configure Team IDs"
        />
      ) : error ? (
        <List.EmptyView
          actions={
            <ActionPanel>
              <Action
                icon={Icon.ArrowDownCircle}
                onAction={() => {
                  void revalidateAllFiles()
                }}
                title="Retry"
              />
              {renderOpenSettingsAction("Open Extension Settings")}
            </ActionPanel>
          }
          description={error.message}
          title="Failed to Load Figma Files"
        />
      ) : !isLoading && allFiles.length === 0 ? (
        <List.EmptyView title="No Figma Files Found" />
      ) : null}

      {showPersonalSections && starredFiles.length > 0 ? (
        <List.Section title="Starred Files">
          {starredFiles.map((file) => (
            <FileListItem
              clearRecentFiles={clearVisitedFiles}
              file={file}
              isStarred
              key={`starred:${file.key}`}
              onVisit={visitFile}
              projectName="Starred"
              reloadFiles={revalidateAllFiles}
              starredCount={starredFiles.length}
              starredLimit={starredLimit}
              teamName="Personal"
              toggleStar={toggleStar}
            />
          ))}
        </List.Section>
      ) : null}

      {showPersonalSections && visitedFiles.length > 0 ? (
        <List.Section title="Recent Files">
          {visitedFiles.map((file) => (
            <FileListItem
              clearRecentFiles={clearVisitedFiles}
              file={file}
              isStarred={starredFiles.some((item) => item.key === file.key)}
              key={`recent:${file.key}`}
              onVisit={visitFile}
              projectName="Recent"
              reloadFiles={revalidateAllFiles}
              starredCount={starredFiles.length}
              starredLimit={starredLimit}
              teamName="Personal"
              toggleStar={toggleStar}
            />
          ))}
        </List.Section>
      ) : null}

      {visibleTeams.map((team) =>
        team.files.map((project) => (
          <List.Section
            key={`${team.name}:${project.projectId}`}
            subtitle={team.name}
            title={project.files.length > 0 ? `${project.name} (${project.files.length})` : project.name}
          >
            {project.files.length > 0 ? (
              project.files.map((file) => (
                <FileListItem
                  clearRecentFiles={clearVisitedFiles}
                  file={file}
                  isStarred={starredFiles.some((item) => item.key === file.key)}
                  key={`${project.projectId}:${file.key}`}
                  onVisit={visitFile}
                  projectName={project.name}
                  reloadFiles={revalidateAllFiles}
                  starredCount={starredFiles.length}
                  starredLimit={starredLimit}
                  teamName={team.name}
                  toggleStar={toggleStar}
                />
              ))
            ) : (
              <List.Item
                icon="assets/emptyProject.svg"
                subtitle={team.name}
                title="Empty Project"
              />
            )}
          </List.Section>
        ))
      )}
    </List>
  )
}
