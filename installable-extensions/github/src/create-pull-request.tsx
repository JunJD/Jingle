import { AlertCircle, GitPullRequest, Github, RefreshCw } from "lucide-react"
import { useCallback, useMemo, useReducer } from "react"
import {
  Action,
  ActionPanel,
  Detail,
  Form,
  useNativeExtensionNavigation
} from "@jingle/extension-api"
import {
  createGitHubPullRequest,
  listGitHubRepositoryBranches,
  listGitHubViewerRepositories,
  normalizeGitHubPreferences,
  openGitHubSettings,
  type GitHubBranch,
  type GitHubViewerRepository,
  useGitHubPreferences
} from "./runtime-client"
import { useRefreshableData } from "@jingle/extension-utils"

const EMPTY_BRANCHES: GitHubBranch[] = []
const EMPTY_REPOSITORIES: GitHubViewerRepository[] = []

interface PullRequestFormState {
  baseBranch: string
  body: string
  draft: boolean
  headBranch: string
  isSubmitting: boolean
  repository: string
  submissionError: string | null
  title: string
}

type PullRequestFormAction =
  | { type: "finishSubmitting" }
  | { type: "resetTitleAndBody" }
  | { type: "setBaseBranch"; value: string }
  | { type: "setBody"; value: string }
  | { type: "setDraft"; value: boolean }
  | { type: "setHeadBranch"; value: string }
  | { type: "setRepository"; value: string }
  | { type: "setSubmissionError"; value: string | null }
  | { type: "setTitle"; value: string }
  | { type: "startSubmitting" }

const INITIAL_FORM_STATE: PullRequestFormState = {
  baseBranch: "",
  body: "",
  draft: false,
  headBranch: "",
  isSubmitting: false,
  repository: "",
  submissionError: null,
  title: ""
}

function clearSubmissionError(state: PullRequestFormState): PullRequestFormState {
  return state.submissionError ? { ...state, submissionError: null } : state
}

function pullRequestFormReducer(
  state: PullRequestFormState,
  action: PullRequestFormAction
): PullRequestFormState {
  switch (action.type) {
    case "finishSubmitting":
      return { ...state, isSubmitting: false }
    case "resetTitleAndBody":
      return { ...state, body: "", title: "" }
    case "setBaseBranch":
      return { ...clearSubmissionError(state), baseBranch: action.value }
    case "setBody":
      return { ...clearSubmissionError(state), body: action.value }
    case "setDraft":
      return { ...clearSubmissionError(state), draft: action.value }
    case "setHeadBranch":
      return { ...clearSubmissionError(state), headBranch: action.value }
    case "setRepository":
      return { ...clearSubmissionError(state), repository: action.value }
    case "setSubmissionError":
      return { ...state, submissionError: action.value }
    case "setTitle":
      return { ...clearSubmissionError(state), title: action.value }
    case "startSubmitting":
      return { ...state, isSubmitting: true, submissionError: null }
  }
}

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
  const metadata = useMemo(
    () => (
      <Detail.Metadata>
        <Detail.Metadata.Label text={repositoryFullName} title="Repository" />
        <Detail.Metadata.Label text={`#${number}`} title="Pull Request" />
        <Detail.Metadata.Label text={headBranch} title="Source Branch" />
        <Detail.Metadata.Label text={baseBranch} title="Target Branch" />
        <Detail.Metadata.Label text={draft ? "Draft" : "Ready for Review"} title="Status" />
      </Detail.Metadata>
    ),
    [baseBranch, draft, headBranch, number, repositoryFullName]
  )

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
      metadata={metadata}
      navigationTitle="Pull Request Created"
    />
  )
}

function ConnectGitHubDetail(): React.JSX.Element {
  return (
    <Detail
      actions={
        <ActionPanel>
          <Action
            icon={<AlertCircle className="h-4 w-4" />}
            onAction={() => void openGitHubSettings("create-pull-request")}
            title="Connect GitHub"
          />
        </ActionPanel>
      }
      markdown="# Connect GitHub\n\nGitHub needs to be connected before it can create pull requests."
      navigationTitle="Create Pull Request"
    />
  )
}

function RepositoryErrorDetail(props: { error: string; onRetry: () => void }): React.JSX.Element {
  return (
    <Detail
      actions={
        <ActionPanel>
          <Action icon={<RefreshCw className="h-4 w-4" />} onAction={props.onRetry} title="Retry" />
          <Action
            icon={<AlertCircle className="h-4 w-4" />}
            onAction={() => void openGitHubSettings("create-pull-request")}
            title="Open GitHub Settings"
          />
        </ActionPanel>
      }
      markdown={`# GitHub Request Failed\n\n${props.error}`}
      navigationTitle="Create Pull Request"
    />
  )
}

