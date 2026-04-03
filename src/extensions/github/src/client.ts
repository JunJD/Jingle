import { throttling } from "@octokit/plugin-throttling"
import { Octokit } from "@octokit/rest"
import { useNativeCommandPreferences } from "../../api"

export interface GitHubExtensionPreferences {
  accessToken: string
  apiBaseUrl: string
  defaultSearchTerms: string
  numberOfResults: number | string
}

export interface GitHubIssueListPreferences {
  showAssigned: boolean
  showCreated: boolean
  showMentioned: boolean
  showRecentlyClosed: boolean
}

export interface GitHubPullRequestListPreferences {
  includeAssigned: boolean
  includeDrafts: boolean
  includeMentioned: boolean
  includeRecentlyClosed: boolean
  includeReviewed: boolean
  includeReviewRequests: boolean
}

export interface GitHubSearchRepositoriesPreferences {
  displayOwnerName: boolean
  includeArchived: boolean
  includeForks: boolean
}

export interface GitHubResolvedPreferences {
  accessToken: string
  apiBaseUrl: string
  defaultSearchTerms: string
  numberOfResults: number
}

export interface GitHubViewer {
  avatarUrl: string
  login: string
}

export interface GitHubIssueLike {
  comments: number
  id: number
  isDraft: boolean
  kind: "issue" | "pull_request"
  number: number
  repositoryName: string
  state: "closed" | "open"
  title: string
  updatedAt: string
  url: string
}

export interface GitHubRepository {
  description: string
  forks: number
  fullName: string
  id: number
  isArchived: boolean
  isFork: boolean
  isPrivate: boolean
  language: string | null
  ownerAvatarUrl: string
  ownerLogin: string
  stars: number
  updatedAt: string
  url: string
}

interface GitHubSearchIssuesResponse {
  items?: Array<{
    comments?: number
    draft?: boolean
    html_url?: string
    id?: number
    number?: number
    pull_request?: object
    repository_url?: string
    state?: "closed" | "open"
    title?: string
    updated_at?: string
  }>
  message?: string
}

interface GitHubSearchRepositoriesResponse {
  items?: GitHubRepositoryResponseItem[]
  message?: string
}

interface GitHubRepositoryResponseItem {
  archived?: boolean
  description?: string | null
  fork?: boolean
  forks_count?: number
  full_name?: string
  html_url?: string
  id?: number
  language?: string | null
  owner?: {
    avatar_url?: string
    login?: string
  }
  private?: boolean
  stargazers_count?: number
  updated_at?: string
}

interface GitHubViewerResponse {
  avatar_url?: string
  login?: string
  message?: string
}

const ThrottledOctokit = Octokit.plugin(throttling)

type ThrottledOctokitInstance = InstanceType<typeof ThrottledOctokit>

const octokitByAuthKey = new Map<string, ThrottledOctokitInstance>()

export function useGitHubCommandPreferences<T extends object>() {
  return useNativeCommandPreferences<GitHubExtensionPreferences & T>()
}

export function normalizeGitHubPreferences(
  preferences: GitHubExtensionPreferences
): GitHubResolvedPreferences {
  return {
    accessToken: preferences.accessToken.trim(),
    apiBaseUrl: normalizeGitHubApiBaseUrl(preferences.apiBaseUrl),
    defaultSearchTerms: preferences.defaultSearchTerms.trim(),
    numberOfResults: normalizeNumberOfResults(preferences.numberOfResults)
  }
}

export function openGitHubSettings(commandName: string): Promise<void> {
  return window.api.settings.openTab({
    tab: "extensions",
    target: {
      commandName,
      extensionName: "github"
    }
  })
}

function normalizeGitHubApiBaseUrl(value?: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    return "https://api.github.com"
  }

  return trimmed.replace(/\/+$/, "")
}

function normalizeNumberOfResults(value: number | string): number {
  const numericValue = typeof value === "number" ? value : Number.parseInt(value, 10)
  if (!Number.isFinite(numericValue)) {
    return 25
  }

  return Math.max(1, Math.min(100, Math.round(numericValue)))
}

function parseRepositoryName(repositoryApiUrl?: string): string {
  if (!repositoryApiUrl) {
    return "Unknown Repository"
  }

  const match = repositoryApiUrl.match(/\/repos\/(.+)$/)
  return match?.[1] ?? repositoryApiUrl
}

async function fetchGitHubJson<T>(
  preferences: GitHubResolvedPreferences,
  route: string,
  parameters: Record<string, unknown> = {}
): Promise<T> {
  const authKey = `${preferences.apiBaseUrl}:${preferences.accessToken}`
  let octokit = octokitByAuthKey.get(authKey)

  if (!octokit) {
    octokit = new ThrottledOctokit({
      auth: preferences.accessToken,
      baseUrl: preferences.apiBaseUrl,
      throttle: {
        onRateLimit: (retryAfter, options, _client, retryCount) => {
          console.warn(
            `[GitHub] Rate limit for ${options.method} ${options.url}; retry ${retryCount + 1} after ${retryAfter}s`
          )

          if (retryCount < 1) {
            return true
          }

          return false
        },
        onSecondaryRateLimit: (retryAfter, options, _client, retryCount) => {
          console.warn(
            `[GitHub] Secondary rate limit for ${options.method} ${options.url}; retry ${retryCount + 1} after ${retryAfter}s`
          )

          if (retryCount < 1) {
            return true
          }

          return false
        }
      }
    })

    octokitByAuthKey.set(authKey, octokit)
  }

  const response = await octokit.request(route, parameters)
  return response.data as T
}

