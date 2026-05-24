import { defineConfig } from "prisma/config"

export default defineConfig({
  experimental: {
    externalTables: true
  },
  schema: "prisma/schema.prisma",
  tables: {
    external: [
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
      "messages_fts_trigram_idx"
    ]
  }
})
