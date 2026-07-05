import { join } from "path"

function dedupePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((entry) => entry.trim()).filter((entry) => entry.length > 0)))
}

export function buildJingleSkillSources(input: {
  configuredSources: string[]
  jingleHomeDir: string
  workspacePath: string
}): string[] {
  return dedupePaths([
    join(input.jingleHomeDir, "skills"),
    join(input.workspacePath, ".jingle", "skills"),
    ...input.configuredSources
  ])
}
