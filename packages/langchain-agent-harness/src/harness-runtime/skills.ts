import { ReducedValue, StateSchema } from "@langchain/langgraph"
import { createMiddleware, type AgentMiddleware } from "langchain"
import { parse as parseYaml } from "yaml"
import { z } from "zod/v4"

export interface JingleSkillsFileInfo {
  is_dir?: boolean
  path: string
}

export interface JingleSkillsDownloadResponse {
  content: Uint8Array | null
  error: string | null
  path: string
}

export interface JingleSkillsBackend {
  downloadFiles?(
    paths: string[]
  ): Promise<JingleSkillsDownloadResponse[]> | JingleSkillsDownloadResponse[]
  lsInfo(path: string): Promise<JingleSkillsFileInfo[]> | JingleSkillsFileInfo[]
  read(filePath: string): Promise<string> | string
}

export type JingleSkillsBackendFactory = (config: { state: unknown }) => JingleSkillsBackend

export interface JingleSkillsMiddlewareOptions {
  backend: JingleSkillsBackend | JingleSkillsBackendFactory
  sources: string[]
}

export interface JingleSkillMetadata {
  allowedTools?: string[]
  compatibility?: string | null
  description: string
  license?: string | null
  metadata?: Record<string, string>
  name: string
  path: string
}

const MAX_SKILL_FILE_SIZE = 10 * 1024 * 1024
export const JINGLE_MAX_SKILL_NAME_LENGTH = 64
export const JINGLE_MAX_SKILL_DESCRIPTION_LENGTH = 1024
const MAX_SKILL_COMPATIBILITY_LENGTH = 500

const jingleSkillMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  path: z.string(),
  license: z.string().nullable().optional(),
  compatibility: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  allowedTools: z.array(z.string()).optional()
})

function skillsMetadataReducer(
  current: JingleSkillMetadata[] | undefined,
  update: JingleSkillMetadata[] | undefined
): JingleSkillMetadata[] {
  if (!update || update.length === 0) {
    return current ?? []
  }
  if (!current || current.length === 0) {
    return update
  }

  const merged = new Map<string, JingleSkillMetadata>()
  for (const skill of current) {
    merged.set(skill.name, skill)
  }
  for (const skill of update) {
    merged.set(skill.name, skill)
  }
  return Array.from(merged.values())
}

const jingleSkillsMetadataValue = new ReducedValue(
  z.array(jingleSkillMetadataSchema).default(() => []),
  {
    inputSchema: z.array(jingleSkillMetadataSchema).optional(),
    reducer: skillsMetadataReducer
  }
)

export const jingleSkillsStateSchema = new StateSchema({
  skillsMetadata: jingleSkillsMetadataValue
})

const JINGLE_SKILLS_SYSTEM_PROMPT = `
## Skills System

You have access to a skills library that provides specialized capabilities and domain knowledge.

{skills_locations}

**Available Skills:**

{skills_list}

**How to Use Skills (Progressive Disclosure):**

Skills follow a **progressive disclosure** pattern - you know they exist (name + description above), but you only read the full instructions when needed:

1. **Recognize when a skill applies**: Check if the user's task matches any skill's description
2. **Read the skill's full instructions**: The skill list above shows the exact path to use with read_file
3. **Follow the skill's instructions**: SKILL.md contains step-by-step workflows, best practices, and examples
4. **Access supporting files**: Skills may include Python scripts, configs, or reference docs - use absolute paths

**When to Use Skills:**
- When the user's request matches a skill's domain (for example, "research X" -> web-research skill)
- When you need specialized knowledge or structured workflows
- When a skill provides proven patterns for complex tasks

**Skills are Self-Documenting:**
- Each SKILL.md tells you exactly what the skill does and how to use it
- The skill list above shows the full path for each skill's SKILL.md file

**Executing Skill Scripts:**
Skills may contain Python scripts or other executable files. Always use absolute paths from the skill list.

**Example Workflow:**

User: "Can you research the latest developments in quantum computing?"

1. Check available skills above and find the matching skill with its full path
2. Read the skill using the path shown in the list
3. Follow the skill's research workflow
4. Use any helper scripts with absolute paths

Remember: Skills are tools to make you more capable and consistent. When in doubt, check if a skill exists for the task!
`

