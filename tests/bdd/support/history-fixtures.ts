import { randomUUID } from "node:crypto"
import { emptyCheckpoint } from "@langchain/langgraph-checkpoint"
import { PrismaCheckpointSaver } from "../../../src/main/checkpointer/prisma-saver"
import { closeDatabase, createThread, initializeDatabase, updateThread } from "../../../src/main/db"
import { getPrismaClient } from "../../../src/main/db/client"

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

export async function seedHistoryThreadFixture(params: {
  messages?: string[]
  title: string
}): Promise<{ threadId: string }> {
  await closeDatabase()
  await initializeDatabase()

  const threadId = randomUUID()
  await createThread(threadId)
  await updateThread(threadId, { title: params.title })
  await getPrismaClient().thread.update({
    where: {
      threadId
    },
    data: {
      updatedAt: getNextUpdatedAt()
    }
  })

  if (params.messages && params.messages.length > 0) {
    const checkpoint = emptyCheckpoint()
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
