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

export interface GitHubViewerRepository {
  defaultBranch: string
  fullName: string
  id: number
  name: string
  ownerLogin: string
}

export interface GitHubBranch {
  name: string
}

export interface GitHubNotification {
  id: string
  reason: string
  repositoryFullName: string
  subjectType: string
  title: string
  unread: boolean
  updatedAt: string
  url: string
}

export interface GitHubWorkflowRun {
  conclusion:
    | "action_required"
    | "cancelled"
    | "failure"
    | "neutral"
    | "skipped"
    | "stale"
    | "startup_failure"
    | "success"
    | "timed_out"
    | null
  createdAt: string
  event: string
  headBranch: string
  headCommitAuthor: string
  headCommitMessage: string
  headSha: string
  id: number
  name: string
  repositoryFullName: string
  runNumber: number
  status: "completed" | "in_progress" | "queued" | "requested" | "waiting" | null
  updatedAt: string
  url: string
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
  default_branch?: string
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

interface GitHubNotificationResponseItem {
  id?: string
  reason?: string
  repository?: {
    full_name?: string
  }
  subject?: {
    title?: string
    type?: string
    url?: string | null
  }
  unread?: boolean
  updated_at?: string
}

interface GitHubCreateIssueResponse {
  html_url?: string
  number?: number
  title?: string
}

interface GitHubCreatePullRequestResponse {
  body?: string | null
  draft?: boolean
  head?: {
    ref?: string | null
  } | null
  html_url?: string
  number?: number
  base?: {
    ref?: string | null
  } | null
  title?: string
}

interface GitHubBranchResponseItem {
  name?: string
}

interface GitHubWorkflowRunsResponse {
  workflow_runs?: GitHubWorkflowRunResponseItem[]
}

interface GitHubWorkflowRunResponseItem {
  conclusion?:
    | "action_required"
    | "cancelled"
    | "failure"
    | "neutral"
    | "skipped"
    | "stale"
    | "startup_failure"
    | "success"
    | "timed_out"
    | null
  created_at?: string
  display_title?: string | null
  event?: string
  head_branch?: string
  head_commit?: {
    author?: {
      email?: string | null
      name?: string | null
    } | null
    message?: string | null
  } | null
  head_sha?: string
  html_url?: string
  id?: number
  name?: string | null
  repository?: {
    full_name?: string
  } | null
  run_number?: number
  status?: "completed" | "in_progress" | "queued" | "requested" | "waiting" | null
  updated_at?: string
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

function parseRepositoryOwnerAndName(repositoryFullName: string): { owner: string; repo: string } {
  const [owner, repo] = repositoryFullName.split("/")
  if (!owner || !repo) {
    throw new Error(`Invalid repository name "${repositoryFullName}"`)
  }

  return { owner, repo }
}

function normalizeGitHubHtmlUrl(apiBaseUrl: string, apiUrl?: string | null): string | null {
  if (!apiUrl) {
    return null
  }

  const normalizedBaseUrl = apiBaseUrl.replace(/\/api\/v3$/, "").replace(/\/api$/, "")

  if (apiUrl.startsWith("https://api.github.com/repos/")) {
    return apiUrl
      .replace("https://api.github.com/repos/", `${normalizedBaseUrl}/`)
      .replace("/pulls/", "/pull/")
  }

  if (apiUrl.includes("/api/v3/repos/")) {
    return apiUrl.replace("/api/v3/repos/", "/").replace("/pulls/", "/pull/")
  }

  if (apiUrl.includes("/api/repos/")) {
    return apiUrl.replace("/api/repos/", "/").replace("/pulls/", "/pull/")
  }

  return apiUrl
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

export async function listGitHubViewerRepositories(params: {
  preferences: GitHubResolvedPreferences
}): Promise<GitHubViewerRepository[]> {
  const payload = await fetchGitHubJson<GitHubRepositoryResponseItem[]>(
    params.preferences,
    "GET /user/repos",
    {
      affiliation: "owner,collaborator,organization_member",
      direction: "desc",
      per_page: 100,
      sort: "updated",
      visibility: "all"
    }
  )

  return payload.reduce<GitHubViewerRepository[]>((repositories, item) => {
    const repository = toRepository(item)
    if (!repository) {
      return repositories
    }

    repositories.push({
      defaultBranch: item.default_branch ?? "main",
      fullName: repository.fullName,
      id: repository.id,
      name: repository.fullName.split("/")[1] ?? repository.fullName,
      ownerLogin: repository.ownerLogin
    })

    return repositories
  }, [])
}

export async function listGitHubRepositoryBranches(params: {
  preferences: GitHubResolvedPreferences
  repositoryFullName: string
}): Promise<GitHubBranch[]> {
  const { owner, repo } = parseRepositoryOwnerAndName(params.repositoryFullName)
  const payload = await fetchGitHubJson<GitHubBranchResponseItem[]>(
    params.preferences,
    "GET /repos/{owner}/{repo}/branches",
    {
      owner,
      per_page: 100,
      repo
    }
  )

  return payload
    .filter(
      (item): item is GitHubBranchResponseItem & { name: string } => typeof item.name === "string"
    )
    .map((item) => ({
      name: item.name
    }))
}

export async function createGitHubIssue(params: {
  body: string
  preferences: GitHubResolvedPreferences
  repositoryFullName: string
  title: string
}): Promise<{
  number: number
  title: string
  url: string
}> {
  const { owner, repo } = parseRepositoryOwnerAndName(params.repositoryFullName)
  const payload = await fetchGitHubJson<GitHubCreateIssueResponse>(
    params.preferences,
    "POST /repos/{owner}/{repo}/issues",
    {
      body: params.body,
      owner,
      repo,
      title: params.title
    }
  )

  if (typeof payload.number !== "number" || typeof payload.html_url !== "string") {
    throw new Error("GitHub did not return the created issue")
  }

  return {
    number: payload.number,
    title: payload.title ?? params.title,
    url: payload.html_url
  }
}

export async function createGitHubPullRequest(params: {
  baseBranch: string
  body: string
  draft: boolean
  headBranch: string
  preferences: GitHubResolvedPreferences
  repositoryFullName: string
  title: string
}): Promise<{
  baseBranch: string
  body: string
  draft: boolean
  headBranch: string
  number: number
  title: string
  url: string
}> {
  const { owner, repo } = parseRepositoryOwnerAndName(params.repositoryFullName)
  const payload = await fetchGitHubJson<GitHubCreatePullRequestResponse>(
    params.preferences,
    "POST /repos/{owner}/{repo}/pulls",
    {
      base: params.baseBranch,
      body: params.body,
      draft: params.draft,
      head: params.headBranch,
      owner,
      repo,
      title: params.title
    }
  )

  if (typeof payload.number !== "number" || typeof payload.html_url !== "string") {
    throw new Error("GitHub did not return the created pull request")
  }

  return {
    baseBranch: payload.base?.ref ?? params.baseBranch,
    body: payload.body ?? params.body,
    draft: payload.draft ?? params.draft,
    headBranch: payload.head?.ref ?? params.headBranch,
    number: payload.number,
    title: payload.title ?? params.title,
    url: payload.html_url
  }
}

export async function listGitHubNotifications(params: {
  preferences: GitHubResolvedPreferences
}): Promise<GitHubNotification[]> {
  const payload = await fetchGitHubJson<GitHubNotificationResponseItem[]>(
    params.preferences,
    "GET /notifications",
    {
      all: true,
      per_page: params.preferences.numberOfResults
    }
  )

  return payload
    .filter(
      (
        item
      ): item is Required<
        Pick<
          GitHubNotificationResponseItem,
          "id" | "reason" | "subject" | "repository" | "updated_at" | "unread"
        >
      > =>
        typeof item.id === "string" &&
        typeof item.reason === "string" &&
        typeof item.updated_at === "string" &&
        typeof item.unread === "boolean" &&
        Boolean(item.subject?.title) &&
        Boolean(item.subject?.type) &&
        Boolean(item.repository?.full_name)
    )
    .map((item) => ({
      id: item.id,
      reason: item.reason,
      repositoryFullName: item.repository.full_name!,
      subjectType: item.subject.type!,
      title: item.subject.title!,
      unread: item.unread,
      updatedAt: item.updated_at,
      url:
        normalizeGitHubHtmlUrl(params.preferences.apiBaseUrl, item.subject.url) ??
        `${params.preferences.apiBaseUrl.replace(/\/api\/v3$/, "").replace(/\/api$/, "")}/notifications`
    }))
}

export async function listGitHubWorkflowRuns(params: {
  preferences: GitHubResolvedPreferences
  repositoryFullName: string
}): Promise<GitHubWorkflowRun[]> {
  const { owner, repo } = parseRepositoryOwnerAndName(params.repositoryFullName)
  const payload = await fetchGitHubJson<GitHubWorkflowRunsResponse>(
    params.preferences,
    "GET /repos/{owner}/{repo}/actions/runs",
    {
      owner,
      per_page: params.preferences.numberOfResults,
      repo
    }
  )

  return (payload.workflow_runs ?? [])
    .map((item) => {
      if (
        typeof item.id !== "number" ||
        typeof item.html_url !== "string" ||
        typeof item.created_at !== "string" ||
        typeof item.updated_at !== "string"
      ) {
        return null
      }

      return {
        conclusion: item.conclusion ?? null,
        createdAt: item.created_at,
        event: item.event ?? "unknown",
        headBranch: item.head_branch ?? "",
        headCommitAuthor:
          item.head_commit?.author?.name ?? item.head_commit?.author?.email ?? "Unknown author",
        headCommitMessage: item.head_commit?.message ?? "",
        headSha: item.head_sha ?? "",
        id: item.id,
        name: item.display_title ?? item.name ?? `Run #${item.run_number ?? item.id}`,
        repositoryFullName: item.repository?.full_name ?? params.repositoryFullName,
        runNumber: item.run_number ?? item.id,
        status: item.status ?? null,
        updatedAt: item.updated_at,
        url: item.html_url
      } satisfies GitHubWorkflowRun
    })
    .filter((item): item is GitHubWorkflowRun => item !== null)
}

export async function markGitHubNotificationAsRead(params: {
  notificationId: string
  preferences: GitHubResolvedPreferences
}): Promise<void> {
  await fetchGitHubJson(params.preferences, "PATCH /notifications/threads/{thread_id}", {
    thread_id: Number.parseInt(params.notificationId, 10)
  })
}

export async function markAllGitHubNotificationsAsRead(params: {
  preferences: GitHubResolvedPreferences
}): Promise<void> {
  await fetchGitHubJson(params.preferences, "PUT /notifications", {})
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
