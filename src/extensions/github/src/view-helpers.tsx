import {
  AlertCircle,
  CheckCircle2,
  Circle,
  CircleDotDashed,
  Clock3,
  GitFork,
  GitPullRequest,
  Lock,
  MessageSquare,
  Star
} from "lucide-react"
import type { ReactNode } from "react"
import type { GitHubIssueLike, GitHubRepository, GitHubWorkflowRun } from "./client"

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
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
      <span>{item.repositoryName}</span>
      {item.comments > 0 ? (
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          {item.comments}
        </span>
      ) : null}
      {item.isDraft ? <span>Draft</span> : null}
    </div>
  )
}

export function getRepositoryAccessories(
  repository: GitHubRepository,
  displayOwnerName: boolean
): ReactNode {
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
      {displayOwnerName ? <span>{repository.ownerLogin}</span> : null}
      {repository.language ? <span>{repository.language}</span> : null}
      <span className="inline-flex items-center gap-1">
        <Star className="h-3 w-3" />
        {repository.stars}
      </span>
      <span className="inline-flex items-center gap-1">
        <GitFork className="h-3 w-3" />
        {repository.forks}
      </span>
      {repository.isPrivate ? (
        <span className="inline-flex items-center gap-1">
          <Lock className="h-3 w-3" />
          Private
        </span>
      ) : null}
    </div>
  )
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
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
      {run.headBranch ? <span>{run.headBranch}</span> : null}
      {run.headSha ? <span>{run.headSha.slice(0, 7)}</span> : null}
      <span>#{run.runNumber}</span>
    </div>
  )
}
