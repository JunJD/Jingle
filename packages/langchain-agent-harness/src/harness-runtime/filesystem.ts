import { ToolMessage, type BaseMessage } from "@langchain/core/messages"
import { Command, isCommand, ReducedValue, StateSchema } from "@langchain/langgraph"
import { createMiddleware, tool, type AgentMiddleware, type ToolRuntime } from "langchain"
import { z } from "zod/v4"

export interface JingleFilesystemFileInfo {
  is_dir?: boolean
  modified_at?: string
  path: string
  size?: number
}

export interface JingleFilesystemGrepMatch {
  line: number
  path: string
  text: string
}

export interface JingleFilesystemFileData {
  content: string[]
  created_at: string
  modified_at: string
}

export interface JingleFilesystemWriteResult {
  error?: string
  filesUpdate?: Record<string, JingleFilesystemFileData> | null
  metadata?: Record<string, unknown>
  path?: string
}

export interface JingleFilesystemEditResult extends JingleFilesystemWriteResult {
  occurrences?: number
}

export interface JingleFilesystemExecuteResponse {
  exitCode: number | null
  output: string
  truncated: boolean
}

export interface JingleFilesystemExecuteOptions {
  cwd?: string
}

export interface JingleFilesystemBackend {
  edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean
  ): Promise<JingleFilesystemEditResult> | JingleFilesystemEditResult
  globInfo(
    pattern: string,
    path?: string
  ): Promise<JingleFilesystemFileInfo[]> | JingleFilesystemFileInfo[]
  grepRaw(
    pattern: string,
    path?: string | null,
    glob?: string | null
  ): Promise<JingleFilesystemGrepMatch[] | string> | JingleFilesystemGrepMatch[] | string
  lsInfo(path: string): Promise<JingleFilesystemFileInfo[]> | JingleFilesystemFileInfo[]
  read(filePath: string, offset?: number, limit?: number): Promise<string> | string
  write(
    filePath: string,
    content: string
  ): Promise<JingleFilesystemWriteResult> | JingleFilesystemWriteResult
}

export interface JingleSandboxBackend extends JingleFilesystemBackend {
  execute(
    command: string,
    options?: JingleFilesystemExecuteOptions
  ): Promise<JingleFilesystemExecuteResponse> | JingleFilesystemExecuteResponse
  id: string
}

export type JingleFilesystemBackendFactory = (config: {
  state: unknown
  store?: unknown
}) => JingleFilesystemBackend

export interface JingleFilesystemMiddlewareOptions {
  backend: JingleFilesystemBackend | JingleFilesystemBackendFactory
  customToolDescriptions?: Record<string, string> | null
  systemPrompt?: string | null
  toolTokenLimitBeforeEvict?: number | null
}

const fileDataSchema = z.object({
  content: z.array(z.string()),
  created_at: z.string(),
  modified_at: z.string()
})

function fileDataReducer(
  current: Record<string, JingleFilesystemFileData> | undefined,
  update: Record<string, JingleFilesystemFileData | null> | undefined
): Record<string, JingleFilesystemFileData> {
  if (update === undefined) {
    return current ?? {}
  }

  if (current === undefined) {
    const result: Record<string, JingleFilesystemFileData> = {}
    for (const [key, value] of Object.entries(update)) {
      if (value !== null) {
        result[key] = value
      }
    }
    return result
  }

  const result = { ...current }
  for (const [key, value] of Object.entries(update)) {
    if (value === null) {
      delete result[key]
    } else {
      result[key] = value
    }
  }
  return result
}

export const jingleFilesystemFilesValue = new ReducedValue(
  z.record(z.string(), fileDataSchema).default(() => ({})),
  {
    inputSchema: z.record(z.string(), fileDataSchema.nullable()).optional(),
    reducer: fileDataReducer
  }
)

export const jingleFilesystemStateSchema = new StateSchema({
  files: jingleFilesystemFilesValue
})

const TOOL_RESULT_TOKEN_LIMIT = 20_000
const TRUNCATION_GUIDANCE = "... [results truncated, try being more specific with your parameters]"
const NUM_CHARS_PER_TOKEN = 4
const DEFAULT_READ_LINE_OFFSET = 0
const DEFAULT_READ_LINE_LIMIT = 100

