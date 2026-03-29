import type { AppCopy } from "@/lib/i18n/messages"
import type { HITLRequest, ToolCall } from "@/types"
import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

export type ToolComponentStatus = "running" | "success" | "error" | "approval"
export type ToolPresentation = "standalone" | "grouped"

export interface ToolRenderModel {
  args: Record<string, unknown>
  errorDetail: string | null
  hasResult: boolean
  rawArgs: string
  rawResult: string
  result?: unknown
  status: ToolComponentStatus
}

export interface ToolComponentProps extends ToolRenderModel {
  copy: AppCopy
  presentation: ToolPresentation
  toolCall: ToolCall
  isExpanded: boolean
}

export interface ToolComponentDefinition {
  name: string
  icon: LucideIcon
  renderSummary: (props: ToolComponentProps) => ReactNode
  renderDetail?: (props: ToolComponentProps) => ReactNode
}

export type HumanInTheLoopRespond = (decision: "approve" | "reject" | "edit") => void

export interface HumanInTheLoopProps extends ToolComponentProps {
  request: HITLRequest
  respond: HumanInTheLoopRespond
}

export interface HumanInTheLoopDefinition {
  icon: LucideIcon
  name: string
  render: (props: HumanInTheLoopProps) => ReactNode
}
