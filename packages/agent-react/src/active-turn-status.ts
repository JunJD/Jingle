import type { JingleAgentRunPhase } from "@jingle/agent-client"

export type JingleActiveRunCoachPlacement =
  | "after_entries"
  | "before_entries"
  | "inside_latest_agent_activity"

export type JingleActiveRunCoachStatusKind = "thinking" | "waiting_approval"

export type JingleRunCoachTipId =
  | "iterate_after_first_draft"
  | "keep_followups_in_thread"
  | "start_with_outcome"

export interface JingleRunCoachTipProjection {
  id: JingleRunCoachTipId
}

export interface JingleActiveTurnStatusEntrySource {
  kind: string
  toolCallIds?: readonly string[]
}

export interface JingleActiveTurnStatusProjection {
  coachTip: JingleRunCoachTipProjection | null
  kind: JingleActiveRunCoachStatusKind
  placement: JingleActiveRunCoachPlacement
  toolCallId: string | null
}

export function projectJingleRunCoachTip(input: {
  kind: JingleActiveRunCoachStatusKind
  placement: JingleActiveRunCoachPlacement
}): JingleRunCoachTipProjection | null {
  if (input.kind !== "thinking") {
    return null
  }

  switch (input.placement) {
    case "before_entries":
      return { id: "start_with_outcome" }
    case "inside_latest_agent_activity":
      return { id: "keep_followups_in_thread" }
    case "after_entries":
      return { id: "iterate_after_first_draft" }
  }
}

function entriesContainToolCall(
  entries: readonly JingleActiveTurnStatusEntrySource[],
  toolCallId: string
): boolean {
  return entries.some((entry) => entry.toolCallIds?.includes(toolCallId) ?? false)
}

export function projectJingleActiveTurnStatus(input: {
  activeRunPhase?: JingleAgentRunPhase | null
  entries: readonly JingleActiveTurnStatusEntrySource[]
  isStreaming: boolean
  pendingApprovalToolCallId?: string | null
}): JingleActiveTurnStatusProjection | null {
  if (!input.isStreaming) {
    return null
  }

  const activeRunPhase = input.activeRunPhase ?? null
  const placement = input.entries.length > 0 ? "after_entries" : "before_entries"
  const latestEntry = input.entries.at(-1)

  if (latestEntry?.kind === "thinking") {
    return null
  }

  const pendingApprovalToolCallId = input.pendingApprovalToolCallId ?? null
  if (activeRunPhase === "waiting_tool_result" && pendingApprovalToolCallId) {
    if (entriesContainToolCall(input.entries, pendingApprovalToolCallId)) {
      return null
    }

    return {
      coachTip: null,
      kind: "waiting_approval",
      placement,
      toolCallId: pendingApprovalToolCallId
    }
  }

  if (
    latestEntry?.kind === "agent-activity" &&
    (activeRunPhase === "thinking" ||
      activeRunPhase === "tool_running" ||
      activeRunPhase === "streaming")
  ) {
    const activeStatus = {
      kind: "thinking",
      placement: "inside_latest_agent_activity",
      toolCallId: null
    } satisfies Omit<JingleActiveTurnStatusProjection, "coachTip">

    return {
      ...activeStatus,
      coachTip: projectJingleRunCoachTip(activeStatus)
    }
  }

  const isPreContentStreaming = activeRunPhase === "streaming" && input.entries.length === 0
  if (activeRunPhase !== "thinking" && !isPreContentStreaming) {
    return null
  }

  const activeStatus = {
    kind: "thinking",
    placement,
    toolCallId: null
  } satisfies Omit<JingleActiveTurnStatusProjection, "coachTip">

  return {
    ...activeStatus,
    coachTip: projectJingleRunCoachTip(activeStatus)
  }
}
