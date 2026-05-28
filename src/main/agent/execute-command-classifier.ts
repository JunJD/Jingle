import { Bash } from "just-bash"
import {
  type ExecuteCommandPolicy,
  type ExecuteCommandProfile
} from "@shared/execute-command-policy"
import { normalizePublicHttpUrl } from "../services/web-tools/url-guard"

const parser = new Bash()

const SAFE_READ_ONLY_COMMANDS = new Set([
  "alias",
  "awk",
  "base64",
  "basename",
  "cat",
  "clear",
  "column",
  "comm",
  "cut",
  "date",
  "diff",
  "dirname",
  "du",
  "echo",
  "egrep",
  "env",
  "expand",
  "export",
  "expr",
  "false",
  "fgrep",
  "file",
  "find",
  "fold",
  "grep",
  "head",
  "help",
  "history",
  "hostname",
  "html-to-markdown",
  "join",
  "jq",
  "ls",
  "md5sum",
  "nl",
  "od",
  "paste",
  "printenv",
  "printf",
  "pwd",
  "readlink",
  "rev",
  "rg",
  "seq",
  "set",
  "sha1sum",
  "sha256sum",
  "sort",
  "stat",
  "strings",
  "tac",
  "tail",
  "tr",
  "tree",
  "true",
  "unalias",
  "unexpand",
  "uniq",
  "wc",
  "which",
  "whoami",
  "xan",
  "yq",
  "zcat"
])

const FILE_MUTATION_COMMANDS = new Set(["chmod", "cp", "ln", "mkdir", "mv", "rm", "rmdir", "touch"])
const HOST_UNSAFE_COMMANDS = new Set([
  "bash",
  "gzip",
  "gunzip",
  "node",
  "npm",
  "npx",
  "pnpm",
  "python",
  "python3",
  "sh",
  "sleep",
  "sqlite3",
  "tar",
  "timeout",
  "xargs"
])
const GIT_READ_ONLY_SUBCOMMANDS = new Set([
  "diff",
  "log",
  "ls-files",
  "ls-remote",
  "remote",
  "rev-parse",
  "show",
  "status"
])
const NPM_READ_ONLY_SUBCOMMANDS = new Set(["help", "view"])
const PNPM_READ_ONLY_SUBCOMMANDS = new Set(["--version", "-v", "help", "view"])
const MANAGED_PACKAGE_SCRIPTS = new Set(["dev", "preview", "start"])
const MANAGED_PYTHON_MODULES = new Set(["http.server"])
const CURL_METHOD_FLAGS = new Set(["-X", "--request"])
const CURL_BODY_FLAGS = new Set([
  "-d",
  "--data",
  "--data-ascii",
  "--data-binary",
  "--data-raw",
  "--data-urlencode",
  "-F",
  "--form",
  "--form-string",
  "-T",
  "--upload-file"
])
const CURL_OUTPUT_FLAGS = new Set(["-O", "--remote-name", "--remote-name-all"])
const CURL_OUTPUT_WITH_VALUE_FLAGS = new Set(["-o", "--output"])
const FIND_MUTATION_FLAGS = new Set(["-delete"])
const FIND_EXEC_FLAGS = new Set(["-exec", "-execdir", "-ok", "-okdir"])
const WRITE_REDIRECTION_OPERATORS = new Set([">", ">>", ">|", "<>"])

type InvocationClassification =
  | {
      profile:
        | "read_only"
        | "network_read"
        | "predictable_mutation"
        | "managed_process"
      reason: string
      networkTargets?: string[]
    }
  | {
      profile: "host_unsafe"
      reason: string
    }

