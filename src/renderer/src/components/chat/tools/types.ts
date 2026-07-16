import type { AppCopy } from "@/lib/i18n/messages"
import type { ToolCall } from "@/types"
import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import type { FileMutationProjection } from "./file-mutation-view-model"
import type { JingleAgentToolExecutionViewStatus } from "@jingle/agent-react"

export type ToolComponentStatus = JingleAgentToolExecutionViewStatus
export type ToolPresentation = "standalone" | "grouped"

export interface RawToolProjectionFacts {
  args: Record<string, unknown>
  fileMutation: FileMutationProjection | null
  rawArgs: string
  rawResult: string
  result?: unknown
  status: ToolComponentStatus
}

export interface ToolProjectionInput extends RawToolProjectionFacts {
  threadId: string
  toolCall: ToolCall
}

export interface ToolRendererCommands {
  openArtifact: (artifactId: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
}

export interface ToolRenderContext {
  commands: ToolRendererCommands
  copy: AppCopy
}

export interface ToolComponentProps<TViewModel> extends ToolRenderContext {
  viewModel: TViewModel
}

export interface ToolDisplay {
  detail?: ReactNode | null
  resultMeta?: ReactNode | null
  title: ReactNode
}

interface ToolComponentBaseSpecification<TViewModel> {
  name: string
  icon: LucideIcon
  project: (input: ToolProjectionInput) => TViewModel
  renderDisplay: (props: ToolComponentProps<TViewModel>) => ToolDisplay
}

interface ToolComponentSummarySpecification<
  TViewModel
> extends ToolComponentBaseSpecification<TViewModel> {
  hasDetail?: undefined
  renderDetail?: undefined
}

interface ToolComponentDetailSpecification<
  TViewModel
> extends ToolComponentBaseSpecification<TViewModel> {
  hasDetail: (props: ToolComponentProps<TViewModel>) => boolean
  renderDetail: (props: ToolComponentProps<TViewModel>) => ReactNode
}

export type ToolComponentSpecification<TViewModel> =
  | ToolComponentSummarySpecification<TViewModel>
  | ToolComponentDetailSpecification<TViewModel>

export interface ProjectedToolComponent {
  hasDetail: (context: ToolRenderContext) => boolean
  renderDetail: (context: ToolRenderContext) => ReactNode
  renderDisplay: (context: ToolRenderContext) => ToolDisplay
}

export interface ToolComponentDefinition {
  icon: LucideIcon
  name: string
  project: (input: ToolProjectionInput) => ProjectedToolComponent
}
