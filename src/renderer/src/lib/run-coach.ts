export type ActiveRunCoachPlacement =
  | "after_entries"
  | "before_entries"
  | "inside_latest_agent_activity"

export type ActiveRunCoachStatusKind = "thinking" | "waiting_approval"

export type RunCoachTipId =
  | "iterate_after_first_draft"
  | "keep_followups_in_thread"
  | "start_with_outcome"

export interface RunCoachTipProjection {
  id: RunCoachTipId
}

export function projectRunCoachTip(input: {
  kind: ActiveRunCoachStatusKind
  placement: ActiveRunCoachPlacement
}): RunCoachTipProjection | null {
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