function validateSkillName(
  name: string,
  directoryName: string
): {
  error: string
  valid: boolean
} {
  if (!name) {
    return {
      valid: false,
      error: "name is required"
    }
  }
  if (name.length > JINGLE_MAX_SKILL_NAME_LENGTH) {
    return {
      valid: false,
      error: "name exceeds 64 characters"
    }
  }
  if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) {
    return {
      valid: false,
      error: "name must be lowercase alphanumeric with single hyphens only"
    }
  }
  for (const character of name) {
    if (character === "-") {
      continue
    }
    if (/\p{Ll}/u.test(character) || /\p{Nd}/u.test(character)) {
      continue
    }
    return {
      valid: false,
      error: "name must be lowercase alphanumeric with single hyphens only"
    }
  }
  if (name !== directoryName) {
    return {
      valid: false,
      error: `name '${name}' must match directory name '${directoryName}'`
    }
  }
  return {
    valid: true,
    error: ""
  }
}

function validateMetadata(raw: unknown, skillPath: string): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    if (raw) {
      console.warn(`Ignoring non-object metadata in ${skillPath} (got ${typeof raw})`)
    }
    return {}
  }

  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    result[String(key)] = String(value)
  }
  return result
}

function formatSkillAnnotations(skill: JingleSkillMetadata): string {
  const parts: string[] = []
  if (skill.license) {
    parts.push(`License: ${skill.license}`)
  }
  if (skill.compatibility) {
    parts.push(`Compatibility: ${skill.compatibility}`)
  }
  return parts.join(", ")
}

export function parseJingleSkillMetadataFromContent(
  content: string,
  skillPath: string,
  directoryName: string
): JingleSkillMetadata | null {
  if (content.length > MAX_SKILL_FILE_SIZE) {
    console.warn(`Skipping ${skillPath}: content too large (${content.length} bytes)`)
    return null
  }

  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)
  if (!match) {
    console.warn(`Skipping ${skillPath}: no valid YAML frontmatter found`)
    return null
  }

  let frontmatterData: unknown
  try {
    frontmatterData = parseYaml(match[1])
  } catch (error) {
    console.warn(`Invalid YAML in ${skillPath}:`, error)
    return null
  }

  if (!frontmatterData || typeof frontmatterData !== "object") {
    console.warn(`Skipping ${skillPath}: frontmatter is not a mapping`)
    return null
  }

  const frontmatter = frontmatterData as Record<string, unknown>
  const name = String(frontmatter.name ?? "").trim()
  const description = String(frontmatter.description ?? "").trim()
  if (!name || !description) {
    console.warn(`Skipping ${skillPath}: missing required 'name' or 'description'`)
    return null
  }

  const validation = validateSkillName(name, directoryName)
  if (!validation.valid) {
    console.warn(
      `Skill '${name}' in ${skillPath} does not follow Agent Skills specification: ${validation.error}. Consider renaming for spec compliance.`
    )
  }

  let descriptionString = description
  if (descriptionString.length > JINGLE_MAX_SKILL_DESCRIPTION_LENGTH) {
    console.warn(
      `Description exceeds ${JINGLE_MAX_SKILL_DESCRIPTION_LENGTH} characters in ${skillPath}, truncating`
    )
    descriptionString = descriptionString.slice(0, JINGLE_MAX_SKILL_DESCRIPTION_LENGTH)
  }

  const rawTools = frontmatter["allowed-tools"]
  let allowedTools: string[]
  if (rawTools) {
    allowedTools = Array.isArray(rawTools)
      ? rawTools.map((toolName) => String(toolName).trim()).filter(Boolean)
      : String(rawTools).split(/\s+/).filter(Boolean)
  } else {
    allowedTools = []
  }

  let compatibilityString = String(frontmatter.compatibility ?? "").trim() || null
  if (compatibilityString && compatibilityString.length > MAX_SKILL_COMPATIBILITY_LENGTH) {
    console.warn(
      `Compatibility exceeds ${MAX_SKILL_COMPATIBILITY_LENGTH} characters in ${skillPath}, truncating`
    )
    compatibilityString = compatibilityString.slice(0, MAX_SKILL_COMPATIBILITY_LENGTH)
  }

  return {
    name,
    description: descriptionString,
    path: skillPath,
    metadata: validateMetadata(frontmatter.metadata ?? {}, skillPath),
    license: String(frontmatter.license ?? "").trim() || null,
    compatibility: compatibilityString,
    allowedTools
  }
}