interface CollectedCommand {
  args: Array<string | null>
  name: string | null
  rawName: string
  redirections: Array<{ operator: string }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function hasBackgroundExecution(node: unknown): boolean {
  if (Array.isArray(node)) {
    return node.some((entry) => hasBackgroundExecution(entry))
  }

  if (!isRecord(node)) {
    return false
  }

  if (node.background === true) {
    return true
  }

  return Object.values(node).some((entry) => hasBackgroundExecution(entry))
}

function wordToText(node: unknown): string | null {
  if (!isRecord(node) || node.type !== "Word") {
    return null
  }

  const parts = asArray(node.parts)
  if (parts.length === 0) {
    return ""
  }

  const values: string[] = []
  for (const part of parts) {
    const value = wordPartToText(part)
    if (value === null) {
      return null
    }
    values.push(value)
  }

  return values.join("")
}

function wordPartToText(node: unknown): string | null {
  if (!isRecord(node) || typeof node.type !== "string") {
    return null
  }

  if (node.type === "Literal" || node.type === "SingleQuoted") {
    return typeof node.value === "string" ? node.value : null
  }

  if (node.type === "DoubleQuoted") {
    const parts = asArray(node.parts)
    const values: string[] = []
    for (const part of parts) {
      const value = wordPartToText(part)
      if (value === null) {
        return null
      }
      values.push(value)
    }
    return values.join("")
  }

  return null
}

function collectSimpleCommands(node: unknown, acc: CollectedCommand[]): void {
  if (Array.isArray(node)) {
    for (const entry of node) {
      collectSimpleCommands(entry, acc)
    }
    return
  }

  if (!isRecord(node)) {
    return
  }

  if (node.type === "SimpleCommand") {
    const name = wordToText(node.name)
    acc.push({
      name,
      rawName: name ?? "<dynamic>",
      args: asArray(node.args).map((entry) => wordToText(entry)),
      redirections: asArray(node.redirections).flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.operator !== "string") {
          return []
        }
        return [{ operator: entry.operator }]
      })
    })
  }

  for (const entry of Object.values(node)) {
    collectSimpleCommands(entry, acc)
  }
}

function hasWriteRedirection(invocation: CollectedCommand): boolean {
  return invocation.redirections.some((entry) => WRITE_REDIRECTION_OPERATORS.has(entry.operator))
}

function extractGitSubcommand(args: Array<string | null>): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token) {
      return null
    }

    if (token === "-C" || token === "-c" || token === "--git-dir" || token === "--work-tree") {
      index += 1
      continue
    }

    if (token === "--config-env") {
      index += 1
      continue
    }

    if (token.startsWith("-")) {
      continue
    }

    return token
  }

  return null
}

function isEnvAssignmentToken(token: string): boolean {
  const separatorIndex = token.indexOf("=")
  return separatorIndex > 0
}

function extractCliSubcommand(args: Array<string | null>): string | null {
  for (const token of args) {
    if (!token) {
      return null
    }

    if (isEnvAssignmentToken(token)) {
      continue
    }

    if (token.startsWith("-")) {
      continue
    }

    return token
  }

  return null
}

function extractPackageScriptName(args: Array<string | null>): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token) {
      return null
    }

    if (isEnvAssignmentToken(token) || token.startsWith("-")) {
      continue
    }

    if (token === "run" || token === "run-script") {
      for (let scriptIndex = index + 1; scriptIndex < args.length; scriptIndex += 1) {
        const scriptName = args[scriptIndex]
        if (!scriptName) {
          return null
        }

        if (scriptName.startsWith("-")) {
          continue
        }

        return scriptName
      }

      return null
    }

    return token
  }

  return null
}

function extractEnvDelegatedCommandIndex(args: Array<string | null>): number | null {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token) {
      return null
    }

    if (token === "-i" || token === "--ignore-environment") {
      continue
    }

    if (token === "-u" || token === "--unset") {
      index += 1
      continue
    }

    if (isEnvAssignmentToken(token)) {
      continue
    }

    if (token.startsWith("-")) {
      continue
    }

    return index
  }

  return null
}

function hasSedInPlace(args: Array<string | null>): boolean {
  return args.some(
    (token) => token === "-i" || token === "--in-place" || token?.startsWith("-i") === true
  )
}

function hasTeeTarget(args: Array<string | null>): boolean {
  return args.some((token) => token !== null && token.length > 0 && !token.startsWith("-"))
}

function classifyFind(args: Array<string | null>): InvocationClassification {
  for (const token of args) {
    if (!token) {
      return {
        profile: "host_unsafe",
        reason: "find command contains dynamic arguments that cannot be classified safely."
      }
    }

    if (FIND_MUTATION_FLAGS.has(token)) {
      return {
        profile: "predictable_mutation",
        reason: "find command deletes files with -delete."
      }
    }

    if (FIND_EXEC_FLAGS.has(token)) {
      return {
        profile: "host_unsafe",
        reason:
          "find command executes nested commands, which is outside the controlled shell profile."
      }
    }
  }

  return {
    profile: "read_only",
    reason: "find command only reads workspace paths."
  }
}

