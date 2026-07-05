export const AGENT_FOLLOW_UP_MODES = ["queue", "steer"] as const

export type AgentFollowUpMode = (typeof AGENT_FOLLOW_UP_MODES)[number]
export type AgentFollowUpAction = Extract<AgentFollowUpMode, "steer">

export const DEFAULT_AGENT_FOLLOW_UP_MODE: AgentFollowUpMode = "queue"

export function normalizeAgentFollowUpMode(value: unknown): AgentFollowUpMode {
  return value === "steer" ? "steer" : DEFAULT_AGENT_FOLLOW_UP_MODE
}