const TOOLS_EXCLUDED_FROM_EVICTION = ["ls", "glob", "grep", "read_file", "edit_file", "write_file"]

const FILESYSTEM_SYSTEM_PROMPT = `## Filesystem Tools \`ls\`, \`read_file\`, \`write_file\`, \`edit_file\`, \`glob\`, \`grep\`

You have access to a filesystem which you can interact with using these tools.
All file paths must start with a /.

- ls: list files in a directory (requires absolute path)
- read_file: read a file from the filesystem
- write_file: write to a file in the filesystem
- edit_file: edit a file in the filesystem
- glob: find files matching a pattern (e.g., "**/*.py")
- grep: search for text within files`

const LS_TOOL_DESCRIPTION = `Lists all files in a directory.

This is useful for exploring the filesystem and finding the right file to read or edit.
You should almost ALWAYS use this tool before using the read_file or edit_file tools.`

const READ_FILE_TOOL_DESCRIPTION = `Reads a file from the filesystem.

Assume this tool is able to read all files. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- By default, it reads up to 100 lines starting from the beginning of the file
- **IMPORTANT for large files and codebase exploration**: Use pagination with offset and limit parameters to avoid context overflow
  - First scan: read_file(path, limit=100) to see file structure
  - Read more sections: read_file(path, offset=100, limit=200) for next 200 lines
  - Only omit limit (read full file) when necessary for editing
- Specify offset and limit: read_file(path, offset=0, limit=100) reads first 100 lines
- Results are returned using cat -n format, with line numbers starting at 1
- Lines longer than 10,000 characters will be split into multiple lines with continuation markers (e.g., 5.1, 5.2, etc.). When you specify a limit, these continuation lines count towards the limit.
- You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.
- You should ALWAYS make sure a file has been read before editing it.`

const WRITE_FILE_TOOL_DESCRIPTION = `Writes to a new file in the filesystem.

Usage:
- The write_file tool will create a new file.
- Prefer to edit existing files (with the edit_file tool) over creating new ones when possible.`

const EDIT_FILE_TOOL_DESCRIPTION = `Performs exact string replacements in files.

Usage:
- You must read the file before editing. This tool will error if you attempt an edit without reading the file first.
- When editing, preserve the exact indentation (tabs/spaces) from the read output. Never include line number prefixes in old_string or new_string.
- ALWAYS prefer editing existing files over creating new ones.
- Only use emojis if the user explicitly requests it.`

const GLOB_TOOL_DESCRIPTION = `Find files matching a glob pattern.

Supports standard glob patterns: \`*\` (any characters), \`**\` (any directories), \`?\` (single character).
Returns a list of absolute file paths that match the pattern.

Examples:
- \`**/*.py\` - Find all Python files
- \`*.txt\` - Find all text files in root
- \`/subdir/**/*.md\` - Find all markdown files under /subdir`

const GREP_TOOL_DESCRIPTION = `Search for a text pattern across files.

Searches for literal text (not regex) and returns matching files or content based on output_mode.
Special characters like parentheses, brackets, pipes, etc. are treated as literal characters, not regex operators.

Examples:
- Search all files: \`grep(pattern="TODO")\`
- Search Python files only: \`grep(pattern="import", glob="*.py")\`
- Show matching lines: \`grep(pattern="error", output_mode="content")\`
- Search for code with special chars: \`grep(pattern="def __init__(self):")\``

