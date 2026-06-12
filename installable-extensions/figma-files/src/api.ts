import { getPreferenceValues } from "@openwork/extension-api"
import { getProjectsNeedingRefresh, loadFiles, loadPages, storeFiles, storePages, updateProjectTTLs } from "./cache"
import { getFigmaAccessToken } from "./oauth"
import type {
  FigmaFile,
  FigmaFileDetail,
  FigmaFilesPreferences,
  FigmaNode,
  FigmaProject,
  FigmaProjectFiles,
  FigmaTeamFiles,
  FigmaTeamProjects
} from "./types"

interface RequestError extends Error {
  response?: Response
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retryOptions: { maxRetries?: number } = {}
): Promise<T> {
  const token = getFigmaAccessToken()
  const maxRetries = retryOptions.maxRetries ?? 2
  let attempt = 0

  while (true) {
    const response = await fetch(`https://api.figma.com/v1${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options.headers
      }
    })

    if (response.ok) {
      return (await response.json()) as T
    }

    if (response.status === 429 && attempt < maxRetries) {
      attempt += 1
      const retryAfterSeconds = Number(response.headers.get("retry-after")) || Math.min(2 ** attempt, 60)
      await sleep(retryAfterSeconds * 1000)
      continue
    }

    const error: RequestError = new Error(
      response.status === 403
        ? "Figma rejected the connection. Reconnect Figma in Settings and try again."
        : `Figma request failed with ${response.status} ${response.statusText}.`
    )
    error.response = response
    throw error
  }
}

function readTeamIds(): string[] {
  return String(getPreferenceValues<FigmaFilesPreferences>().TEAM_ID ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
}

async function fetchTeamProjects(): Promise<FigmaTeamProjects[]> {
  const teamIds = readTeamIds()
  if (teamIds.length === 0) {
    return []
  }

  return Promise.all(
    teamIds.map((teamId) =>
      request<FigmaTeamProjects>(`/teams/${teamId}/projects`, {
        method: "GET"
      })
    )
  )
}

async function fetchProjectFiles(project: FigmaProject): Promise<FigmaProjectFiles> {
  const result = await request<{ files?: FigmaFile[] }>(`/projects/${project.id}/files?branch_data=true`, {
    method: "GET"
  })
  await updateProjectTTLs([project.id])
  return {
    files: result.files ?? [],
    name: project.name,
    projectId: project.id
  }
}

export async function resolveAllFiles(): Promise<FigmaTeamFiles[]> {
  const teams = await fetchTeamProjects()
  if (teams.length === 0) {
    return []
  }

  const cachedTeams = (await loadFiles()) ?? []
  const cachedProjects = new Map<string, FigmaProjectFiles>()
  for (const team of cachedTeams) {
    for (const project of team.files) {
      cachedProjects.set(project.projectId, project)
    }
  }

  const allProjectIds = teams.flatMap((team) => team.projects.map((project) => project.id))
  const refreshIds = cachedProjects.size === 0 ? allProjectIds : await getProjectsNeedingRefresh(allProjectIds)
  const refreshIdSet = new Set(refreshIds)

  const nextTeams = await Promise.all(
    teams.map(async (team) => ({
      files: await Promise.all(
        team.projects.map(async (project) => {
          const cached = cachedProjects.get(project.id)
          if (!refreshIdSet.has(project.id) && cached) {
            return cached
          }

          return fetchProjectFiles(project)
        })
      ),
      name: team.name
    }))
  )

  await storeFiles(nextTeams)
  return nextTeams
}

export async function fetchPages(fileKey: string, lastModified: string): Promise<FigmaNode[]> {
  const cached = await loadPages(fileKey, lastModified)
  if (cached) {
    return cached
  }

  const result = await request<FigmaFileDetail>(`/files/${fileKey}?depth=1`, {
    method: "GET"
  })
  const pages = result.document.children ?? []
  await storePages(fileKey, lastModified, pages)
  return pages
}
