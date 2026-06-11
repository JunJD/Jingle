#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

function readArgs(argv) {
  const args = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--json") {
      args.set("json", "true")
      continue
    }
    if (value.startsWith("--")) {
      args.set(value.slice(2), argv[index + 1])
      index += 1
    }
  }
  return args
}

function walkFiles(root, files = []) {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      if (entry === "node_modules") {
        continue
      }
      walkFiles(path, files)
      continue
    }
    if (path.endsWith(".js") && !path.endsWith(".map")) {
      files.push(path)
    }
  }
  return files
}

function readMaybe(path) {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return ""
  }
}

function relative(root, path) {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

function findByContent(files, pattern) {
  return files.filter((file) => pattern.test(readMaybe(file)))
}

function extractThreadActionMessages(source) {
  const wantedIds = new Set([
    "threadHeader.openInNewWindow",
    "threadHeader.moreActions",
    "sidebarElectron.renameThread",
    "sidebarElectron.archiveThread",
    "threadHeader.copyWorkingDirectory",
    "threadHeader.copySessionId",
    "threadHeader.copyAppLink",
    "threadHeader.copyConversationMarkdown"
  ])
  const messages = []
  const messagePattern = /\{id:`([^`]+)`,defaultMessage:`([^`]+)`/g
  let match
  while ((match = messagePattern.exec(source)) !== null) {
    const [, id, defaultMessage] = match
    if (wantedIds.has(id)) {
      messages.push({ defaultMessage, id })
    }
  }
  return messages
}

function extractToolNames(source) {
  const toolNames = [
    "create_thread",
    "list_threads",
    "read_thread",
    "send_message_to_thread",
    "fork_thread",
    "set_thread_pinned",
    "set_thread_archived",
    "set_thread_title"
  ]
  return toolNames.filter((toolName) => source.includes(toolName))
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" })
  if (result.status !== 0) {
    return null
  }
  return result.stdout.trim()
}

function createReport({ codexBin, root }) {
  const files = walkFiles(root)
  const byName = (needle) => files.filter((file) => basename(file).includes(needle))
  const threadActionsMatches = findByContent(files, /threadHeader\.openInNewWindow/)
  const pinnedQueryMatches = findByContent(files, /list-pinned-threads/)
  const setPinnedMatches = findByContent(files, /set-thread-pinned/)
  const dynamicToolMatches = findByContent(
    files,
    /set_thread_pinned|read_thread|send_message_to_thread/
  )
  const hotkeyWindowFiles = byName("hotkey-window-thread-page")
  const localConversationFiles = byName("local-conversation-page")

  const threadActions = threadActionsMatches
    .map((file) => {
      const source = readMaybe(file)
      return {
        file: relative(root, file),
        messages: extractThreadActionMessages(source)
      }
    })
    .filter((item) => item.messages.length > 0)

  const primaryPinnedQueryFiles = pinnedQueryMatches.filter(
    (file) => basename(file).startsWith("pinned-threads-query")
  )
  const primarySetPinnedFiles = setPinnedMatches.filter(
    (file) => basename(file).startsWith("set-pinned-thread")
  )
  const dynamicTools = dynamicToolMatches
    .map((file) => {
      const source = readMaybe(file)
      return {
        file: relative(root, file),
        toolNames: extractToolNames(source)
      }
    })
    .filter((item) => basename(item.file).startsWith("app-server-dynamic-tools"))

  return {
    codex: {
      appAsarRoot: root,
      cliVersion: existsSync(codexBin) ? commandOutput(codexBin, ["--version"]) : null
    },
    findings: {
      dynamicTools,
      hotkeyWindowThreadPages: hotkeyWindowFiles.map((file) => relative(root, file)),
      localConversationPages: localConversationFiles.map((file) => relative(root, file)),
      pinnedThreadsQueries: primaryPinnedQueryFiles.map((file) => relative(root, file)),
      setPinnedThreadActions: primarySetPinnedFiles.map((file) => relative(root, file)),
      threadActions
    }
  }
}

function printMarkdown(report) {
  console.log("# Codex Thread Window And Pin Evidence")
  console.log("")
  console.log(`- Extracted root: ${report.codex.appAsarRoot}`)
  console.log(`- Codex CLI: ${report.codex.cliVersion ?? "(not found)"}`)
  console.log("")

  console.log("## Thread Header Actions")
  if (report.findings.threadActions.length === 0) {
    console.log("- No `threadHeader.openInNewWindow` owner found.")
  }
  for (const item of report.findings.threadActions) {
    console.log(`- ${item.file}`)
    for (const message of item.messages) {
      console.log(`  - ${message.id}: ${message.defaultMessage}`)
    }
  }
  console.log("")

  console.log("## Thread Pin Evidence")
  for (const file of report.findings.pinnedThreadsQueries) {
    console.log(`- query: ${file}`)
  }
  for (const file of report.findings.setPinnedThreadActions) {
    console.log(`- mutation: ${file}`)
  }
  console.log("")

  console.log("## Separate Thread Window Evidence")
  for (const file of report.findings.hotkeyWindowThreadPages) {
    console.log(`- hotkey window page: ${file}`)
  }
  for (const file of report.findings.localConversationPages) {
    console.log(`- conversation page: ${file}`)
  }
  console.log("")

  console.log("## Dynamic Thread Tools")
  for (const item of report.findings.dynamicTools) {
    console.log(`- ${item.file}`)
    console.log(`  - tools: ${item.toolNames.join(", ") || "(none extracted)"}`)
  }
}

const args = readArgs(process.argv.slice(2))
const root = resolve(args.get("root") ?? "/tmp/codex-app-asar")
const codexBin = args.get("codex-bin") ?? "/Applications/Codex.app/Contents/Resources/codex"

if (!existsSync(root)) {
  throw new Error(`Extracted Codex bundle not found: ${root}`)
}

const report = createReport({ codexBin, root })
if (args.get("json") === "true") {
  console.log(JSON.stringify(report, null, 2))
} else {
  printMarkdown(report)
}