const EXECUTE_TOOL_DESCRIPTION = `Executes a shell command in an isolated sandbox environment.

Usage:
Executes a given command in the sandbox environment with proper handling and security measures.
Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use the ls tool to verify the parent directory exists and is the correct location
   - For example, before running "mkdir foo/bar", first use ls to check that "foo" exists and is the intended parent directory

2. Command Execution:
   - Use the cwd argument when a command should run from a workspace subdirectory.
   - Always quote file paths that contain spaces with double quotes.
   - Examples of proper quoting:
     - python "/path/with spaces/script.py" (correct)
     - python /path/with spaces/script.py (incorrect - will fail)
   - After ensuring proper quoting, execute the command
   - Capture the output of the command

Usage notes:
  - Commands run in an isolated sandbox environment
  - Returns combined stdout/stderr output with exit code
  - If the output is very large, it may be truncated
  - VERY IMPORTANT: You MUST avoid using search commands like find and grep. Instead use the grep, glob tools to search. You MUST avoid read tools like cat, head, tail, and use read_file to read files.
  - When issuing multiple commands, use the ';' or '&&' operator to separate them. DO NOT use newlines (newlines are ok in quoted strings)
    - Use '&&' when commands depend on each other (e.g., "npm install && npm test")
    - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail
  - Do not prefix commands with cd. Pass cwd instead.

Examples:
  Good examples:
    - execute(command="pytest /foo/bar/tests")
    - execute(command="python /path/to/script.py")
    - execute(command="npm install && npm test")
    - execute(command="pytest tests", cwd="packages/api")

  Bad examples (avoid these):
    - execute(command="cd /foo/bar && pytest tests")  # Use cwd instead
    - execute(command="cat file.txt")  # Use read_file tool instead
    - execute(command="find . -name '*.py'")  # Use glob tool instead
    - execute(command="grep -r 'pattern' .")  # Use grep tool instead

Note: This tool is only available if the backend supports the Jingle sandbox backend contract.
If execution is not supported, the tool will return an error message.`

const EXECUTION_SYSTEM_PROMPT = `## Execute Tool \`execute\`

You have access to an \`execute\` tool for running shell commands in a sandboxed environment.
Use this tool to run commands, scripts, tests, builds, and other shell operations.

- execute: run a shell command in the sandbox (returns output and exit code)`

const READ_FILE_TRUNCATION_MSG = `

[Output was truncated due to size limits. The file content is very large. Consider reformatting the file to make it easier to navigate. For example, if this is JSON, use execute(command='jq . {file_path}') to pretty-print it with line breaks. For other formats, you can use appropriate formatting tools to split long lines.]`

const TOO_LARGE_TOOL_MSG = `Tool result too large, the result of this tool call {tool_call_id} was saved in the filesystem at this path: {file_path}
You can read the result from the filesystem by using the read_file tool, but make sure to only read part of the result at a time.
You can do this by specifying an offset and limit in the read_file tool call.
For example, to read the first 100 lines, you can use the read_file tool with offset=0 and limit=100.

Here is a preview showing the head and tail of the result (lines of the form
... [N lines truncated] ...
indicate omitted lines in the middle of the content):

{content_sample}`

function sanitizeToolCallId(toolCallId: string): string {
  return toolCallId.replace(/\./g, "_").replace(/\//g, "_").replace(/\\/g, "_")
}

function truncateIfTooLong(result: string[] | string): string[] | string {
  if (Array.isArray(result)) {
    const totalChars = result.reduce((sum, item) => sum + item.length, 0)
    if (totalChars > TOOL_RESULT_TOKEN_LIMIT * 4) {
      const truncateAt = Math.floor((result.length * TOOL_RESULT_TOKEN_LIMIT * 4) / totalChars)
      return [...result.slice(0, truncateAt), TRUNCATION_GUIDANCE]
    }
    return result
  }

  if (result.length > TOOL_RESULT_TOKEN_LIMIT * 4) {
    return `${result.substring(0, TOOL_RESULT_TOKEN_LIMIT * 4)}\n${TRUNCATION_GUIDANCE}`
  }
  return result
}

function formatContentWithLineNumbers(content: string[], startLine = 1): string {
  const lineNumberWidth = 6
  const maxLineLength = 10_000
  const resultLines: string[] = []
  for (let index = 0; index < content.length; index += 1) {
    const line = content[index]
    const lineNumber = index + startLine
    if (line.length <= maxLineLength) {
      resultLines.push(`${lineNumber.toString().padStart(lineNumberWidth)}\t${line}`)
      continue
    }

    const chunks = Math.ceil(line.length / maxLineLength)
    for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex += 1) {
      const start = chunkIndex * maxLineLength
      const end = Math.min(start + maxLineLength, line.length)
      const chunk = line.substring(start, end)
      const marker = chunkIndex === 0 ? lineNumber.toString() : `${lineNumber}.${chunkIndex}`
      resultLines.push(`${marker.padStart(lineNumberWidth)}\t${chunk}`)
    }
  }
  return resultLines.join("\n")
}

