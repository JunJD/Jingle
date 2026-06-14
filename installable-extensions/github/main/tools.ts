import { z } from "zod/v4"
import type { ExtensionToolContext, ExtensionToolDefinition } from "@openwork/extension-api"
import {
  createGitHubIssue,
  dedupeIssueLikes,
  listGitHubLatestRepositories,
  listGitHubNotifications,
  listGitHubStarredRepositories,
  listGitHubWorkflowRuns,
  loadGitHubViewer,
  normalizeGitHubPreferences,
  searchGitHubIssueLikes,
  searchGitHubRepositories,
  type GitHubExtensionPreferences,
  type GitHubResolvedPreferences
} from "../domain/client-core"

const repositoryFullNameSchema = z
  .string()
  .trim()
  .regex(/^[^/\s]+\/[^/\s]+$/, "Expected owner/repository.")

const listMyIssuesInputSchema = z.object({
  includeRecentlyClosed: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(100).optional(),
  scope: z
    .array(z.enum(["created", "assigned", "mentioned"]))
    .min(1)
    .optional()
    .default(["created", "assigned", "mentioned"])
})

const listMyPullRequestsInputSchema = z.object({
  includeDrafts: z.boolean().optional().default(false),
  includeRecentlyClosed: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(100).optional(),
  scope: z
    .array(z.enum(["authored", "assigned", "mentioned", "reviewRequested", "reviewed"]))
    .min(1)
    .optional()
    .default(["authored", "assigned", "mentioned", "reviewRequested"])
})

const searchGitHubInputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  query: z.string().trim().min(1)
})

const searchRepositoriesInputSchema = z.object({
  includeArchived: z.boolean().optional().default(false),
  includeForks: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(100).optional(),
  query: z.string().trim().min(1)
})

const listRepositoriesInputSchema = z.object({
  kind: z.enum(["latest", "starred"]).optional().default("latest"),
  limit: z.number().int().min(1).max(100).optional()
})

const listNotificationsInputSchema = z.object({
  unreadOnly: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(100).optional()
})

const listWorkflowRunsInputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  repositoryFullName: repositoryFullNameSchema
})

const createIssueInputSchema = z.object({
  body: z.string().optional().default(""),
  repositoryFullName: repositoryFullNameSchema,
  title: z.string().trim().min(1)
})

type ListMyIssuesInput = z.infer<typeof listMyIssuesInputSchema>
type ListMyPullRequestsInput = z.infer<typeof listMyPullRequestsInputSchema>
type SearchGitHubInput = z.infer<typeof searchGitHubInputSchema>
type SearchRepositoriesInput = z.infer<typeof searchRepositoriesInputSchema>
type ListRepositoriesInput = z.infer<typeof listRepositoriesInputSchema>
type ListNotificationsInput = z.infer<typeof listNotificationsInputSchema>
type ListWorkflowRunsInput = z.infer<typeof listWorkflowRunsInputSchema>
type CreateIssueInput = z.infer<typeof createIssueInputSchema>

type RecoverableGitHubToolResult = {
  code: "github_repository_unavailable" | "github_request_invalid"
  message: string
  nextAction: string
  repositoryFullName: string
  status: "error"
  toolName: "createIssue" | "listWorkflowRuns"
}

function resolveGitHubPreferences(ctx: ExtensionToolContext): GitHubResolvedPreferences {
  const preferences = ctx.extensionPreferences

  return normalizeGitHubPreferences({
    accessToken: String(preferences.accessToken ?? ""),
    apiBaseUrl: String(preferences.apiBaseUrl ?? ""),
    defaultSearchTerms: String(preferences.defaultSearchTerms ?? ""),
    numberOfResults:
      typeof preferences.numberOfResults === "number"
        ? preferences.numberOfResults
        : String(preferences.numberOfResults ?? "")
  } satisfies GitHubExtensionPreferences)
}

function withLimit(
  preferences: GitHubResolvedPreferences,
  limit: number | undefined
): GitHubResolvedPreferences {
  return {
    ...preferences,
    numberOfResults: limit ?? preferences.numberOfResults
  }
}

function buildIssueQueryForViewer(input: {
  login: string
  scope: ListMyIssuesInput["scope"]
  state: "open" | "closed"
}): string[] {
  const qualifiers: Record<ListMyIssuesInput["scope"][number], string> = {
    assigned: `assignee:${input.login}`,
    created: `author:${input.login}`,
    mentioned: `mentions:${input.login}`
  }

  return input.scope.map(
    (entry) => `is:issue ${qualifiers[entry]} archived:false is:${input.state}`
  )
}

