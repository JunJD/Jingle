import type { ChannelVersions, Checkpoint } from "@langchain/langgraph-checkpoint"

export const JINGLE_LANGGRAPH_MESSAGES_CHANNEL = "messages"
export const JINGLE_LANGGRAPH_PREGEL_TASKS_CHANNEL = "__pregel_tasks"

export type JinglePendingMessagesRef = {
  __jingleRef: "checkpoint-channel"
  channel: "messages"
}

export type JingleStringVersionCheckpoint = Checkpoint & {
  channel_versions: Record<string, string>
  versions_seen: Record<string, Record<string, string>>
}

const JINGLE_PENDING_MESSAGES_REF: JinglePendingMessagesRef = {
  __jingleRef: "checkpoint-channel",
  channel: JINGLE_LANGGRAPH_MESSAGES_CHANNEL
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isJinglePendingMessagesRef(value: unknown): value is JinglePendingMessagesRef {
  return (
    isRecord(value) &&
    value.__jingleRef === JINGLE_PENDING_MESSAGES_REF.__jingleRef &&
    value.channel === JINGLE_PENDING_MESSAGES_REF.channel
  )
}

export function normalizeJinglePregelTaskMessages(value: unknown): unknown {
  if (!isRecord(value)) {
    return value
  }

  const args = value.args
  if (!isRecord(args) || !Object.prototype.hasOwnProperty.call(args, "messages")) {
    return value
  }

  return {
    ...value,
    args: {
      ...args,
      messages: JINGLE_PENDING_MESSAGES_REF
    }
  }
}

export function restoreJinglePregelTaskMessages(value: unknown, messages: unknown): unknown {
  if (!isRecord(value)) {
    return value
  }

  const args = value.args
  if (!isRecord(args) || !isJinglePendingMessagesRef(args.messages)) {
    return value
  }

  return {
    ...value,
    args: {
      ...args,
      messages
    }
  }
}

export function hasJinglePregelTaskMessagesRef(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  const args = value.args
  return isRecord(args) && isJinglePendingMessagesRef(args.messages)
}

export function copyJingleCheckpointManifest(checkpoint: Checkpoint): Omit<Checkpoint, "channel_values"> {
  const manifest = {
    ...checkpoint
  } as Partial<Checkpoint>
  delete manifest.channel_values
  return manifest as Omit<Checkpoint, "channel_values">
}

export function ensureJingleCheckpointChannelVersions(
  checkpoint: Checkpoint,
  newVersions: ChannelVersions
): ChannelVersions {
  const normalizedNewVersions = {
    ...newVersions
  }

  for (const channel of Object.keys(checkpoint.channel_values)) {
    if (checkpoint.channel_versions[channel] !== undefined) {
      continue
    }

    const version = normalizedNewVersions[channel] ?? checkpoint.id
    checkpoint.channel_versions[channel] = version
    normalizedNewVersions[channel] = version
  }

  return normalizedNewVersions
}

export function assertJingleStringChannelVersions(
  owner: string,
  versions: Record<string, string | number>
): asserts versions is Record<string, string> {
  for (const [channel, version] of Object.entries(versions)) {
    if (typeof version !== "string") {
      throw new Error(
        `[JingleCheckpointStorage] ${owner} channel "${channel}" has non-string version "${String(version)}". Clear the stale checkpoint state and rerun.`
      )
    }
  }
}

export function assertJingleStringCheckpointVersions(
  checkpoint: Checkpoint
): asserts checkpoint is JingleStringVersionCheckpoint {
  assertJingleStringChannelVersions("checkpoint", checkpoint.channel_versions)

  for (const [node, versions] of Object.entries(checkpoint.versions_seen)) {
    assertJingleStringChannelVersions(`versions_seen.${node}`, versions)
  }
}