function EmptyRepositoriesDetail(): React.JSX.Element {
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

function CreatePullRequestActionPanel(props: {
  onRefresh: () => void
  onSubmit: () => void
  submitTitle: string
}): React.JSX.Element {
  return (
    <ActionPanel>
      <Action.SubmitForm
        icon={<GitPullRequest className="h-4 w-4" />}
        onAction={props.onSubmit}
        title={props.submitTitle}
      />
      <Action
        icon={<RefreshCw className="h-4 w-4" />}
        onAction={props.onRefresh}
        title="Refresh Repositories and Branches"
      />
      <Action
        icon={<Github className="h-4 w-4" />}
        onAction={() => void openGitHubSettings("create-pull-request")}
        title="Open GitHub Settings"
      />
    </ActionPanel>
  )
}

function RepositoryField(props: {
  isLoadingRepositories: boolean
  onChange: (value: string) => void
  repositories: GitHubViewerRepository[]
  repository: string
}): React.JSX.Element {
  const { isLoadingRepositories, onChange, repositories, repository } = props

  return (
    <Form.Dropdown
      description={
        isLoadingRepositories
          ? "Loading your repositories…"
          : "Choose where to create the pull request."
      }
      id="repository"
      onChange={onChange}
      title="Repository"
      value={repository}
    >
      {repositories.map((item) => (
        <Form.Dropdown.Item key={item.id} title={item.fullName} value={item.fullName} />
      ))}
    </Form.Dropdown>
  )
}

function BranchFields(props: {
  baseBranch: string
  branches: GitHubBranch[]
  headBranch: string
  isLoadingBranches: boolean
  onBaseBranchChange: (value: string) => void
  onHeadBranchChange: (value: string) => void
}): React.JSX.Element {
  const {
    baseBranch,
    branches,
    headBranch,
    isLoadingBranches,
    onBaseBranchChange,
    onHeadBranchChange
  } = props

  return (
    <>
      <Form.Separator />

      <Form.Dropdown
        description={
          isLoadingBranches
            ? "Loading source branches…"
            : "Choose the branch that contains your changes."
        }
        id="head-branch"
        onChange={onHeadBranchChange}
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
        onChange={onBaseBranchChange}
        title="Into"
        value={baseBranch}
      >
        {branches.map((branch) => (
          <Form.Dropdown.Item key={branch.name} title={branch.name} value={branch.name} />
        ))}
      </Form.Dropdown>
    </>
  )
}

function PullRequestDetailsFields(props: {
  body: string
  draft: boolean
  onBodyChange: (value: string) => void
  onDraftChange: (value: boolean) => void
  onTitleChange: (value: string) => void
  title: string
}): React.JSX.Element {
  const { body, draft, onBodyChange, onDraftChange, onTitleChange, title } = props

  return (
    <>
      <Form.Separator />

      <Form.TextField
        description="Short summary shown in the pull request list."
        id="title"
        onChange={onTitleChange}
        placeholder="Pull request title"
        title="Title"
        value={title}
      />

      <Form.TextArea
        description="Markdown is supported by GitHub."
        id="body"
        onChange={onBodyChange}
        placeholder="Describe what changed"
        title="Description"
        value={body}
      />

      <Form.Checkbox
        description="Create the pull request as a draft."
        id="draft"
        onChange={onDraftChange}
        title="Draft"
        value={draft}
      />
    </>
  )
}

function CreatePullRequestForm(props: {
  baseBranch: string
  branches: GitHubBranch[]
  dispatchFormAction: (action: PullRequestFormAction) => void
  formState: PullRequestFormState
  formStateMessage: string | null
  headBranch: string
  isLoadingBranches: boolean
  isLoadingRepositories: boolean
  onRefresh: () => void
  onSubmit: () => void
  repositories: GitHubViewerRepository[]
  repository: string
  submitTitle: string
}): React.JSX.Element {
  const {
    baseBranch,
    branches,
    dispatchFormAction,
    formState,
    formStateMessage,
    headBranch,
    isLoadingBranches,
    isLoadingRepositories,
    onRefresh,
    onSubmit,
    repositories,
    repository,
    submitTitle
  } = props

  return (
    <Form
      actions={
        <CreatePullRequestActionPanel
          onRefresh={onRefresh}
          onSubmit={onSubmit}
          submitTitle={submitTitle}
        />
      }
      navigationTitle="Create Pull Request"
    >
      {formStateMessage ? (
        <Form.Message id="form-state-message" text={formStateMessage} tone="critical" />
      ) : null}

      <RepositoryField
        isLoadingRepositories={isLoadingRepositories}
        onChange={(value) => dispatchFormAction({ type: "setRepository", value })}
        repositories={repositories}
        repository={repository}
      />

      <BranchFields
        baseBranch={baseBranch}
        branches={branches}
        headBranch={headBranch}
        isLoadingBranches={isLoadingBranches}
        onBaseBranchChange={(value) => dispatchFormAction({ type: "setBaseBranch", value })}
        onHeadBranchChange={(value) => dispatchFormAction({ type: "setHeadBranch", value })}
      />

      <PullRequestDetailsFields
        body={formState.body}
        draft={formState.draft}
        onBodyChange={(value) => dispatchFormAction({ type: "setBody", value })}
        onDraftChange={(value) => dispatchFormAction({ type: "setDraft", value })}
        onTitleChange={(value) => dispatchFormAction({ type: "setTitle", value })}
        title={formState.title}
      />
    </Form>
  )
}

export default function GitHubCreatePullRequest(): React.JSX.Element {
  const navigation = useNativeExtensionNavigation()
  const githubPreferences = useGitHubPreferences<Record<string, never>>()
  const resolvedPreferences = useMemo(
    () => normalizeGitHubPreferences(githubPreferences),
    [githubPreferences]
  )
  const [formState, dispatch] = useReducer(pullRequestFormReducer, INITIAL_FORM_STATE)
  const loadRepositories = useCallback(
    () =>
      listGitHubViewerRepositories({
        preferences: resolvedPreferences
      }),
    [resolvedPreferences]
  )
  const {
    data: repositories,
    error: repositoryError,
    isLoading: isLoadingRepositories,
    refresh: refreshRepositories
  } = useRefreshableData({
    emptyData: EMPTY_REPOSITORIES,
    enabled: Boolean(resolvedPreferences.accessToken),
    failureMessage: "Failed to load GitHub repositories",
    load: loadRepositories
  })
  const repository = repositories.some((item) => item.fullName === formState.repository)
    ? formState.repository
    : (repositories[0]?.fullName ?? "")
  const selectedRepository = repositories.find((item) => item.fullName === repository) ?? null
  const loadBranches = useCallback(
    () =>
      listGitHubRepositoryBranches({
        preferences: resolvedPreferences,
        repositoryFullName: repository
      }),
    [repository, resolvedPreferences]
  )
  const {
    data: branches,
    error: branchError,
    isLoading: isLoadingBranches,
    refresh: refreshBranches
  } = useRefreshableData({
    emptyData: EMPTY_BRANCHES,
    enabled: Boolean(resolvedPreferences.accessToken && selectedRepository),
    failureMessage: "Failed to load repository branches",
    load: loadBranches
  })
  const defaultBaseBranch =
    branches.find((branch) => branch.name === selectedRepository?.defaultBranch)?.name ??
    branches[0]?.name ??
    ""
  const defaultHeadBranch = getDefaultHeadBranch({
    branches,
    defaultBranch: defaultBaseBranch
  })
  const baseBranch = branches.some((branch) => branch.name === formState.baseBranch)
    ? formState.baseBranch
    : defaultBaseBranch
  const headBranch = branches.some((branch) => branch.name === formState.headBranch)
    ? formState.headBranch
    : defaultHeadBranch

  const formStateMessage =
    formState.submissionError ??
    branchError ??
    (branches.length === 0 && !isLoadingBranches && repository
      ? "This repository has no branches."
      : null)

  const submitTitle = formState.isSubmitting
    ? "Creating Pull Request…"
    : isLoadingBranches
      ? "Loading Branches…"
      : "Create Pull Request"

  const handleRefresh = useCallback(() => {
    refreshRepositories()
    refreshBranches()
  }, [refreshBranches, refreshRepositories])

  const handleSubmit = useCallback(() => {
    if (formState.isSubmitting || isLoadingBranches) {
      return
    }

    if (!repository) {
      dispatch({ type: "setSubmissionError", value: "Choose a repository first." })
      return
    }

    if (!headBranch || !baseBranch) {
      dispatch({
        type: "setSubmissionError",
        value: "Choose both source and target branches."
      })
      return
    }

    if (headBranch === baseBranch) {
      dispatch({
        type: "setSubmissionError",
        value: "Source and target branches must be different."
      })
      return
    }

    if (!formState.title.trim()) {
      dispatch({ type: "setSubmissionError", value: "Add a pull request title." })
      return
    }

    dispatch({ type: "startSubmitting" })

    void createGitHubPullRequest({
      baseBranch,
      body: formState.body,
      draft: formState.draft,
      headBranch,
      preferences: resolvedPreferences,
      repositoryFullName: repository,
      title: formState.title.trim()
    })
      .then((pullRequest) => {
        dispatch({ type: "resetTitleAndBody" })
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
        dispatch({
          type: "setSubmissionError",
          value: nextError instanceof Error ? nextError.message : "Failed to create pull request"
        })
      })
      .finally(() => {
        dispatch({ type: "finishSubmitting" })
      })
  }, [
    baseBranch,
    formState.body,
    formState.draft,
    formState.isSubmitting,
    formState.title,
    headBranch,
    isLoadingBranches,
    navigation,
    repository,
    resolvedPreferences
  ])

  if (!resolvedPreferences.accessToken) {
    return <ConnectGitHubDetail />
  }

  if (repositoryError) {
    return <RepositoryErrorDetail error={repositoryError} onRetry={refreshRepositories} />
  }

  if (!isLoadingRepositories && repositories.length === 0) {
    return <EmptyRepositoriesDetail />
  }

  return (
    <CreatePullRequestForm
      baseBranch={baseBranch}
      branches={branches}
      dispatchFormAction={dispatch}
      formState={formState}
      formStateMessage={formStateMessage}
      headBranch={headBranch}
      isLoadingBranches={isLoadingBranches}
      isLoadingRepositories={isLoadingRepositories}
      onRefresh={handleRefresh}
      onSubmit={handleSubmit}
      repositories={repositories}
      repository={repository}
      submitTitle={submitTitle}
    />
  )
}
