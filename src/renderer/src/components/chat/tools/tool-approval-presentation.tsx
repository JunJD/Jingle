import type { AppCopy } from "@/lib/i18n/messages"
import type { ToolApprovalItem } from "@shared/tool-approval"
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

export function getToolApprovalPresentationMeta(
  copy: AppCopy,
  approvalItem: ToolApprovalItem | null,
  fallbackToolName?: string
): ToolApprovalPresentationMeta {
  const title = approvalItem
    ? copy.toolCall.labels[approvalItem.toolName]
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
      {approvalItem && approvalItem.changes.length > 0 ? (
        <ToolDetailSection label={copy.toolCall.upcomingChanges}>
          <ToolChangeList copy={copy} items={approvalItem.changes} />
        </ToolDetailSection>
      ) : null}
      {!approvalItem && rawArgs ? (
        <ToolDetailSection label={copy.common.rawArguments}>
          <ToolCodeBlock>{rawArgs}</ToolCodeBlock>
        </ToolDetailSection>
      ) : null}
    </ToolDetailStack>
  )
}
