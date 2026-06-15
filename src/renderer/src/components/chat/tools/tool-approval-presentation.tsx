import type { AppCopy } from "@/lib/i18n/messages"
import type { ToolApprovalItem } from "@shared/tool-approval"
import { truncateMiddle } from "./shared"
import { buildChangeListFileMutationViewModel } from "./file-mutation-view-model"
import { PierreFileMutationView } from "./PierreFileMutationView"

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
  fallbackSubtitle: string | null,
  toolCallId: string
): CompactToolApprovalPresentation {
  const summary = getChangeSummary(copy, approvalItem)
  const target = getTargetLabel(approvalItem, fallbackSubtitle)

  return {
    detail: renderCompactToolApprovalDetail(approvalItem, toolCallId, {
      hideSingleTarget: approvalItem?.kind === "file_mutation" && Boolean(target)
    }),
    summary,
    target
  }
}

export function renderCompactToolApprovalDetail(
  approvalItem: ToolApprovalItem | null,
  toolCallId: string,
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

  const changesViewModel = buildChangeListFileMutationViewModel({
    changes: approvalItem.changes,
    source: "approval_preview",
    status: "pending",
    toolCallId
  })

  return changesViewModel ? (
    <PierreFileMutationView compact viewModel={changesViewModel} />
  ) : null
}
