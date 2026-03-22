import { PrismaClient } from "@prisma/client"
import { getDbPath } from "../storage"

let prisma: PrismaClient | null = null

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: `file:${getDbPath()}`
        }
      }
    })
  }

  return prisma
}

export async function closePrismaClient(): Promise<void> {
  if (!prisma) {
    return
  }

  await prisma.$disconnect()
  prisma = null
}