function createContentPreview(content: string, headLines = 5, tailLines = 5): string {
  const lines = content.split("\n")
  if (lines.length <= headLines + tailLines) {
    return formatContentWithLineNumbers(
      lines.map((line) => line.substring(0, 1_000)),
      1
    )
  }

  const head = lines.slice(0, headLines).map((line) => line.substring(0, 1_000))
  const tail = lines.slice(-tailLines).map((line) => line.substring(0, 1_000))
  const headSample = formatContentWithLineNumbers(head, 1)
  const truncationNotice = `\n... [${lines.length - headLines - tailLines} lines truncated] ...\n`
  const tailSample = formatContentWithLineNumbers(tail, lines.length - tailLines + 1)
  return headSample + truncationNotice + tailSample
}

function isSandboxBackend(backend: JingleFilesystemBackend): backend is JingleSandboxBackend {
  return (
    typeof (backend as Partial<JingleSandboxBackend>).execute === "function" &&
    typeof (backend as Partial<JingleSandboxBackend>).id === "string"
  )
}

function getBackend(
  backend: JingleFilesystemBackend | JingleFilesystemBackendFactory,
  state: unknown,
  store?: unknown
): JingleFilesystemBackend {
  return typeof backend === "function" ? backend({ state, store }) : backend
}

function getToolCallId(runtime: ToolRuntime, toolName: string): string {
  const toolCall = (runtime as ToolRuntime & { toolCall?: { id?: unknown } }).toolCall
  const id = toolCall?.id
  if (typeof id === "string" && id.length > 0) {
    return id
  }
  throw new Error(`[JingleFilesystemMiddleware] Missing tool_call.id for ${toolName}.`)
}

function buildFilesystemToolMessage(input: {
  content: string
  metadata?: Record<string, unknown>
  name: string
  runtime: ToolRuntime
  status?: "error"
}): ToolMessage {
  return new ToolMessage({
    content: input.content,
    metadata: input.metadata,
    name: input.name,
    ...(input.status ? { status: input.status } : {}),
    tool_call_id: getToolCallId(input.runtime, input.name)
  })
}

function createLsTool(
  backend: JingleFilesystemBackend | JingleFilesystemBackendFactory,
  customDescription?: string
) {
  return tool(
    async (input: { path?: string }, runtime: ToolRuntime) => {
      const resolvedBackend = getBackend(backend, runtime.state, runtime.store)
      const path = input.path || "/"
      const infos = await resolvedBackend.lsInfo(path)
      if (infos.length === 0) {
        return `No files found in ${path}`
      }

      const lines: string[] = []
      for (const info of infos) {
        if (info.is_dir) {
          lines.push(`${info.path} (directory)`)
        } else {
          const size = info.size ? ` (${info.size} bytes)` : ""
          lines.push(`${info.path}${size}`)
        }
      }
      const result = truncateIfTooLong(lines)
      return Array.isArray(result) ? result.join("\n") : result
    },
    {
      name: "ls",
      description: customDescription || LS_TOOL_DESCRIPTION,
      schema: z.object({
        path: z.string().optional().default("/").describe("Directory path to list (default: /)")
      })
    }
  )
}

function createReadFileTool(
  backend: JingleFilesystemBackend | JingleFilesystemBackendFactory,
  options: {
    customDescription?: string
    toolTokenLimitBeforeEvict: number | null
  }
) {
  return tool(
    async (
      input: {
        file_path: string
        limit?: number
        offset?: number
      },
      runtime: ToolRuntime
    ) => {
      const resolvedBackend = getBackend(backend, runtime.state, runtime.store)
      const {
        file_path: filePath,
        offset = DEFAULT_READ_LINE_OFFSET,
        limit = DEFAULT_READ_LINE_LIMIT
      } = input
      let result = await resolvedBackend.read(filePath, offset, limit)
      const lines = result.split("\n")
      if (lines.length > limit) {
        result = lines.slice(0, limit).join("\n")
      }

      if (
        options.toolTokenLimitBeforeEvict &&
        result.length >= NUM_CHARS_PER_TOKEN * options.toolTokenLimitBeforeEvict
      ) {
        const truncationMessage = READ_FILE_TRUNCATION_MSG.replace("{file_path}", filePath)
        const maxContentLength =
          NUM_CHARS_PER_TOKEN * options.toolTokenLimitBeforeEvict - truncationMessage.length
        result = result.substring(0, maxContentLength) + truncationMessage
      }
      return result
    },
    {
      name: "read_file",
      description: options.customDescription || READ_FILE_TOOL_DESCRIPTION,
      schema: z.object({
        file_path: z.string().describe("Absolute path to the file to read"),
        offset: z.coerce
          .number()
          .optional()
          .default(DEFAULT_READ_LINE_OFFSET)
          .describe("Line offset to start reading from (0-indexed)"),
        limit: z.coerce
          .number()
          .optional()
          .default(DEFAULT_READ_LINE_LIMIT)
          .describe("Maximum number of lines to read")
      })
    }
  )
}

