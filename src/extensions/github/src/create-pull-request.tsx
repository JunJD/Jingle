import { AlertCircle, GitPullRequest, Github, RefreshCw } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Action, ActionPanel, Detail, Form, useNativeExtensionNavigation } from "../../runtime-api"
import {
  createGitHubPullRequest,
  listGitHubRepositoryBranches,
  listGitHubViewerRepositories,
  normalizeGitHubPreferences,
  openGitHubSettings,
  type GitHubBranch,
  type GitHubViewerRepository,
  useGitHubCommandPreferences
} from "./runtime-client"

function getDefaultHeadBranch(params: { branches: GitHubBranch[]; defaultBranch: string }): string {
  const nonDefaultBranch = params.branches.find((branch) => branch.name !== params.defaultBranch)
  return nonDefaultBranch?.name ?? params.branches[0]?.name ?? ""
}

function CreatePullRequestSuccessDetail(props: {
  baseBranch: string
  body: string
  draft: boolean
  headBranch: string
  number: number
  repositoryFullName: string
  title: string
  url: string
}): React.JSX.Element {
  const navigation = useNativeExtensionNavigation()
  const { baseBranch, body, draft, headBranch, number, repositoryFullName, title, url } = props

  return (
    <Detail
      actions={
        <ActionPanel>
          <Action.OpenInBrowser title="Open Pull Request in Browser" url={url} />
          <Action
            icon={<GitPullRequest className="h-4 w-4" />}
            onAction={() =>
              navigation.openCommand({
                commandName: "my-pull-requests",
                extensionName: "github",
                kind: "extension-command"
              })
            }
            title="Show My Pull Requests"
          />
          <Action onAction={() => navigation.pop()} title="Create Another Pull Request" />
        </ActionPanel>
      }
      markdown={`# ${title}\n\nCreated pull request **#${number}** in **${repositoryFullName}**.\n\n**From:** \`${headBranch}\`\n**Into:** \`${baseBranch}\`\n**Type:** ${draft ? "Draft" : "Ready for Review"}\n\n${body.trim() ? body : "_No description provided._"}`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label text={repositoryFullName} title="Repository" />
          <Detail.Metadata.Label text={`#${number}`} title="Pull Request" />
          <Detail.Metadata.Label text={headBranch} title="Source Branch" />
          <Detail.Metadata.Label text={baseBranch} title="Target Branch" />
          <Detail.Metadata.Label text={draft ? "Draft" : "Ready for Review"} title="Status" />
        </Detail.Metadata>
      }
      navigationTitle="Pull Request Created"
    />
  )
}