function classifyCurl(
  args: Array<string | null>,
  hasWriteTarget: boolean
): InvocationClassification {
  let method = "GET"
  const urls: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token) {
      return {
        profile: "host_unsafe",
        reason: "curl command contains dynamic arguments that cannot be classified safely."
      }
    }

    if (token === "-I" || token === "--head") {
      method = "HEAD"
      continue
    }

    if (CURL_METHOD_FLAGS.has(token)) {
      const value = args[index + 1]
      if (!value) {
        return {
          profile: "host_unsafe",
          reason: "curl command uses a dynamic request method."
        }
      }
      method = value.toUpperCase()
      index += 1
      continue
    }

    if (token.startsWith("--request=")) {
      method = token.slice("--request=".length).toUpperCase()
      continue
    }

    if (token.startsWith("-X") && token.length > 2) {
      method = token.slice(2).toUpperCase()
      continue
    }

    if (CURL_BODY_FLAGS.has(token)) {
      return {
        profile: "host_unsafe",
        reason:
          "curl command sends request bodies or uploads, which is outside the read-only shell profile."
      }
    }

    if (CURL_OUTPUT_FLAGS.has(token)) {
      return {
        profile: "host_unsafe",
        reason: "curl output-to-file flags are not enabled in the controlled shell profile."
      }
    }

    if (CURL_OUTPUT_WITH_VALUE_FLAGS.has(token)) {
      return {
        profile: "host_unsafe",
        reason: "curl output-to-file flags are not enabled in the controlled shell profile."
      }
    }

    const normalizedUrl = normalizePublicHttpUrl(token)
    if (normalizedUrl) {
      urls.push(normalizedUrl)
      continue
    }
  }

  if (urls.length === 0) {
    return {
      profile: "host_unsafe",
      reason: "curl command must use a fully qualified public http:// or https:// URL."
    }
  }

  if (method !== "GET" && method !== "HEAD") {
    return {
      profile: "host_unsafe",
      reason: `curl request method '${method}' is not allowed in the controlled shell profile.`
    }
  }

  if (hasWriteTarget) {
    return {
      profile: "host_unsafe",
      reason:
        "curl commands that write to local files are not enabled in the controlled shell profile."
    }
  }

  return {
    profile: "network_read",
    reason: "curl command performs a public HTTP GET/HEAD request without local file writes.",
    networkTargets: urls
  }
}

function classifyPythonCommand(
  name: "python" | "python3",
  args: Array<string | null>
): InvocationClassification {
  const [firstArg, secondArg] = args
  if (!firstArg) {
    return {
      profile: "host_unsafe",
      reason: `${name} must use --version, -c CODE, or a script file in the controlled shell profile.`
    }
  }

  if (firstArg === "--version" || firstArg === "-V") {
    return {
      profile: "read_only",
      reason: `${name} version inspection is read-only.`
    }
  }

  if (firstArg === "-c") {
    if (!secondArg) {
      return {
        profile: "host_unsafe",
        reason: `${name} requires inline code after -c.`
      }
    }

    return {
      profile: "predictable_mutation",
      reason: `${name} inline code execution requires mutation prediction and approval.`
    }
  }

  if (firstArg === "-m") {
    if (!secondArg) {
      return {
        profile: "host_unsafe",
        reason: `${name} requires a module name after -m.`
      }
    }

    if (MANAGED_PYTHON_MODULES.has(secondArg)) {
      return {
        profile: "managed_process",
        reason: `${name} -m ${secondArg} starts a managed process and requires approval.`
      }
    }

    return {
      profile: "host_unsafe",
      reason: `${name} module '${secondArg}' is outside the controlled shell profile.`
    }
  }

  if (firstArg.startsWith("-")) {
    return {
      profile: "host_unsafe",
      reason: `${name} option '${firstArg}' is outside the controlled shell profile.`
    }
  }

  return {
    profile: "predictable_mutation",
    reason: `${name} script execution requires mutation prediction and approval.`
  }
}

function classifyNodeCommand(args: Array<string | null>): InvocationClassification {
  const [firstArg, secondArg] = args
  if (!firstArg) {
    return {
      profile: "host_unsafe",
      reason: "node must use --version, -e CODE, or a script file in the controlled shell profile."
    }
  }

  if (firstArg === "--version" || firstArg === "-v") {
    return {
      profile: "read_only",
      reason: "node version inspection is read-only."
    }
  }

  if (firstArg === "-e" || firstArg === "--eval") {
    if (!secondArg) {
      return {
        profile: "host_unsafe",
        reason: "node requires inline code after -e/--eval."
      }
    }

    return {
      profile: "predictable_mutation",
      reason: "node inline code execution requires mutation prediction and approval."
    }
  }

  if (firstArg.startsWith("-")) {
    return {
      profile: "host_unsafe",
      reason: `node option '${firstArg}' is outside the controlled shell profile.`
    }
  }

  return {
    profile: "predictable_mutation",
    reason: "node script execution requires mutation prediction and approval."
  }
}

