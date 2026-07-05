import { HumanMessage } from "@langchain/core/messages"
import { createHash } from "crypto"
import { z } from "zod/v4"
import type { JingleSummarizationController } from "../../../summarization"
import { readJingleLangChainMessageText } from "../../../../langchain-message-reader"
import type { RuntimeCheckpointState, RuntimeCompaction } from "../../../../runtime-state"
import type {
  RuntimeCompactPlan,
  RuntimeNodeContext,
  RuntimeTargetNode
} from "./node-contract"

const summarizationEventSchema = z
  .object({
    compactionCount: z.number().int().min(1),
    cutoffIndex: z.number(),
    filePath: z.string().nullable(),
    preservedUserMessages: z.array(z.instanceof(HumanMessage)),
    summaryMessage: z.instanceof(HumanMessage),
    warning: z.string().nullable()
  })
  .passthrough()

export interface CompactSummarizeNodeInput {
  readonly plan: RuntimeCompactPlan
}

export type CompactSummarizeUpdate = Pick<RuntimeCheckpointState, "compactions"> &
  Partial<Pick<RuntimeCheckpointState, "messages">> & {
  readonly _summarizationEvent: unknown
  readonly _summarizationSessionId: string
}

export interface CompactSummarizeNodeResult {
  readonly privateState: {
    compactUpdate: CompactSummarizeUpdate
    messageCountAfterCompaction: number
  }
  readonly stateUpdate: CompactSummarizeUpdate
}

export class CompactSummarizeNode
  implements RuntimeTargetNode<CompactSummarizeNodeInput, CompactSummarizeNodeResult>
{
  readonly boundary = "compact"
  readonly kind = "CompactSummarizeNode"

  constructor(private readonly summarization: JingleSummarizationController) {}

  async invoke(
    input: CompactSummarizeNodeInput,
    context: RuntimeNodeContext
  ): Promise<CompactSummarizeNodeResult> {
    const summarized = await this.summarization.compactMessages({
      messages: [...input.plan.messages],
      preserveLastUserMessageCount: input.plan.preserveLastUserMessageCount,
      state: context.state
    })
    const compaction = {
      ...buildCompactionFromSummarizationEvent(summarized.event),
      reason: input.plan.operation.reason ?? null,
      trigger: input.plan.trigger
    }
    const compactUpdate = {
      ...summarized.update,
      compactions: [compaction]
    }

    return {
      privateState: {
        compactUpdate,
        messageCountAfterCompaction: summarized.modelMessages.length
      },
      stateUpdate: compactUpdate
    }
  }
}

function buildCompactionFromSummarizationEvent(event: unknown): RuntimeCompaction {
  const parsed = summarizationEventSchema.safeParse(event)
  if (!parsed.success) {
    throw new Error("[CompactSummarizeNode] Invalid summarization event state.")
  }

  const now = new Date().toISOString()
  const summaryPreview = previewSummaryMessage(parsed.data.summaryMessage)
  const historyRef = parsed.data.filePath
  return {
    compactionId: createCompactionId({
      cutoffIndex: parsed.data.cutoffIndex,
      filePath: historyRef,
      summaryPreview
    }),
    compactionCount: parsed.data.compactionCount,
    cutoffIndex: parsed.data.cutoffIndex,
    createdAt: now,
    historyRef,
    preservedUserMessageCount: parsed.data.preservedUserMessages.length,
    reason: null,
    status: "completed",
    summaryPreview,
    trigger: "jingle_summarization",
    updatedAt: now,
    warning: parsed.data.warning
  }
}

function previewSummaryMessage(summaryMessage: HumanMessage): string | null {
  const text = readJingleLangChainMessageText(summaryMessage.content).replace(/\s+/g, " ").trim()
  return text.length > 0 ? text.slice(0, 240) : null
}

function createCompactionId(input: {
  cutoffIndex: number
  filePath: string | null
  summaryPreview: string | null
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24)
}