function buildPullRequestQueryForViewer(input: {
  includeDrafts: boolean
  login: string
  scope: ListMyPullRequestsInput["scope"]
  state: "open" | "closed"
}): string[] {
  const qualifiers: Record<ListMyPullRequestsInput["scope"][number], string> = {
    assigned: `assignee:${input.login}`,
    authored: `author:${input.login}`,
    mentioned: `mentions:${input.login}`,
    reviewed: `reviewed-by:${input.login}`,
    reviewRequested: `review-requested:${input.login}`
  }

  return input.scope.map((entry) =>
    `is:pr ${qualifiers[entry]} archived:false is:${input.state} ${
      input.includeDrafts ? "" : "draft:false"
    }`.trim()
  )
}

function buildRepositorySearchQuery(input: SearchRepositoriesInput): string {
  const parts = [input.query, input.includeForks ? "" : "fork:false"]
  if (!input.includeArchived) {
    parts.push("archived:false")
  }

  return parts.filter((part) => part.trim().length > 0).join(" ")
}

async function searchIssueQueries(params: {
  preferences: GitHubResolvedPreferences
  queries: string[]
}) {
  const groups: Awaited<ReturnType<typeof searchGitHubIssueLikes>>[] = []
  for (const query of params.queries) {
    groups.push(
      await searchGitHubIssueLikes({
        preferences: params.preferences,
        query
      })
    )
  }

  return dedupeIssueLikes(groups.flat())
}

function getGitHubErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return null
  }

  const status = (error as { status?: unknown }).status
  return typeof status === "number" ? status : null
}

function toRecoverableGitHubRepositoryResult(
  error: unknown,
  input: { repositoryFullName: string; toolName: "createIssue" | "listWorkflowRuns" }
): RecoverableGitHubToolResult | null {
  const status = getGitHubErrorStatus(error)
  if (status !== 404 && status !== 422) {
    return null
  }

  return {
    code: status === 404 ? "github_repository_unavailable" : "github_request_invalid",
    message: error instanceof Error ? error.message : String(error),
    nextAction:
      "Search repositories with searchRepositories and retry with an accessible owner/repository name. If the repository exists but is private, tell the user the connected GitHub account needs access.",
    repositoryFullName: input.repositoryFullName,
    status: "error",
    toolName: input.toolName
  }
}

async function runGitHubRepositoryTool<TResult>(input: {
  operation: () => Promise<TResult>
  repositoryFullName: string
  toolName: "createIssue" | "listWorkflowRuns"
}): Promise<TResult | RecoverableGitHubToolResult> {
  try {
    return await input.operation()
  } catch (error) {
    const recoverableResult = toRecoverableGitHubRepositoryResult(error, input)
    if (recoverableResult) {
      return recoverableResult
    }

    throw error
  }
}

