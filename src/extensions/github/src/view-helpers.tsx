import {
  AlertCircle,
  CheckCircle2,
  Circle,
  CircleDotDashed,
  Clock3,
  GitPullRequest
} from "lucide-react"
import type { ReactNode } from "react"
import type { GitHubIssueLike, GitHubRepository, GitHubWorkflowRun } from "./client-core"

export function formatUpdatedAt(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp)
  if (Number.isNaN(parsed.getTime())) {
    return ""
  }

  return `Updated ${parsed.toLocaleString()}`
}

export function formatResultCount(count: number, singular: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${singular}s`
}

export function getIssueLikeIcon(item: GitHubIssueLike): ReactNode {
  if (item.kind === "pull_request") {
    return (
      <GitPullRequest
        className={`h-4 w-4 ${item.state === "closed" ? "text-muted-foreground" : "text-sky-500"}`}
      />
    )
  }

  if (item.state === "closed") {
    return <AlertCircle className="h-4 w-4 text-muted-foreground" />
  }

  return <CircleDotDashed className="h-4 w-4 text-emerald-500" />
}

export function getIssueLikeAccessories(item: GitHubIssueLike): ReactNode {
  const parts = [item.repositoryName]
  if (item.comments > 0) {
    parts.push(`${item.comments} comments`)
  }
  if (item.isDraft) {
    parts.push("Draft")
  }

  return parts.join(" · ")
}

export function getRepositoryAccessories(
  repository: GitHubRepository,
  displayOwnerName: boolean
): ReactNode {
  const parts: string[] = []
  if (displayOwnerName) {
    parts.push(repository.ownerLogin)
  }
  if (repository.language) {
    parts.push(repository.language)
  }

  parts.push(`${repository.stars} stars`, `${repository.forks} forks`)
  if (repository.isPrivate) {
    parts.push("Private")
  }

  return parts.join(" · ")
}

export function getWorkflowRunIcon(run: GitHubWorkflowRun): ReactNode {
  if (run.status === "completed") {
    if (run.conclusion === "success") {
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    }

    if (run.conclusion === "failure" || run.conclusion === "startup_failure") {
      return <AlertCircle className="h-4 w-4 text-red-500" />
    }

    return <Circle className="h-4 w-4 text-muted-foreground" />
  }

  if (run.status === "in_progress") {
    return <Clock3 className="h-4 w-4 text-amber-500" />
  }

  if (run.status === "queued" || run.status === "requested" || run.status === "waiting") {
    return <Circle className="h-4 w-4 text-amber-500" />
  }

  return <Circle className="h-4 w-4 text-muted-foreground" />
}

export function getWorkflowRunAccessories(run: GitHubWorkflowRun): ReactNode {
  return [run.headBranch, run.headSha ? run.headSha.slice(0, 7) : null, `#${run.runNumber}`]
    .filter((value): value is string => Boolean(value))
    .join(" · ")
}
