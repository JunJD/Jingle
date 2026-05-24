import type { AppCopy } from "@/lib/i18n/messages"
import type { ToolApprovalItem } from "@shared/tool-approval"
import { cn } from "@/lib/utils"
import { truncateMiddle } from "./shared"
import {
  ToolChangeList,
  ToolCodeBlock,
  ToolDetailSection,
  ToolDetailStack
} from "./shared-components"

export interface ToolApprovalPresentationMeta {
  subtitle: string | null
  title: string
}

export interface CompactToolApprovalPresentation {
  detail: React.JSX.Element | null
  summary: string | null
  target: string | null
}

export function getToolApprovalPresentationMeta(
  copy: AppCopy,
  approvalItem: ToolApprovalItem | null,
  fallbackToolName?: string
): ToolApprovalPresentationMeta {
  const title = approvalItem
    ? copy.toolCall.labels[approvalItem.toolName] ||
      (approvalItem.kind === "extension_tool" ? approvalItem.toolTitle : null) ||
      fallbackToolName ||
      approvalItem.toolName
    : fallbackToolName
      ? copy.toolCall.labels[fallbackToolName] || fallbackToolName
      : copy.toolCall.approvalItem

  if (!approvalItem) {
    return {
      subtitle: null,
      title
    }
  }

  if (approvalItem.kind === "execute_command") {
    return {
      subtitle: approvalItem.command ? truncateMiddle(approvalItem.command, 96) : null,
      title
    }
  }

  if (approvalItem.kind === "extension_tool") {
    return {
      subtitle: approvalItem.capabilityDisplayName,
      title
    }
  }

  return {
    subtitle: approvalItem.path ? truncateMiddle(approvalItem.path, 96) : null,
    title
  }
}

export function renderToolApprovalOverview(
  copy: AppCopy,
  approvalItem: ToolApprovalItem | null,
  options?: {
    rawArgs?: string
  }
): React.JSX.Element | null {
  const rawArgs = options?.rawArgs ?? ""

  if (!approvalItem && !rawArgs) {
    return null
  }

  return (
    <ToolDetailStack>
      {approvalItem?.kind === "execute_command" && approvalItem.command ? (
        <ToolDetailSection label={copy.toolCall.labels.execute}>
          <ToolCodeBlock>{`$ ${approvalItem.command}`}</ToolCodeBlock>
        </ToolDetailSection>
      ) : null}
      {approvalItem && approvalItem.kind !== "extension_tool" && approvalItem.changes.length > 0 ? (
        <ToolDetailSection label={copy.toolCall.upcomingChanges}>
          <ToolChangeList copy={copy} items={approvalItem.changes} />
        </ToolDetailSection>
      ) : null}
      {(!approvalItem || approvalItem.kind === "extension_tool") && rawArgs ? (
        <ToolDetailSection label={copy.common.rawArguments}>
          <ToolCodeBlock>{rawArgs}</ToolCodeBlock>
        </ToolDetailSection>
      ) : null}
    </ToolDetailStack>
  )
}

function getChangeSummary(copy: AppCopy, approvalItem: ToolApprovalItem | null): string | null {
  if (!approvalItem || approvalItem.kind === "extension_tool") {
    return null
  }

  const changes = approvalItem.changes
  if (changes.length <= 1) {
    return null
  }

  const createCount = changes.filter((change) => change.changeType === "create").length
  const modifyCount = changes.filter((change) => change.changeType === "modify").length
  const deleteCount = changes.filter((change) => change.changeType === "delete").length
  const deltas = [
    createCount > 0 ? `+${createCount}` : null,
    modifyCount > 0 ? `~${modifyCount}` : null,
    deleteCount > 0 ? `-${deleteCount}` : null
  ].filter(Boolean)

  return deltas.length > 0
    ? `${copy.toolCall.compactChangeSummary(changes.length)} ${deltas.join(" ")}`
    : copy.toolCall.compactChangeSummary(changes.length)
}

function getTargetLabel(approvalItem: ToolApprovalItem | null, fallback: string | null): string | null {
  if (approvalItem?.kind === "execute_command") {
    return approvalItem.command
  }

  if (approvalItem?.kind === "file_mutation") {
    return approvalItem.path
  }

  if (approvalItem?.kind === "extension_tool") {
    return approvalItem.capabilityDisplayName || approvalItem.extensionName || approvalItem.toolTitle
  }

  return fallback
}

export function getCompactToolApprovalPresentation(
  copy: AppCopy,
  approvalItem: ToolApprovalItem | null,
  fallbackSubtitle: string | null
): CompactToolApprovalPresentation {
  const summary = getChangeSummary(copy, approvalItem)
  const target = getTargetLabel(approvalItem, fallbackSubtitle)

  return {
    detail: renderCompactToolApprovalDetail(copy, approvalItem, {
      hideSingleTarget: approvalItem?.kind === "file_mutation" && Boolean(target)
    }),
    summary,
    target
  }
}

export function renderCompactToolApprovalDetail(
  copy: AppCopy,
  approvalItem: ToolApprovalItem | null,
  options?: {
    hideSingleTarget?: boolean
  }
): React.JSX.Element | null {
  if (!approvalItem) {
    return null
  }

  if (approvalItem.kind === "extension_tool") {
    return (
      <div className="rounded-[var(--ow-radius-md)] bg-background-secondary/42 px-[var(--ow-space-2-5)] py-[var(--ow-space-2)] [font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-muted-foreground">
        {approvalItem.reason || approvalItem.toolTitle}
      </div>
    )
  }

  if (approvalItem.kind === "execute_command" && approvalItem.command && approvalItem.changes.length === 0) {
    return (
      <pre className="min-w-0 overflow-hidden rounded-[var(--ow-radius-md)] bg-background-secondary/42 px-[var(--ow-space-2-5)] py-[var(--ow-space-2)] font-mono [font-size:var(--ow-font-code)] leading-[var(--ow-line-code)] text-foreground/80">
        {`$ ${approvalItem.command}`}
      </pre>
    )
  }

  if (options?.hideSingleTarget && approvalItem.changes.length <= 1) {
    return null
  }

  const preview = approvalItem.changes.slice(0, 3)
  if (preview.length === 0) {
    return null
  }

  return (
    <div className="grid gap-[var(--ow-space-1)]">
      {preview.map((change) => (
        <div
          key={`${change.changeType}:${change.path}`}
          className="flex min-w-0 items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-md)] bg-background-secondary/42 px-[var(--ow-space-2-5)] py-[var(--ow-space-1-5)]"
        >
          <span
            className={cn(
              "shrink-0 rounded-full px-[var(--ow-space-1-5)] py-[var(--ow-space-0-5)] [font-size:var(--ow-font-caption)] font-medium leading-none",
              change.changeType === "create" &&
                "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              change.changeType === "modify" &&
                "bg-amber-500/10 text-amber-700 dark:text-amber-300",
              change.changeType === "delete" && "bg-destructive/10 text-destructive"
            )}
          >
            {change.changeType === "create"
              ? copy.toolCall.changeCreate
              : change.changeType === "modify"
                ? copy.toolCall.changeModify
                : copy.toolCall.changeDelete}
          </span>
          <span className="min-w-0 truncate font-mono [font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-foreground/78">
            {change.path}
          </span>
        </div>
      ))}
      {approvalItem.changes.length > preview.length ? (
        <div className="px-[var(--ow-space-2-5)] [font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-muted-foreground">
          +{approvalItem.changes.length - preview.length}
        </div>
      ) : null}
    </div>
  )
}