function createWriteFileTool(
  backend: JingleFilesystemBackend | JingleFilesystemBackendFactory,
  customDescription?: string
) {
  return tool(
    async (
      input: {
        content: string
        file_path: string
      },
      runtime: ToolRuntime
    ) => {
      const resolvedBackend = getBackend(backend, runtime.state, runtime.store)
      const { file_path: filePath, content } = input
      const result = await resolvedBackend.write(filePath, content)
      if (result.error) {
        return buildFilesystemToolMessage({
          content: result.error,
          name: "write_file",
          runtime,
          status: "error"
        })
      }

      const message = buildFilesystemToolMessage({
        content: `Successfully wrote to '${filePath}'`,
        metadata: result.metadata,
        name: "write_file",
        runtime
      })
      if (result.filesUpdate) {
        return new Command({
          update: {
            files: result.filesUpdate,
            messages: [message]
          }
        })
      }
      return message
    },
    {
      name: "write_file",
      description: customDescription || WRITE_FILE_TOOL_DESCRIPTION,
      schema: z.object({
        file_path: z.string().describe("Absolute path to the file to write"),
        content: z.string().default("").describe("Content to write to the file")
      })
    }
  )
}

function createEditFileTool(
  backend: JingleFilesystemBackend | JingleFilesystemBackendFactory,
  customDescription?: string
) {
  return tool(
    async (
      input: {
        file_path: string
        new_string: string
        old_string: string
        replace_all?: boolean
      },
      runtime: ToolRuntime
    ) => {
      const resolvedBackend = getBackend(backend, runtime.state, runtime.store)
      const {
        file_path: filePath,
        old_string: oldString,
        new_string: newString,
        replace_all: replaceAll = false
      } = input
      const result = await resolvedBackend.edit(filePath, oldString, newString, replaceAll)
      if (result.error) {
        return buildFilesystemToolMessage({
          content: result.error,
          name: "edit_file",
          runtime,
          status: "error"
        })
      }

      const message = buildFilesystemToolMessage({
        content: `Successfully replaced ${result.occurrences} occurrence(s) in '${filePath}'`,
        metadata: result.metadata,
        name: "edit_file",
        runtime
      })
      if (result.filesUpdate) {
        return new Command({
          update: {
            files: result.filesUpdate,
            messages: [message]
          }
        })
      }
      return message
    },
    {
      name: "edit_file",
      description: customDescription || EDIT_FILE_TOOL_DESCRIPTION,
      schema: z.object({
        file_path: z.string().describe("Absolute path to the file to edit"),
        old_string: z.string().describe("String to be replaced (must match exactly)"),
        new_string: z.string().describe("String to replace with"),
        replace_all: z
          .boolean()
          .optional()
          .default(false)
          .describe("Whether to replace all occurrences")
      })
    }
  )
}

function createGlobTool(
  backend: JingleFilesystemBackend | JingleFilesystemBackendFactory,
  customDescription?: string
) {
  return tool(
    async (
      input: {
        path?: string
        pattern: string
      },
      runtime: ToolRuntime
    ) => {
      const resolvedBackend = getBackend(backend, runtime.state, runtime.store)
      const { pattern, path = "/" } = input
      const infos = await resolvedBackend.globInfo(pattern, path)
      if (infos.length === 0) {
        return `No files found matching pattern '${pattern}'`
      }
      const result = truncateIfTooLong(infos.map((info) => info.path))
      return Array.isArray(result) ? result.join("\n") : result
    },
    {
      name: "glob",
      description: customDescription || GLOB_TOOL_DESCRIPTION,
      schema: z.object({
        pattern: z.string().describe("Glob pattern (e.g., '*.py', '**/*.ts')"),
        path: z.string().optional().default("/").describe("Base path to search from (default: /)")
      })
    }
  )
}

