import { AlertCircle, Github, Plus } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import {
  Action,
  ActionPanel,
  Detail,
  Form,
  useNativeExtensionNavigation
} from "@jingle/extension-api"
import {
  createGitHubIssue,
  listGitHubViewerRepositories,
  normalizeGitHubPreferences,
  openGitHubSettings,
  type GitHubViewerRepository,
  useGitHubPreferences
} from "./runtime-client"
import { useRefreshableData } from "@jingle/extension-utils"

const EMPTY_REPOSITORIES: GitHubViewerRepository[] = []

function CreateIssueSuccessDetail(props: {
  body: string
  repositoryFullName: string
  title: string
  url: string
  number: number
}): React.JSX.Element {
  const { body, number, repositoryFullName, title, url } = props
  const metadata = useMemo(
    () => (
      <Detail.Metadata>
        <Detail.Metadata.Label text={repositoryFullName} title="Repository" />
        <Detail.Metadata.Label text={`#${number}`} title="Issue Number" />
      </Detail.Metadata>
    ),
    [number, repositoryFullName]
  )

  return (
    <Detail
      actions={
        <ActionPanel>
          <Action.OpenInBrowser title="Open Issue in Browser" url={url} />
        </ActionPanel>
      }
      markdown={`# ${title}\n\nCreated issue **#${number}** in **${repositoryFullName}**.\n\n${body.trim() ? body : "_No description provided._"}`}
      metadata={metadata}
      navigationTitle="Issue Created"
    />
  )
}

export default function GitHubCreateIssue(): React.JSX.Element {
  const navigation = useNativeExtensionNavigation()
  const githubPreferences = useGitHubPreferences<Record<string, never>>()
  const resolvedPreferences = useMemo(
    () => normalizeGitHubPreferences(githubPreferences),
    [githubPreferences]
  )
  const [repository, setRepository] = useState("")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const loadRepositories = useCallback(
    () =>
      listGitHubViewerRepositories({
        preferences: resolvedPreferences
      }),
    [resolvedPreferences]
  )
  const {
    data: repositories,
    error,
    isLoading
  } = useRefreshableData({
    emptyData: EMPTY_REPOSITORIES,
    enabled: Boolean(resolvedPreferences.accessToken),
    failureMessage: "Failed to load GitHub repositories",
    load: loadRepositories
  })

  const selectedRepository = repositories.some((item) => item.fullName === repository)
    ? repository
    : (repositories[0]?.fullName ?? "")

  if (!resolvedPreferences.accessToken) {
    return (
      <Detail
        actions={
          <ActionPanel>
            <Action
              icon={<AlertCircle className="h-4 w-4" />}
              onAction={() => void openGitHubSettings("create-issue")}
              title="Connect GitHub"
            />
          </ActionPanel>
        }
        markdown="# Connect GitHub\n\nGitHub needs to be connected before it can create issues."
        navigationTitle="Create Issue"
      />
    )
  }

  if (error) {
    return (
      <Detail
        actions={
          <ActionPanel>
            <Action
              icon={<AlertCircle className="h-4 w-4" />}
              onAction={() => void openGitHubSettings("create-issue")}
              title="Open GitHub Settings"
            />
          </ActionPanel>
        }
        markdown={`# GitHub Request Failed\n\n${error}`}
        navigationTitle="Create Issue"
      />
    )
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            icon={<Plus className="h-4 w-4" />}
            onAction={() => {
              if (!selectedRepository.trim() || !title.trim() || isSubmitting) {
                return
              }

              setIsSubmitting(true)
              void createGitHubIssue({
                body,
                preferences: resolvedPreferences,
                repositoryFullName: selectedRepository,
                title
              })
                .then((issue) => {
                  setTitle("")
                  setBody("")
                  navigation.push(
                    <CreateIssueSuccessDetail
                      body={body}
                      number={issue.number}
                      repositoryFullName={selectedRepository}
                      title={issue.title}
                      url={issue.url}
                    />
                  )
                })
                .finally(() => {
                  setIsSubmitting(false)
                })
            }}
            title={isSubmitting ? "Creating Issue…" : "Create Issue"}
          />
          <Action
            icon={<Github className="h-4 w-4" />}
            onAction={() => void openGitHubSettings("create-issue")}
            title="Open GitHub Settings"
          />
        </ActionPanel>
      }
      navigationTitle="Create Issue"
    >
      <Form.Dropdown
        description={isLoading ? "Loading your repositories…" : "Choose where to create the issue."}
        id="repository"
        onChange={setRepository}
        title="Repository"
        value={selectedRepository}
      >
        {repositories.map((item) => (
          <Form.Dropdown.Item key={item.id} title={item.fullName} value={item.fullName} />
        ))}
      </Form.Dropdown>

      <Form.Separator />

      <Form.TextField
        description="Short summary shown in your issue list."
        id="title"
        onChange={setTitle}
        placeholder="Issue title"
        title="Title"
        value={title}
      />

      <Form.TextArea
        description="Markdown is supported by GitHub. Keep it concise."
        id="body"
        onChange={setBody}
        placeholder="Describe the issue"
        title="Description"
        value={body}
      />
    </Form>
  )
}