function classifyInvocation(invocation: CollectedCommand): InvocationClassification {
  if (!invocation.name) {
    return {
      profile: "host_unsafe",
      reason: "Command name is dynamic, so it cannot be classified safely."
    }
  }

  const name = invocation.name
  const hasWriteTarget = hasWriteRedirection(invocation)

  if (name.includes("/")) {
    return {
      profile: "host_unsafe",
      reason: `Executable path '${name}' is outside the controlled shell profile.`
    }
  }

  if (name === "env") {
    const delegatedIndex = extractEnvDelegatedCommandIndex(invocation.args)
    if (delegatedIndex === null) {
      return {
        profile: "read_only",
        reason: "env command only inspects or scopes environment variables."
      }
    }

    const delegated = invocation.args[delegatedIndex]
    if (!delegated) {
      return {
        profile: "host_unsafe",
        reason: "env command could not be classified safely."
      }
    }

    return classifyInvocation({
      ...invocation,
      name: delegated,
      rawName: delegated,
      args: invocation.args.slice(delegatedIndex + 1),
      redirections: invocation.redirections
    })
  }

  if (name === "git") {
    const subcommand = extractGitSubcommand(invocation.args)
    if (subcommand && GIT_READ_ONLY_SUBCOMMANDS.has(subcommand) && !hasWriteTarget) {
      return {
        profile: "read_only",
        reason: `git ${subcommand} is an allowlisted read-only subcommand.`
      }
    }

    return {
      profile: "host_unsafe",
      reason:
        subcommand === null
          ? "git command could not be classified safely."
          : `git ${subcommand} is outside the controlled shell profile.`
    }
  }

  if (name === "npm") {
    if (!hasWriteTarget) {
      const scriptName = extractPackageScriptName(invocation.args)
      if (scriptName && MANAGED_PACKAGE_SCRIPTS.has(scriptName)) {
        return {
          profile: "managed_process",
          reason: `npm ${scriptName} starts a managed process and requires approval.`
        }
      }

      const subcommand = extractCliSubcommand(invocation.args)
      if (subcommand && NPM_READ_ONLY_SUBCOMMANDS.has(subcommand)) {
        return {
          profile: "read_only",
          reason: `npm ${subcommand} is an allowlisted read-only subcommand.`
        }
      }

      if (invocation.args.some((token) => token === "--version" || token === "-v")) {
        return {
          profile: "read_only",
          reason: "npm version inspection is read-only."
        }
      }
    }

    return {
      profile: "host_unsafe",
      reason: "npm commands are outside the controlled shell profile."
    }
  }

  if (name === "pnpm") {
    if (!hasWriteTarget) {
      const scriptName = extractPackageScriptName(invocation.args)
      if (scriptName && MANAGED_PACKAGE_SCRIPTS.has(scriptName)) {
        return {
          profile: "managed_process",
          reason: `pnpm ${scriptName} starts a managed process and requires approval.`
        }
      }

      if (invocation.args.some((token) => token === "--version" || token === "-v")) {
        return {
          profile: "read_only",
          reason: "pnpm version inspection is read-only."
        }
      }

      const subcommand = extractCliSubcommand(invocation.args)
      if (subcommand && PNPM_READ_ONLY_SUBCOMMANDS.has(subcommand)) {
        return {
          profile: "read_only",
          reason: `pnpm ${subcommand} is an allowlisted read-only subcommand.`
        }
      }
    }

    return {
      profile: "host_unsafe",
      reason: "pnpm commands are outside the controlled shell profile."
    }
  }

  if (name === "find") {
    return classifyFind(invocation.args)
  }

  if (name === "python" || name === "python3") {
    return classifyPythonCommand(name, invocation.args)
  }

  if (name === "node") {
    return classifyNodeCommand(invocation.args)
  }

  if (name === "js-exec") {
    return {
      profile: "host_unsafe",
      reason: "js-exec is only available inside the mutation simulator and is not a host command."
    }
  }

  if (name === "sed" && hasSedInPlace(invocation.args)) {
    return {
      profile: "predictable_mutation",
      reason: "sed command uses in-place editing."
    }
  }

  if (name === "tee" && hasTeeTarget(invocation.args)) {
    return {
      profile: "predictable_mutation",
      reason: "tee command writes to explicit file targets."
    }
  }

  if (name === "curl") {
    return classifyCurl(invocation.args, hasWriteTarget)
  }

  if (FILE_MUTATION_COMMANDS.has(name) || hasWriteTarget) {
    return {
      profile: "predictable_mutation",
      reason: hasWriteTarget
        ? "Command writes to local files through shell redirection."
        : `${name} modifies files or directories in the workspace.`
    }
  }

  if (HOST_UNSAFE_COMMANDS.has(name)) {
    return {
      profile: "host_unsafe",
      reason: `${name} is outside the controlled shell profile.`
    }
  }

  if (SAFE_READ_ONLY_COMMANDS.has(name)) {
    return {
      profile: "read_only",
      reason: `${name} is an allowlisted read-only command.`
    }
  }

  return {
    profile: "host_unsafe",
    reason: `Command '${name}' is not in the controlled shell allowlist.`
  }
}