export default function GitHubCreatePullRequest(): React.JSX.Element {
  const navigation = useNativeExtensionNavigation()
  const commandPreferences = useGitHubCommandPreferences<Record<string, never>>()
  const resolvedPreferences = useMemo(
    () => normalizeGitHubPreferences(commandPreferences),
    [commandPreferences]
  )
  const [repositories, setRepositories] = useState<GitHubViewerRepository[]>([])
  const [branches, setBranches] = useState<GitHubBranch[]>([])
  const [repository, setRepository] = useState("")
  const [headBranch, setHeadBranch] = useState("")
  const [baseBranch, setBaseBranch] = useState("")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [draft, setDraft] = useState(false)
  const [repositoryError, setRepositoryError] = useState<string | null>(null)
  const [branchError, setBranchError] = useState<string | null>(null)
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const [isLoadingRepositories, setIsLoadingRepositories] = useState(false)
  const [isLoadingBranches, setIsLoadingBranches] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [reloadVersion, setReloadVersion] = useState(0)

  const selectedRepository = repositories.find((item) => item.fullName === repository) ?? null

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      if (!resolvedPreferences.accessToken) {
        return
      }

      setIsLoadingRepositories(true)
      setRepositoryError(null)

      try {
        const nextRepositories = await listGitHubViewerRepositories({
          preferences: resolvedPreferences
        })

        if (cancelled) {
          return
        }

        setRepositories(nextRepositories)
        setBranches([])
        setHeadBranch("")
        setBaseBranch("")
        setBranchError(null)
        setSubmissionError(null)
        setRepository((current) =>
          nextRepositories.some((item) => item.fullName === current)
            ? current
            : (nextRepositories[0]?.fullName ?? "")
        )
      } catch (nextError) {
        if (!cancelled) {
          setRepositories([])
          setBranches([])
          setRepositoryError(
            nextError instanceof Error ? nextError.message : "Failed to load GitHub repositories"
          )
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRepositories(false)
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [reloadVersion, resolvedPreferences])

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      if (!resolvedPreferences.accessToken || !repository || !selectedRepository) {
        return
      }

      setIsLoadingBranches(true)
      setBranchError(null)

      try {
        const nextBranches = await listGitHubRepositoryBranches({
          preferences: resolvedPreferences,
          repositoryFullName: repository
        })

        if (cancelled) {
          return
        }

        const defaultBaseBranch =
          nextBranches.find((branch) => branch.name === selectedRepository.defaultBranch)?.name ??
          nextBranches[0]?.name ??
          ""
        const defaultHeadBranch = getDefaultHeadBranch({
          branches: nextBranches,
          defaultBranch: defaultBaseBranch
        })

        setBranches(nextBranches)
        setBaseBranch((current) =>
          nextBranches.some((branch) => branch.name === current) ? current : defaultBaseBranch
        )
        setHeadBranch((current) =>
          nextBranches.some((branch) => branch.name === current) ? current : defaultHeadBranch
        )
      } catch (nextError) {
        if (!cancelled) {
          setBranches([])
          setHeadBranch("")
          setBaseBranch("")
          setBranchError(
            nextError instanceof Error ? nextError.message : "Failed to load repository branches"
          )
        }
      } finally {
        if (!cancelled) {
          setIsLoadingBranches(false)
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [reloadVersion, repository, resolvedPreferences, selectedRepository])

  const formStateMessage =
    submissionError ??
    branchError ??
    (branches.length === 0 && !isLoadingBranches && repository
      ? "This repository has no branches."
      : null)

  const submitTitle = isSubmitting
    ? "Creating Pull Request…"
    : isLoadingBranches
      ? "Loading Branches…"
      : "Create Pull Request"

  if (!resolvedPreferences.accessToken) {
    return (
      <Detail
        actions={
          <ActionPanel>
            <Action
              icon={<AlertCircle className="h-4 w-4" />}
              onAction={() => void openGitHubSettings("create-pull-request")}
              title="Add GitHub Token"
            />
          </ActionPanel>
        }
        markdown="# Connect GitHub\n\nGitHub needs a personal access token before it can create pull requests."
        navigationTitle="Create Pull Request"
      />
    )
  }

  if (repositoryError) {
    return (
      <Detail
        actions={
          <ActionPanel>
            <Action
              icon={<RefreshCw className="h-4 w-4" />}
              onAction={() => setReloadVersion((value) => value + 1)}
              title="Retry"
            />
            <Action
              icon={<AlertCircle className="h-4 w-4" />}
              onAction={() => void openGitHubSettings("create-pull-request")}
              title="Open GitHub Settings"
            />
          </ActionPanel>
        }
        markdown={`# GitHub Request Failed\n\n${repositoryError}`}
        navigationTitle="Create Pull Request"
      />
    )
  }

  if (!isLoadingRepositories && repositories.length === 0) {
    return (
      <Detail
        actions={
          <ActionPanel>
            <Action
              icon={<Github className="h-4 w-4" />}
              onAction={() => void openGitHubSettings("create-pull-request")}
              title="Open GitHub Settings"
            />
          </ActionPanel>
        }
        markdown="# No repositories found\n\nGitHub did not return any repositories you can create pull requests in."
        navigationTitle="Create Pull Request"
      />
    )
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            icon={<GitPullRequest className="h-4 w-4" />}
            onAction={() => {
              if (isSubmitting || isLoadingBranches) {
                return
              }

              if (!repository) {
                setSubmissionError("Choose a repository first.")
                return
              }

              if (!headBranch || !baseBranch) {
                setSubmissionError("Choose both source and target branches.")
                return
              }

              if (headBranch === baseBranch) {
                setSubmissionError("Source and target branches must be different.")
                return
              }

              if (!title.trim()) {
                setSubmissionError("Add a pull request title.")
                return
              }

              setSubmissionError(null)
              setIsSubmitting(true)

              void createGitHubPullRequest({
                baseBranch,
                body,
                draft,
                headBranch,
                preferences: resolvedPreferences,
                repositoryFullName: repository,
                title: title.trim()
              })
                .then((pullRequest) => {
                  setTitle("")
                  setBody("")
                  navigation.push(
                    <CreatePullRequestSuccessDetail
                      baseBranch={pullRequest.baseBranch}
                      body={pullRequest.body}
                      draft={pullRequest.draft}
                      headBranch={pullRequest.headBranch}
                      number={pullRequest.number}
                      repositoryFullName={repository}
                      title={pullRequest.title}
                      url={pullRequest.url}
                    />
                  )
                })
                .catch((nextError) => {
                  setSubmissionError(
                    nextError instanceof Error ? nextError.message : "Failed to create pull request"
                  )
                })
                .finally(() => {
                  setIsSubmitting(false)
                })
            }}
            title={submitTitle}
          />
          <Action
            icon={<RefreshCw className="h-4 w-4" />}
            onAction={() => setReloadVersion((value) => value + 1)}
            title="Refresh Repositories and Branches"
          />
          <Action
            icon={<Github className="h-4 w-4" />}
            onAction={() => void openGitHubSettings("create-pull-request")}
            title="Open GitHub Settings"
          />
        </ActionPanel>
      }
      navigationTitle="Create Pull Request"
    >
      {formStateMessage ? (
        <Form.Message id="form-state-message" text={formStateMessage} tone="critical" />
      ) : null}

      <Form.Dropdown
        description={
          isLoadingRepositories
            ? "Loading your repositories…"
            : "Choose where to create the pull request."
        }
        id="repository"
        onChange={(value) => {
          setSubmissionError(null)
          setRepository(value)
        }}
        title="Repository"
        value={repository}
      >
        {repositories.map((item) => (
          <Form.Dropdown.Item key={item.id} title={item.fullName} value={item.fullName} />
        ))}
      </Form.Dropdown>

      <Form.Separator />

      <Form.Dropdown
        description={
          isLoadingBranches
            ? "Loading source branches…"
            : "Choose the branch that contains your changes."
        }
        id="head-branch"
        onChange={(value) => {
          setSubmissionError(null)
          setHeadBranch(value)
        }}
        title="From"
        value={headBranch}
      >
        {branches.map((branch) => (
          <Form.Dropdown.Item key={branch.name} title={branch.name} value={branch.name} />
        ))}
      </Form.Dropdown>

      <Form.Dropdown
        description="Choose the branch you want to merge into."
        id="base-branch"
        onChange={(value) => {
          setSubmissionError(null)
          setBaseBranch(value)
        }}
        title="Into"
        value={baseBranch}
      >
        {branches.map((branch) => (
          <Form.Dropdown.Item key={branch.name} title={branch.name} value={branch.name} />
        ))}
      </Form.Dropdown>

      <Form.Separator />

      <Form.TextField
        description="Short summary shown in the pull request list."
        id="title"
        onChange={(value) => {
          setSubmissionError(null)
          setTitle(value)
        }}
        placeholder="Pull request title"
        title="Title"
        value={title}
      />

      <Form.TextArea
        description="Markdown is supported by GitHub."
        id="body"
        onChange={(value) => {
          setSubmissionError(null)
          setBody(value)
        }}
        placeholder="Describe what changed"
        title="Description"
        value={body}
      />

      <Form.Checkbox
        description="Create the pull request as a draft."
        id="draft"
        onChange={(value) => {
          setSubmissionError(null)
          setDraft(value)
        }}
        title="Draft"
        value={draft}
      />
    </Form>
  )
}
