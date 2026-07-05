#!/usr/bin/env node
import { runRaycastAiMigrationPreviewCli } from "../packages/extension-migration/src/preview-raycast-ai-migration.mjs"

runRaycastAiMigrationPreviewCli(process.argv.slice(2))