function summarizePolicy(profile: ExecuteCommandProfile, commands: string[]): string {
  const preview = commands.slice(0, 4).join(", ") || "shell command"

  switch (profile) {
    case "read_only":
      return `Read-only command allowed without approval (${preview}).`
    case "network_read":
      return `Public network read command allowed without approval (${preview}).`
    case "predictable_mutation":
      return `Command may modify workspace files and requires approval (${preview}).`
    case "managed_process":
      return `Managed process command requires approval (${preview}).`
    case "host_unsafe":
      return `Command blocked by the controlled shell policy (${preview}).`
  }
}

function isGenericAllowlistedReadOnlyReason(reason: string): boolean {
  return reason.includes("allowlisted read-only")
}

export interface ExecuteCommandClassifier {
  classify(command: string): ExecuteCommandPolicy
}

export class JustBashExecuteCommandClassifier implements ExecuteCommandClassifier {
  classify(command: string): ExecuteCommandPolicy {
    const trimmed = command.trim()

    if (!trimmed) {
      return {
        command,
        profile: "host_unsafe",
        disposition: "deny",
        summary: summarizePolicy("host_unsafe", ["empty command"]),
        reason: "Shell command must be a non-empty string.",
        commands: []
      }
    }

    let transformed: ReturnType<typeof parser.transform>
    try {
      transformed = parser.transform(command)
    } catch (error) {
      const reason =
        error instanceof Error
          ? `Command could not be parsed safely: ${error.message}`
          : "Command could not be parsed safely."
      return {
        command,
        profile: "host_unsafe",
        disposition: "deny",
        summary: summarizePolicy("host_unsafe", ["unparseable shell syntax"]),
        reason,
        commands: []
      }
    }

    if (hasBackgroundExecution(transformed.ast)) {
      return {
        command,
        profile: "host_unsafe",
        disposition: "deny",
        summary: summarizePolicy("host_unsafe", ["background execution"]),
        reason: "Background shell execution is outside the controlled shell profile.",
        commands: []
      }
    }

    const invocations: CollectedCommand[] = []
    collectSimpleCommands(transformed.ast, invocations)

    if (invocations.length === 0) {
      return {
        command,
        profile: "host_unsafe",
        disposition: "deny",
        summary: summarizePolicy("host_unsafe", ["no executable commands"]),
        reason: "Shell input did not contain any executable commands.",
        commands: []
      }
    }

    const commandNames = invocations.map((entry) => entry.rawName)
    let finalProfile: ExecuteCommandProfile = "read_only"
    let reason = "All commands matched the read-only allowlist."
    const networkTargets = new Set<string>()

    for (const invocation of invocations) {
      const classification = classifyInvocation(invocation)

      if (classification.profile === "host_unsafe") {
        finalProfile = "host_unsafe"
        reason = classification.reason
        break
      }

      for (const target of classification.networkTargets ?? []) {
        networkTargets.add(target)
      }

      if (classification.profile === "predictable_mutation") {
        finalProfile = "predictable_mutation"
        reason = classification.reason
        continue
      }

      if (classification.profile === "managed_process" && finalProfile !== "predictable_mutation") {
        finalProfile = "managed_process"
        reason = classification.reason
        continue
      }

      if (classification.profile === "network_read" && finalProfile === "read_only") {
        finalProfile = "network_read"
        reason = classification.reason
        continue
      }

      if (
        classification.profile === "read_only" &&
        !isGenericAllowlistedReadOnlyReason(classification.reason)
      ) {
        reason = classification.reason
      }
    }

    const disposition =
      finalProfile === "predictable_mutation" || finalProfile === "managed_process"
        ? "require_approval"
        : finalProfile === "host_unsafe"
          ? "deny"
          : "allow"

    return {
      command,
      profile: finalProfile,
      disposition,
      summary: summarizePolicy(finalProfile, commandNames),
      reason,
      commands: commandNames,
      ...(networkTargets.size > 0 ? { networkTargets: Array.from(networkTargets) } : {})
    }
  }
}
