import { randomUUID } from "node:crypto"
import { emptyCheckpoint } from "@langchain/langgraph-checkpoint"
import { presentArtifacts } from "../../../src/main/artifacts/service"
import { PrismaCheckpointSaver } from "../../../src/main/checkpointer/prisma-saver"
import { closeDatabase, createThread, initializeDatabase } from "../../../src/main/db"
import { getPrismaClient } from "../../../src/main/db/client"
import { getToolCallArtifactKey } from "../../../src/shared/artifacts"

let nextUpdatedAt = Date.now()

function getNextUpdatedAt(): bigint {
  nextUpdatedAt = Math.max(nextUpdatedAt + 1, Date.now())
  return BigInt(nextUpdatedAt)
}

function createCheckpointMessage(params: { content: string; id: string; role: "ai" | "human" }): {
  id: string[]
  kwargs: {
    content: string
    id: string
  }
  type: "ai" | "human"
} {
  return {
    id: [params.role === "human" ? "HumanMessage" : "AIMessage"],
    kwargs: {
      content: params.content,
      id: params.id
    },
    type: params.role
  }
}

function createAssistantToolCallCheckpointMessage(params: {
  id: string
  toolCalls: Array<{
    args: Record<string, unknown>
    id: string
    name: string
  }>
}): {
  id: string[]
  kwargs: {
    content: string
    id: string
    tool_calls: Array<{
      args: Record<string, unknown>
      id: string
      name: string
    }>
  }
  type: "ai"
} {
  return {
    id: ["AIMessage"],
    kwargs: {
      content: "",
      id: params.id,
      tool_calls: params.toolCalls
    },
    type: "ai"
  }
}

function createToolResultCheckpointMessage(params: {
  content: string
  id: string
  name: string
  toolCallId: string
}): {
  id: string[]
  kwargs: {
    content: string
    id: string
    name: string
    tool_call_id: string
  }
  type: "tool"
} {
  return {
    id: ["ToolMessage"],
    kwargs: {
      content: params.content,
      id: params.id,
      name: params.name,
      tool_call_id: params.toolCallId
    },
    type: "tool"
  }
}

async function touchThreadUpdatedAt(threadId: string): Promise<void> {
  await getPrismaClient().thread.update({
    where: {
      threadId
    },
    data: {
      updatedAt: getNextUpdatedAt()
    }
  })
}

export async function seedHistoryThreadFixture(params: {
  metadata?: Record<string, unknown>
  messages?: string[]
  title: string
}): Promise<{ threadId: string }> {
  await closeDatabase()
  await initializeDatabase()

  const threadId = randomUUID()
  await createThread(threadId, { metadata: params.metadata, title: params.title })
  await touchThreadUpdatedAt(threadId)

  if (params.messages && params.messages.length > 0) {
    const checkpoint = emptyCheckpoint()
    checkpoint.id = `${threadId}:checkpoint:history`
    checkpoint.channel_values = {
      messages: params.messages.flatMap((message, index) => [
        createCheckpointMessage({
          content: message,
          id: `${threadId}:user:${index}`,
          role: "human"
        }),
        createCheckpointMessage({
          content: `Ack: ${message}`,
          id: `${threadId}:assistant:${index}`,
          role: "ai"
        })
      ])
    }
    checkpoint.channel_versions = {
      messages: `${threadId}:messages:history`
    }

    const saver = new PrismaCheckpointSaver()
    await saver.put(
      {
        configurable: {
          thread_id: threadId
        }
      },
      checkpoint,
      {
        parents: {},
        source: "update",
        step: 0
      }
    )
  }

  return { threadId }
}

export async function seedHistoryThreadWithArtifactFixture(params: {
  artifactText?: string
  artifactTitle: string
  metadata?: Record<string, unknown>
  title: string
  userMessage?: string
}): Promise<{ artifactId: string; threadId: string; toolCallId: string }> {
  await closeDatabase()
  await initializeDatabase()

  const threadId = randomUUID()
  const toolCallId = `tool-call:${randomUUID()}`
  const userMessage = params.userMessage ?? "Need an artifact preview"
  const assistantMessageId = `${threadId}:assistant:present-artifacts`
  const toolResultMessageId = `${threadId}:tool:present-artifacts`
  const artifactText = params.artifactText ?? `Summary content for ${params.artifactTitle}`
  const toolArgs = {
    artifacts: [
      {
        kind: "summary",
        text: artifactText,
        title: params.artifactTitle
      }
    ]
  }

  await createThread(threadId, { metadata: params.metadata, title: params.title })
  await touchThreadUpdatedAt(threadId)

  const checkpoint = emptyCheckpoint()
  checkpoint.id = `${threadId}:checkpoint:artifact`
  checkpoint.channel_values = {
    messages: [
      createCheckpointMessage({
        content: userMessage,
        id: `${threadId}:user:0`,
        role: "human"
      }),
      createAssistantToolCallCheckpointMessage({
        id: assistantMessageId,
        toolCalls: [
          {
            args: toolArgs,
            id: toolCallId,
            name: "present_artifacts"
          }
        ]
      }),
      createToolResultCheckpointMessage({
        content: `Presented artifact: ${params.artifactTitle}`,
        id: toolResultMessageId,
        name: "present_artifacts",
        toolCallId
      })
    ]
  }
  checkpoint.channel_versions = {
    messages: `${threadId}:messages:artifact`
  }

  const saver = new PrismaCheckpointSaver()
  await saver.put(
    {
      configurable: {
        thread_id: threadId
      }
    },
    checkpoint,
    {
      parents: {},
      source: "update",
      step: 0
    }
  )

  const presentation = await presentArtifacts({
    artifacts: [
      {
        artifactKey: getToolCallArtifactKey(toolCallId, 0),
        kind: "summary",
        text: artifactText,
        title: params.artifactTitle
      }
    ],
    idempotencyKey: toolCallId,
    messageId: assistantMessageId,
    threadId,
    toolCallId
  })

  if (presentation.type === "idempotency-conflict") {
    throw new Error(`Unexpected artifact idempotency conflict for ${toolCallId}`)
  }

  const artifact = presentation.artifacts[0]
  if (!artifact) {
    throw new Error(`Artifact fixture for thread ${threadId} did not create an artifact.`)
  }

  await touchThreadUpdatedAt(threadId)

  return {
    artifactId: artifact.id,
    threadId,
    toolCallId
  }
}
