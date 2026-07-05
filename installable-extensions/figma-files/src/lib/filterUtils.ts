import type { FigmaTeamFiles } from "../types"

export const FILTER_TYPES = {
  ALL: "all",
  PROJECT: "project",
  TEAM: "team"
} as const

export const SEPARATORS = {
  KEY_VALUE: "=",
  TEAM_PROJECT: "&$%"
} as const

export function createTeamFilter(teamName: string): string {
  return `${FILTER_TYPES.TEAM}${SEPARATORS.KEY_VALUE}${teamName}`
}

export function createProjectFilter(teamName: string, projectName: string): string {
  return `${teamName}${SEPARATORS.TEAM_PROJECT}${projectName}`
}

export function parseFilterValue(value: string): {
  projectName?: string
  teamName?: string
  type: "all" | "project" | "team"
} {
  if (value === FILTER_TYPES.ALL) {
    return { type: "all" }
  }

  if (value.includes(SEPARATORS.KEY_VALUE)) {
    const [prefix, teamName] = value.split(SEPARATORS.KEY_VALUE)
    if (prefix === FILTER_TYPES.TEAM) {
      return { teamName, type: "team" }
    }
  }

  if (value.includes(SEPARATORS.TEAM_PROJECT)) {
    const [teamName, projectName] = value.split(SEPARATORS.TEAM_PROJECT)
    return { projectName, teamName, type: "project" }
  }

  return { type: "all" }
}

export function filterTeamsByName(teams: FigmaTeamFiles[], teamName: string): FigmaTeamFiles[] {
  return teams.filter((team) => team.name === teamName)
}

export function filterToSpecificProject(
  teams: FigmaTeamFiles[],
  teamName: string,
  projectName: string
): FigmaTeamFiles[] {
  const team = teams.find((value) => value.name === teamName)
  if (!team) {
    return []
  }

  const project = team.files.find((value) => value.name === projectName)
  if (!project) {
    return []
  }

  return [
    {
      files: [project],
      name: teamName
    }
  ]
}