function createGrepTool(
  backend: JingleFilesystemBackend | JingleFilesystemBackendFactory,
  customDescription?: string
) {
  return tool(
    async (
      input: {
        glob?: string | null
        path?: string
        pattern: string
      },
      runtime: ToolRuntime
    ) => {
      const resolvedBackend = getBackend(backend, runtime.state, runtime.store)
      const { pattern, path = "/", glob = null } = input
      const result = await resolvedBackend.grepRaw(pattern, path, glob)
      if (typeof result === "string") {
        return result
      }
      if (result.length === 0) {
        return `No matches found for pattern '${pattern}'`
      }

      const lines: string[] = []
      let currentFile: string | null = null
      for (const match of result) {
        if (match.path !== currentFile) {
          currentFile = match.path
          lines.push(`\n${currentFile}:`)
        }
        lines.push(`  ${match.line}: ${match.text}`)
      }

      const truncated = truncateIfTooLong(lines)
      return Array.isArray(truncated) ? truncated.join("\n") : truncated
    },
    {
      name: "grep",
      description: customDescription || GREP_TOOL_DESCRIPTION,
      schema: z.object({
        pattern: z.string().describe("Regex pattern to search for"),
        path: z.string().optional().default("/").describe("Base path to search from (default: /)"),
        glob: z
          .string()
          .optional()
          .nullable()
          .describe("Optional glob pattern to filter files (e.g., '*.py')")
      })
    }
  )
}

function createExecuteTool(
  backend: JingleFilesystemBackend | JingleFilesystemBackendFactory,
  customDescription?: string
) {
  return tool(
    async (
      input: {
        command: string
        cwd?: string
      },
      runtime: ToolRuntime
    ) => {
      const resolvedBackend = getBackend(backend, runtime.state, runtime.store)
      if (!isSandboxBackend(resolvedBackend)) {
        return "Error: Execution not available. This agent's backend does not support command execution. To use the execute tool, provide a backend that implements the Jingle sandbox backend contract."
      }

      const result = await resolvedBackend.execute(input.command, { cwd: input.cwd })
      const parts = [result.output]
      if (result.exitCode !== null) {
        const status = result.exitCode === 0 ? "succeeded" : "failed"
        parts.push(`\n[Command ${status} with exit code ${result.exitCode}]`)
      }
      if (result.truncated) {
        parts.push("\n[Output was truncated due to size limits]")
      }
      return parts.join("")
    },
    {
      name: "execute",
      description: customDescription || EXECUTE_TOOL_DESCRIPTION,
      schema: z.object({
        command: z.string().describe("The shell command to execute"),
        cwd: z
          .string()
          .optional()
          .describe(
            "Working directory for the command, relative to the workspace root or absolute inside the workspace."
          )
      })
    }
  )
}

async function processLargeToolMessage(input: {
  backend: JingleFilesystemBackend | JingleFilesystemBackendFactory
  message: ToolMessage
  request: Parameters<NonNullable<AgentMiddleware["wrapToolCall"]>>[0]
  toolTokenLimitBeforeEvict: number
}): Promise<{
  filesUpdate: Record<string, JingleFilesystemFileData> | null
  message: ToolMessage
}> {
  const { message, request, toolTokenLimitBeforeEvict } = input
  if (
    typeof message.content !== "string" ||
    message.content.length <= toolTokenLimitBeforeEvict * NUM_CHARS_PER_TOKEN
  ) {
    return {
      message,
      filesUpdate: null
    }
  }

  const resolvedBackend = getBackend(input.backend, request.state || {}, request.runtime?.store)
  const evictPath = `/large_tool_results/${sanitizeToolCallId(message.tool_call_id)}`
  const writeResult = await resolvedBackend.write(evictPath, message.content)
  if (writeResult.error) {
    throw new Error(
      `[JingleFilesystemMiddleware] Failed to evict large tool result ${message.tool_call_id}: ${writeResult.error}`
    )
  }

  const contentSample = createContentPreview(message.content)
  return {
    message: new ToolMessage({
      content: TOO_LARGE_TOOL_MSG.replace("{tool_call_id}", message.tool_call_id)
        .replace("{file_path}", evictPath)
        .replace("{content_sample}", contentSample),
      tool_call_id: message.tool_call_id,
      name: message.name,
      id: message.id,
      artifact: message.artifact,
      status: message.status,
      metadata: message.metadata,
      additional_kwargs: message.additional_kwargs,
      response_metadata: message.response_metadata
    }),
    filesUpdate: writeResult.filesUpdate ?? null
  }
}

