import type { AppCopy } from "@/lib/i18n/messages"
import type { ToolCall } from "@/types"
import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import type { FileMutationProjection } from "./file-mutation-view-model"

export type ToolComponentStatus =
  | "arguments_streaming"
  | "running"
  | "waiting_result"
  | "complete"
  | "failed"
  | "approval"
export type ToolPresentation = "standalone" | "grouped"

export interface ToolRenderModel {
  args: Record<string, unknown>
  fileMutation: FileMutationProjection | null
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

export interface ToolDisplay {
  detail?: ReactNode | null
  resultMeta?: ReactNode | null
  title: ReactNode
}

interface ToolComponentBaseDefinition {
  name: string
  icon: LucideIcon
  renderDisplay: (props: ToolComponentProps) => ToolDisplay
}

interface ToolComponentSummaryDefinition extends ToolComponentBaseDefinition {
  hasDetail?: undefined
  renderDetail?: undefined
}

interface ToolComponentDetailDefinition extends ToolComponentBaseDefinition {
  hasDetail: (props: ToolComponentProps) => boolean
  renderDetail: (props: ToolComponentProps) => ReactNode
}

export type ToolComponentDefinition =
  | ToolComponentSummaryDefinition
  | ToolComponentDetailDefinition
