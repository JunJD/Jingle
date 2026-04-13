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
      "messages_fts_idx"
    ]
  }
})