function isIssueLikeItem(
  item: NonNullable<GitHubSearchIssuesResponse["items"]>[number] | undefined
): item is Required<
  Pick<
    NonNullable<GitHubSearchIssuesResponse["items"]>[number],
    "html_url" | "id" | "number" | "state" | "title" | "updated_at"
  >
> &
  NonNullable<GitHubSearchIssuesResponse["items"]>[number] {
  return (
    typeof item?.id === "number" &&
    typeof item.number === "number" &&
    typeof item.title === "string" &&
    typeof item.html_url === "string" &&
    typeof item.updated_at === "string" &&
    (item.state === "open" || item.state === "closed")
  )
}

function toIssueLike(
  item: Required<
    Pick<
      NonNullable<GitHubSearchIssuesResponse["items"]>[number],
      "html_url" | "id" | "number" | "state" | "title" | "updated_at"
    >
  > &
    NonNullable<GitHubSearchIssuesResponse["items"]>[number]
): GitHubIssueLike {
  return {
    comments: item.comments ?? 0,
    id: item.id,
    isDraft: item.draft === true,
    kind: item.pull_request ? "pull_request" : "issue",
    number: item.number,
    repositoryName: parseRepositoryName(item.repository_url),
    state: item.state,
    title: item.title,
    updatedAt: item.updated_at,
    url: item.html_url
  }
}

function isRepositoryItem(
  item: GitHubRepositoryResponseItem | undefined
): item is GitHubRepositoryResponseItem {
  return (
    typeof item?.id === "number" &&
    typeof item.full_name === "string" &&
    typeof item.html_url === "string" &&
    typeof item.updated_at === "string"
  )
}

function toRepository(item: GitHubRepositoryResponseItem): GitHubRepository | null {
  if (
    typeof item.id !== "number" ||
    typeof item.full_name !== "string" ||
    typeof item.html_url !== "string" ||
    typeof item.updated_at !== "string"
  ) {
    return null
  }

  return {
    description: item.description ?? "",
    forks: item.forks_count ?? 0,
    fullName: item.full_name,
    id: item.id,
    isArchived: item.archived === true,
    isFork: item.fork === true,
    isPrivate: item.private === true,
    language: item.language ?? null,
    ownerAvatarUrl: item.owner?.avatar_url ?? "",
    ownerLogin: item.owner?.login ?? "",
    stars: item.stargazers_count ?? 0,
    updatedAt: item.updated_at,
    url: item.html_url
  }
}

export async function searchGitHubIssueLikes(params: {
  preferences: GitHubResolvedPreferences
  query: string
}): Promise<GitHubIssueLike[]> {
  const payload = await fetchGitHubJson<GitHubSearchIssuesResponse>(
    params.preferences,
    "GET /search/issues",
    {
      order: "desc",
      per_page: params.preferences.numberOfResults,
      q: params.query,
      sort: "updated"
    }
  )

  return (payload.items ?? []).filter(isIssueLikeItem).map(toIssueLike)
}

export async function searchGitHubRepositories(params: {
  preferences: GitHubResolvedPreferences
  query: string
}): Promise<GitHubRepository[]> {
  const payload = await fetchGitHubJson<GitHubSearchRepositoriesResponse>(
    params.preferences,
    "GET /search/repositories",
    {
      order: "desc",
      per_page: params.preferences.numberOfResults,
      q: params.query,
      sort: "updated"
    }
  )

  return (payload.items ?? [])
    .filter(isRepositoryItem)
    .map((item) => toRepository(item))
    .filter((item): item is GitHubRepository => item !== null)
}

export async function listGitHubLatestRepositories(params: {
  preferences: GitHubResolvedPreferences
}): Promise<GitHubRepository[]> {
  const payload = await fetchGitHubJson<GitHubRepositoryResponseItem[]>(
    params.preferences,
    "GET /user/repos",
    {
      affiliation: "owner,collaborator,organization_member",
      direction: "desc",
      per_page: params.preferences.numberOfResults,
      sort: "updated",
      visibility: "all"
    }
  )

  return payload
    .map((item) => toRepository(item))
    .filter((item): item is GitHubRepository => item !== null)
}

export async function listGitHubStarredRepositories(params: {
  preferences: GitHubResolvedPreferences
}): Promise<GitHubRepository[]> {
  const payload = await fetchGitHubJson<GitHubRepositoryResponseItem[]>(
    params.preferences,
    "GET /user/starred",
    {
      direction: "desc",
      per_page: params.preferences.numberOfResults,
      sort: "updated"
    }
  )

  return payload
    .map((item) => toRepository(item))
    .filter((item): item is GitHubRepository => item !== null)
}

export async function loadGitHubViewer(params: {
  preferences: GitHubResolvedPreferences
}): Promise<GitHubViewer> {
  const payload = await fetchGitHubJson<GitHubViewerResponse>(params.preferences, "GET /user")
  if (!payload.login) {
    throw new Error("GitHub viewer response is missing login")
  }

  return {
    avatarUrl: payload.avatar_url ?? "",
    login: payload.login
  }
}

export function dedupeIssueLikes(items: GitHubIssueLike[]): GitHubIssueLike[] {
  const byId = new Map<number, GitHubIssueLike>()

  for (const item of items) {
    if (!byId.has(item.id)) {
      byId.set(item.id, item)
    }
  }

  return Array.from(byId.values())
}