interface JingleFilesystemCommandUpdate {
  files?: Record<string, JingleFilesystemFileData>
  messages: BaseMessage[]
  [key: string]: unknown
}

function getCommandUpdateWithMessages(result: Command): JingleFilesystemCommandUpdate | null {
  const update = result.update
  if (!update || typeof update !== "object" || Array.isArray(update)) {
    return null
  }

  const candidate = update as Record<string, unknown>
  if (!Array.isArray(candidate.messages)) {
    return null
  }

  return candidate as JingleFilesystemCommandUpdate
}

export function createJingleFilesystemMiddleware(
  options: JingleFilesystemMiddlewareOptions
): AgentMiddleware {
  const {
    backend,
    systemPrompt: customSystemPrompt = null,
    customToolDescriptions = null,
    toolTokenLimitBeforeEvict = 20_000
  } = options
  const baseSystemPrompt = customSystemPrompt || FILESYSTEM_SYSTEM_PROMPT

  return createMiddleware({
    name: "JingleFilesystemMiddleware",
    stateSchema: jingleFilesystemStateSchema,
    tools: [
      createLsTool(backend, customToolDescriptions?.ls),
      createReadFileTool(backend, {
        customDescription: customToolDescriptions?.read_file,
        toolTokenLimitBeforeEvict
      }),
      createWriteFileTool(backend, customToolDescriptions?.write_file),
      createEditFileTool(backend, customToolDescriptions?.edit_file),
      createGlobTool(backend, customToolDescriptions?.glob),
      createGrepTool(backend, customToolDescriptions?.grep),
      createExecuteTool(backend, customToolDescriptions?.execute)
    ],
    wrapModelCall: async (request, handler) => {
      const supportsExecution = isSandboxBackend(
        getBackend(backend, request.state || {}, request.runtime?.store)
      )
      const tools = supportsExecution
        ? request.tools
        : request.tools.filter((candidate) => candidate.name !== "execute")
      const filesystemPrompt = supportsExecution
        ? `${baseSystemPrompt}\n\n${EXECUTION_SYSTEM_PROMPT}`
        : baseSystemPrompt
      return handler({
        ...request,
        tools,
        systemMessage: request.systemMessage.concat(filesystemPrompt)
      })
    },
    wrapToolCall: async (request, handler) => {
      if (!toolTokenLimitBeforeEvict) {
        return handler(request)
      }

      const toolName = request.toolCall?.name
      if (toolName && TOOLS_EXCLUDED_FROM_EVICTION.includes(toolName)) {
        return handler(request)
      }

      const result = await handler(request)
      if (ToolMessage.isInstance(result)) {
        const processed = await processLargeToolMessage({
          backend,
          message: result,
          request,
          toolTokenLimitBeforeEvict
        })
        if (processed.filesUpdate) {
          return new Command({
            update: {
              files: processed.filesUpdate,
              messages: [processed.message]
            }
          })
        }
        return processed.message
      }

      if (isCommand(result)) {
        const update = getCommandUpdateWithMessages(result)
        if (!update) {
          return result
        }

        let hasLargeResults = false
        const accumulatedFiles = update.files ? { ...update.files } : {}
        const processedMessages: BaseMessage[] = []
        for (const message of update.messages) {
          if (!ToolMessage.isInstance(message)) {
            processedMessages.push(message)
            continue
          }

          const processed = await processLargeToolMessage({
            backend,
            message,
            request,
            toolTokenLimitBeforeEvict
          })
          processedMessages.push(processed.message)
          if (processed.filesUpdate) {
            hasLargeResults = true
            Object.assign(accumulatedFiles, processed.filesUpdate)
          }
        }

        if (hasLargeResults) {
          return new Command({
            update: {
              ...update,
              messages: processedMessages,
              files: accumulatedFiles
            }
          })
        }
      }

      return result
    }
  })
}