export function createGitHubTools(): ExtensionToolDefinition[] {
  const listMyIssuesTool: ExtensionToolDefinition<ListMyIssuesInput> = {
    access: "read",
    description: "List GitHub issues created by, assigned to, or mentioning the current user.",
    handler: async (ctx, input) => {
      const preferences = withLimit(resolveGitHubPreferences(ctx), input.limit)
      const viewer = await loadGitHubViewer({ preferences })
      const queries = buildIssueQueryForViewer({
        login: viewer.login,
        scope: input.scope,
        state: "open"
      })
      if (input.includeRecentlyClosed) {
        queries.push(
          ...buildIssueQueryForViewer({
            login: viewer.login,
            scope: input.scope,
            state: "closed"
          })
        )
      }

      return searchIssueQueries({
        preferences,
        queries
      })
    },
    inputSchema: listMyIssuesInputSchema,
    name: "listMyIssues",
    title: "List My Issues"
  }

  const listMyPullRequestsTool: ExtensionToolDefinition<ListMyPullRequestsInput> = {
    access: "read",
    description:
      "List GitHub pull requests authored by, assigned to, mentioning, reviewed by, or requesting review from the current user.",
    handler: async (ctx, input) => {
      const preferences = withLimit(resolveGitHubPreferences(ctx), input.limit)
      const viewer = await loadGitHubViewer({ preferences })
      const queries = buildPullRequestQueryForViewer({
        includeDrafts: input.includeDrafts,
        login: viewer.login,
        scope: input.scope,
        state: "open"
      })
      if (input.includeRecentlyClosed) {
        queries.push(
          ...buildPullRequestQueryForViewer({
            includeDrafts: input.includeDrafts,
            login: viewer.login,
            scope: input.scope,
            state: "closed"
          })
        )
      }

      return searchIssueQueries({
        preferences,
        queries
      })
    },
    inputSchema: listMyPullRequestsInputSchema,
    name: "listMyPullRequests",
    title: "List My Pull Requests"
  }

  const searchIssuesTool: ExtensionToolDefinition<SearchGitHubInput> = {
    access: "read",
    description: "Search GitHub issues with GitHub search qualifiers.",
    handler: async (ctx, input) =>
      (
        await searchGitHubIssueLikes({
          preferences: withLimit(resolveGitHubPreferences(ctx), input.limit),
          query: `is:issue archived:false ${input.query}`
        })
      ).filter((item) => item.kind === "issue"),
    inputSchema: searchGitHubInputSchema,
    name: "searchIssues",
    title: "Search Issues"
  }

  const searchPullRequestsTool: ExtensionToolDefinition<SearchGitHubInput> = {
    access: "read",
    description: "Search GitHub pull requests with GitHub search qualifiers.",
    handler: async (ctx, input) =>
      (
        await searchGitHubIssueLikes({
          preferences: withLimit(resolveGitHubPreferences(ctx), input.limit),
          query: `is:pr archived:false ${input.query}`
        })
      ).filter((item) => item.kind === "pull_request"),
    inputSchema: searchGitHubInputSchema,
    name: "searchPullRequests",
    title: "Search Pull Requests"
  }

  const searchRepositoriesTool: ExtensionToolDefinition<SearchRepositoriesInput> = {
    access: "read",
    description: "Search GitHub repositories with GitHub search qualifiers.",
    handler: (ctx, input) =>
      searchGitHubRepositories({
        preferences: withLimit(resolveGitHubPreferences(ctx), input.limit),
        query: buildRepositorySearchQuery(input)
      }),
    inputSchema: searchRepositoriesInputSchema,
    name: "searchRepositories",
    title: "Search Repositories"
  }

  const listRepositoriesTool: ExtensionToolDefinition<ListRepositoriesInput> = {
    access: "read",
    description: "List recently updated or starred repositories for the current GitHub user.",
    handler: (ctx, input) => {
      const preferences = withLimit(resolveGitHubPreferences(ctx), input.limit)
      return input.kind === "starred"
        ? listGitHubStarredRepositories({ preferences })
        : listGitHubLatestRepositories({ preferences })
    },
    inputSchema: listRepositoriesInputSchema,
    name: "listRepositories",
    title: "List Repositories"
  }

  const listNotificationsTool: ExtensionToolDefinition<ListNotificationsInput> = {
    access: "read",
    description: "List GitHub notifications for the current user.",
    handler: async (ctx, input) => {
      const notifications = await listGitHubNotifications({
        preferences: withLimit(resolveGitHubPreferences(ctx), input.limit)
      })

      return input.unreadOnly
        ? notifications.filter((notification) => notification.unread)
        : notifications
    },
    inputSchema: listNotificationsInputSchema,
    name: "listNotifications",
    title: "List Notifications"
  }

  const listWorkflowRunsTool: ExtensionToolDefinition<ListWorkflowRunsInput> = {
    access: "read",
    description: "List recent GitHub Actions workflow runs for a repository.",
    handler: (ctx, input) =>
      runGitHubRepositoryTool({
        operation: () =>
          listGitHubWorkflowRuns({
            preferences: withLimit(resolveGitHubPreferences(ctx), input.limit),
            repositoryFullName: input.repositoryFullName
          }),
        repositoryFullName: input.repositoryFullName,
        toolName: "listWorkflowRuns"
      }),
    inputSchema: listWorkflowRunsInputSchema,
    name: "listWorkflowRuns",
    title: "List Workflow Runs"
  }

  const createIssueTool: ExtensionToolDefinition<CreateIssueInput> = {
    access: "write",
    description: "Create a GitHub issue in a repository.",
    handler: (ctx, input) =>
      runGitHubRepositoryTool({
        operation: () =>
          createGitHubIssue({
            body: input.body,
            preferences: resolveGitHubPreferences(ctx),
            repositoryFullName: input.repositoryFullName,
            title: input.title
          }),
        repositoryFullName: input.repositoryFullName,
        toolName: "createIssue"
      }),
    inputSchema: createIssueInputSchema,
    name: "createIssue",
    title: "Create Issue"
  }

  return [
    listMyIssuesTool,
    listMyPullRequestsTool,
    searchIssuesTool,
    searchPullRequestsTool,
    searchRepositoriesTool,
    listRepositoriesTool,
    listNotificationsTool,
    listWorkflowRunsTool,
    createIssueTool
  ]
}