export async function listJingleSkillsFromBackend(
  backend: JingleSkillsBackend,
  sourcePath: string
): Promise<JingleSkillMetadata[]> {
  const skills: JingleSkillMetadata[] = []
  const pathSeparator = sourcePath.includes("\\") ? "\\" : "/"
  const normalizedPath =
    sourcePath.endsWith("/") || sourcePath.endsWith("\\")
      ? sourcePath
      : `${sourcePath}${pathSeparator}`

  let fileInfos: JingleSkillsFileInfo[]
  try {
    fileInfos = await backend.lsInfo(normalizedPath)
  } catch {
    return []
  }

  const entries = fileInfos.map((info) => ({
    name:
      info.path
        .replace(/[/\\]$/, "")
        .split(/[/\\]/)
        .pop() || "",
    type: info.is_dir ? "directory" : "file"
  }))

  for (const entry of entries) {
    if (entry.type !== "directory") {
      continue
    }

    const skillMdPath = `${normalizedPath}${entry.name}${pathSeparator}SKILL.md`
    let content: string
    if (backend.downloadFiles) {
      const results = await backend.downloadFiles([skillMdPath])
      if (results.length !== 1) {
        continue
      }
      const response = results[0]
      if (response.error != null || response.content == null) {
        continue
      }
      content = new TextDecoder().decode(response.content)
    } else {
      const readResult = await backend.read(skillMdPath)
      if (readResult.startsWith("Error:")) {
        continue
      }
      content = readResult
    }

    const metadata = parseJingleSkillMetadataFromContent(content, skillMdPath, entry.name)
    if (metadata) {
      skills.push(metadata)
    }
  }

  return skills
}

function formatSkillsLocations(sources: readonly string[]): string {
  if (sources.length === 0) {
    return "**Skills Sources:** None configured"
  }

  const lines: string[] = []
  for (let index = 0; index < sources.length; index += 1) {
    const sourcePath = sources[index]
    const name =
      sourcePath
        .replace(/[/\\]$/, "")
        .split(/[/\\]/)
        .filter(Boolean)
        .pop()
        ?.replace(/^./, (character) => character.toUpperCase()) || "Skills"
    const suffix = index === sources.length - 1 ? " (higher priority)" : ""
    lines.push(`**${name} Skills**: \`${sourcePath}\`${suffix}`)
  }
  return lines.join("\n")
}

function formatSkillsList(
  skills: readonly JingleSkillMetadata[],
  sources: readonly string[]
): string {
  if (skills.length === 0) {
    return `(No skills available yet. You can create skills in ${sources
      .map((source) => `\`${source}\``)
      .join(" or ")})`
  }

  const lines: string[] = []
  for (const skill of skills) {
    const annotations = formatSkillAnnotations(skill)
    let descriptionLine = `- **${skill.name}**: ${skill.description}`
    if (annotations) {
      descriptionLine += ` (${annotations})`
    }
    lines.push(descriptionLine)
    if (skill.allowedTools && skill.allowedTools.length > 0) {
      lines.push(`  -> Allowed tools: ${skill.allowedTools.join(", ")}`)
    }
    lines.push(`  -> Read \`${skill.path}\` for full instructions`)
  }
  return lines.join("\n")
}

function getBackend(
  backend: JingleSkillsBackend | JingleSkillsBackendFactory,
  state: unknown
): JingleSkillsBackend {
  return typeof backend === "function" ? backend({ state }) : backend
}

export function createJingleSkillsMiddleware(
  options: JingleSkillsMiddlewareOptions
): AgentMiddleware {
  const { backend, sources } = options
  let loadedSkills: JingleSkillMetadata[] = []

  return createMiddleware({
    name: "JingleSkillsMiddleware",
    stateSchema: jingleSkillsStateSchema,
    async beforeAgent(state) {
      if (loadedSkills.length > 0) {
        return undefined
      }

      if (
        "skillsMetadata" in state &&
        Array.isArray(state.skillsMetadata) &&
        state.skillsMetadata.length > 0
      ) {
        loadedSkills = state.skillsMetadata as JingleSkillMetadata[]
        return undefined
      }

      const resolvedBackend = getBackend(backend, state)
      const allSkills = new Map<string, JingleSkillMetadata>()
      for (const sourcePath of sources) {
        try {
          const skills = await listJingleSkillsFromBackend(resolvedBackend, sourcePath)
          for (const skill of skills) {
            allSkills.set(skill.name, skill)
          }
        } catch (error) {
          console.debug(`[JingleSkillsMiddleware] Failed to load skills from ${sourcePath}:`, error)
        }
      }

      loadedSkills = Array.from(allSkills.values())
      return { skillsMetadata: loadedSkills }
    },
    wrapModelCall(request, handler) {
      const skillsMetadata =
        loadedSkills.length > 0
          ? loadedSkills
          : ((request.state?.skillsMetadata ?? []) as JingleSkillMetadata[])
      const skillsLocations = formatSkillsLocations(sources)
      const skillsList = formatSkillsList(skillsMetadata, sources)
      const skillsSection = JINGLE_SKILLS_SYSTEM_PROMPT.replace(
        "{skills_locations}",
        skillsLocations
      ).replace("{skills_list}", skillsList)
      return handler({
        ...request,
        systemMessage: request.systemMessage.concat(skillsSection)
      })
    }
  })
}
