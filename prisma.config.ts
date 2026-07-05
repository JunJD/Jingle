import { defineConfig } from "prisma/config"

// SQLite FTS5 virtual tables are created by raw SQL migrations. Prisma does not
// own them as schema models, and their shadow tables must stay external or
// `migrate dev` can generate broken DROP TABLE migrations for the backing tables.
const SQLITE_FTS_EXTERNAL_TABLES = [
  "messages_fts",
  "messages_fts_config",
  "messages_fts_content",
  "messages_fts_data",
  "messages_fts_docsize",
  "messages_fts_idx",
  "messages_fts_trigram",
  "messages_fts_trigram_config",
  "messages_fts_trigram_content",
  "messages_fts_trigram_data",
  "messages_fts_trigram_docsize",
  "messages_fts_trigram_idx",
  "thread_digests_fts",
  "thread_digests_fts_config",
  "thread_digests_fts_content",
  "thread_digests_fts_data",
  "thread_digests_fts_docsize",
  "thread_digests_fts_idx",
  "thread_digests_fts_trigram",
  "thread_digests_fts_trigram_config",
  "thread_digests_fts_trigram_content",
  "thread_digests_fts_trigram_data",
  "thread_digests_fts_trigram_docsize",
  "thread_digests_fts_trigram_idx"
] as const

export default defineConfig({
  experimental: {
    externalTables: true
  },
  schema: "prisma/schema.prisma",
  tables: {
    external: [...SQLITE_FTS_EXTERNAL_TABLES]
  }
})
