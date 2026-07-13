import { closeDatabase, initializeDatabase } from "./lifecycle"

export async function auditDatabaseBootstrap(): Promise<void> {
  try {
    await initializeDatabase()
  } finally {
    await closeDatabase()
  }
}
