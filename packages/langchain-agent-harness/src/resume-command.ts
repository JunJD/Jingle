import { Command } from "@langchain/langgraph"
import type { RuntimeRecordingRef } from "./runtime-state"
import {
  buildJingleResolvedApprovalFact,
  type JingleApprovalDecision,
  type JingleApprovalDecisionType
} from "./approval-lifecycle"

export interface JingleResumeDecision extends JingleApprovalDecision {}

export interface BuildJingleResumeCommandInput<TContextInclusion = unknown> {
  contextInclusions?: TContextInclusion[]
  decision: JingleResumeDecision
  recordingRefs?: RuntimeRecordingRef[]
}

interface JingleResumeValue {
  decisions: Array<{
    feedback?: string
    type: JingleApprovalDecisionType
  }>
}

function buildJingleResumeValue(decision: JingleResumeDecision): JingleResumeValue {
  return {
    decisions: [
      {
        type: decision.type,
        ...(decision.feedback ? { feedback: decision.feedback } : {})
      }
    ]
  }
}

export function buildJingleResumeCommand<TContextInclusion>(
  input: BuildJingleResumeCommandInput<TContextInclusion>
): Command {
  const update = {
    approvals: [buildJingleResolvedApprovalFact(input.decision)],
    ...(input.contextInclusions && input.contextInclusions.length > 0
      ? { contextInclusions: input.contextInclusions }
      : {}),
    ...(input.recordingRefs && input.recordingRefs.length > 0
      ? { recordingRefs: input.recordingRefs }
      : {})
  }

  return new Command({
    resume: buildJingleResumeValue(input.decision),
    update
  })
}
