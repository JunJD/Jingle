#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { builtinModules, createRequire } from "node:module"
import { basename, dirname, join, posix, resolve } from "node:path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  detectKnownExtensionBlockingAdapters,
  extendKnownExtensionGuide,
  extendKnownExtensionPreferenceTypeLiteral,
  suppressKnownExtensionBlockingAdapters
} from "./transforms/known-extensions/index.mjs"
import { rewritePublicOpenworkCopy } from "./transforms/openwork-copy.mjs"
import { rewriteSourceForOpenwork } from "./transforms/source-rewrite.mjs"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const OPENWORK_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const NODE_BUILTIN_MODULES = new Set(
  builtinModules.flatMap((name) => [name, name.replace(/^node:/, ""), `node:${name}`])
)

const SUPPORTED_PLATFORM_MAP = {
  macOS: "darwin",
  Windows: "win32",
  Linux: "linux"
}

const DEPENDENCY_DECISIONS = {
  "@mozilla/readability": {
    category: "direct-third-party",
    decision: "keep-direct-dependency",
    openworkTarget: "@mozilla/readability",
    reason:
      "Webpage body extraction for quick-capture should reuse the upstream Readability parser."
  },
  "@notionhq/client": {
    category: "direct-third-party",
    decision: "keep-direct-dependency",
    openworkTarget: "@notionhq/client",
    reason: "Official Notion client should be reused instead of hand-written HTTP adapters."
  },
  "@raycast/api": {
    category: "runtime-facade",
    decision: "rewrite-import",
    openworkTarget: "@openwork/extension-api",
    reason: "Raycast runtime-bound UI and host APIs must map to the Openwork extension author API."
  },
  "@raycast/utils": {
    category: "runtime-facade",
    decision: "rewrite-import-with-adapters",
    openworkTarget: "@openwork/extension-utils",
    reason:
      "Hooks can map to Openwork utilities, but auth helpers such as withAccessToken need connection handling."
  },
  "@tryfabric/martian": {
    category: "direct-third-party",
    decision: "keep-direct-dependency",
    openworkTarget: "@tryfabric/martian",
    reason: "Markdown-to-Notion block conversion should be reused for migration fidelity."
  },
  "date-fns": {
    category: "direct-third-party",
    decision: "keep-direct-dependency",
    openworkTarget: "date-fns",
    reason: "Date formatting behavior can be preserved during migration."
  },
  linkedom: {
    category: "direct-third-party",
    decision: "keep-direct-dependency",
    openworkTarget: "linkedom",
    reason: "Readability needs an HTML parser for quick-capture webpage extraction."
  },
  "notion-to-md": {
    category: "direct-third-party",
    decision: "keep-direct-dependency",
    openworkTarget: "notion-to-md",
    reason: "Notion block-to-Markdown conversion should be reused for page previews and AI tools."
  }
}

const RAYCAST_API_IMPORT_SUPPORT = {
  Action: {
    status: "supported",
    target: "Action"
  },
  ActionPanel: {
    status: "supported",
    target: "ActionPanel"
  },
  AI: {
    status: "supported",
    target: "AI"
  },
  Cache: {
    status: "supported",
    target: "Cache"
  },
  Clipboard: {
    status: "supported",
    target: "Clipboard"
  },
  Color: {
    status: "supported",
    target: "Color"
  },
  Detail: {
    status: "supported",
    target: "Detail"
  },
  Form: {
    status: "supported",
    target: "Form"
  },
  Icon: {
    status: "supported",
    target: "Icon"
  },
  Image: {
    status: "supported",
    target: "Image"
  },
  Keyboard: {
    status: "supported",
    target: "Keyboard"
  },
  LaunchProps: {
    status: "supported",
    target: "LaunchProps"
  },
  LaunchType: {
    status: "supported",
    target: "LaunchType"
  },
  List: {
    status: "supported",
    target: "List"
  },
  LocalStorage: {
    status: "supported",
    target: "LocalStorage"
  },
  OAuth: {
    note: "Openwork preserves the Raycast OAuth shape for migrated code; Notion V1 resolves tokens from connection secrets instead of running an interactive OAuth flow.",
    status: "supported-with-migration-note",
    target: "OAuth"
  },
  PopToRootType: {
    status: "supported",
    target: "PopToRootType"
  },
  Toast: {
    status: "supported",
    target: "Toast"
  },
  closeMainWindow: {
    status: "supported",
    target: "closeMainWindow"
  },
  confirmAlert: {
    status: "supported",
    target: "confirmAlert"
  },
  getPreferenceValues: {
    status: "supported",
    target: "getPreferenceValues"
  },
  getSelectedText: {
    status: "supported",
    target: "getSelectedText"
  },
  launchCommand: {
    status: "supported",
    target: "launchCommand"
  },
  open: {
    status: "supported",
    target: "open"
  },
  openCommandPreferences: {
    status: "supported",
    target: "openCommandPreferences"
  },
  openExtensionPreferences: {
    status: "supported",
    target: "openExtensionPreferences"
  },
  showHUD: {
    status: "supported",
    target: "showHUD"
  },
  showToast: {
    status: "supported",
    target: "showToast"
  },
  useNavigation: {
    status: "supported",
    target: "useNavigation"
  }
}

const RAYCAST_UTILS_IMPORT_SUPPORT = {
  FormValidation: {
    status: "supported",
    target: "FormValidation"
  },
  OAuthService: {
    note: "Openwork supports OAuthService token initialization through withAccessToken; Notion V1 resolves tokens from connection secrets instead of running an interactive OAuth flow.",
    status: "supported-with-migration-note",
    target: "OAuthService"
  },
  showFailureToast: {
    status: "supported",
    target: "showFailureToast"
  },
  useCachedPromise: {
    status: "supported",
    target: "useCachedPromise"
  },
  useFetch: {
    status: "supported",
    target: "useFetch"
  },
  useForm: {
    note: "Supports the Raycast-style itemProps.field shape plus reset/focus no-op compatibility.",
    status: "supported",
    target: "useForm"
  },
  useLocalStorage: {
    status: "supported",
    target: "useLocalStorage"
  },
  usePromise: {
    status: "supported",
    target: "usePromise"
  },
  withAccessToken: {
    status: "supported",
    target: "withAccessToken"
  },
  getAccessToken: {
    status: "supported",
    target: "getAccessToken"
  }
}

const MEMBER_SUPPORT = {
  "Action.CreateQuicklink": {
    status: "supported"
  },
  "Form.Description": {
    status: "supported"
  },
  "Form.ItemProps": {
    status: "supported"
  },
  "Form.Value": {
    status: "supported"
  },
  "Form.Values": {
    status: "supported"
  },
  "LaunchType.Background": {
    status: "supported"
  },
  "LaunchType.UserInitiated": {
    status: "supported"
  }
}

const SUPPORTED_ICON_MEMBERS = new Set([
  "ArrowDownCircle",
  "ArrowNe",
  "BlankDocument",
  "BulletPoints",
  "Calendar",
  "CheckCircle",
  "Checkmark",
  "ChevronDown",
  "ChevronUp",
  "ChevronUpDown",
  "Circle",
  "Dot",
  "Envelope",
  "Eye",
  "Globe",
  "Hashtag",
  "Link",
  "List",
  "MagnifyingGlass",
  "Paperclip",
  "Paragraph",
  "Person",
  "Phone",
  "Pin",
  "PinDisabled",
  "Plus",
  "QuestionMark",
  "SaveDocument",
  "Sidebar",
  "Stars",
  "Text",
  "Trash",
  "Upload"
])

const OPENWORK_DEFAULT_DEPENDENCY_VERSIONS = {
  "@mozilla/readability": "^0.6.0",
  "@notionhq/client": "^5.22.0",
  "@tryfabric/martian": "^1.2.4",
  "date-fns": "^4.3.0",
  linkedom: "^0.18.12",
  "lucide-react": "^0.469.0",
  "notion-to-md": "^3.1.9",
  react: "^19.2.1",
  zod: "^4.0.0"
}

const RUNTIME_CAPABILITY_ORDER = [
  "ai",
  "clipboard",
  "dialog",
  "navigation",
  "preferences",
  "quicklinks",
  "rpc",
  "settings",
  "shell",
  "storage",
  "toast"
]

const RUNTIME_CAPABILITY_IMPORTS = {
  AI: "ai",
  Clipboard: "clipboard",
  LocalStorage: "storage",
  closeMainWindow: "navigation",
  confirmAlert: "dialog",
  getPreferenceValues: "preferences",
  getSelectedText: "clipboard",
  launchCommand: "navigation",
  open: "shell",
  openCommandPreferences: "settings",
  openExtensionPreferences: "settings",
  openExternal: "shell",
  openNativeExtensionSettings: "settings",
  showHUD: "toast",
  showToast: "toast",
  useExtensionStorageState: "storage",
  useNavigation: "navigation",
  useNativeCommandPreferences: "preferences"
}

const RUNTIME_CAPABILITY_MEMBERS = {
  "Action.CopyToClipboard": "clipboard",
  "Action.CreateQuicklink": "quicklinks",
  "Action.OpenInBrowser": "shell",
  "Action.Paste": "clipboard"
}

const STORE_VALUE_COMPONENTS = new Set([
  "Form.Checkbox",
  "Form.DatePicker",
  "Form.Dropdown",
  "Form.TagPicker",
  "Form.TextArea",
  "Form.TextField",
  "List.Dropdown"
])

const UTILS_RUNTIME_CAPABILITY_IMPORTS = {
  OAuthService: "preferences",
  getAccessToken: "preferences",
  showFailureToast: "toast",
  useFetch: "toast",
  useLocalStorage: "storage",
  withAccessToken: ["preferences", "settings"]
}

function isSupportedStatus(status) {
  return (
    status === "supported" ||
    status === "supported-with-adapter-note" ||
    status === "supported-with-degradation" ||
    status === "supported-with-migration-note"
  )
}

export function parseRaycastAiMigrationPreviewArgs(argv) {
  const args = {
    extensionPath: null,
    gitRef: "HEAD",
    gitRepo: null,
    hostEntryMode: "migrated-source",
    out: null,
    outDir: null,
    targetExtensionId: null,
    targetExtensionTitle: null
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--git-repo") {
      args.gitRepo = argv[++index]
    } else if (arg === "--extension-path") {
      args.extensionPath = argv[++index]
    } else if (arg === "--git-ref") {
      args.gitRef = argv[++index]
    } else if (arg === "--host-entry-mode") {
      args.hostEntryMode = argv[++index]
    } else if (arg === "--out") {
      args.out = argv[++index]
    } else if (arg === "--out-dir") {
      args.outDir = argv[++index]
    } else if (arg === "--target-extension-id") {
      args.targetExtensionId = argv[++index]
    } else if (arg === "--target-extension-title") {
      args.targetExtensionTitle = argv[++index]
    } else if (!arg.startsWith("--") && args.extensionPath === null) {
      args.extensionPath = arg
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!args.extensionPath) {
    throw new Error(
      "Usage: node scripts/preview-raycast-ai-migration.mjs <extension-path> [--out file] [--out-dir dir] [--host-entry-mode migrated-source|shell] [--target-extension-id id] [--target-extension-title title]\n" +
        "   or: node scripts/preview-raycast-ai-migration.mjs --git-repo ../raycast-extensions --extension-path extensions/notion [--git-ref HEAD] [--out-dir dir] [--host-entry-mode migrated-source|shell] [--target-extension-id id] [--target-extension-title title]"
    )
  }
  if (!["migrated-source", "shell"].includes(args.hostEntryMode)) {
    throw new Error(
      `Unknown --host-entry-mode "${args.hostEntryMode}". Expected "migrated-source" or "shell".`
    )
  }

  return args
}

function createReader(args) {
  if (args.gitRepo) {
    const repo = resolve(args.gitRepo)
    const extensionPath = stripTrailingSlash(args.extensionPath)
    const toExtensionRelativePath = (relativePath) =>
      relativePath.startsWith(`${extensionPath}/`)
        ? relativePath.slice(extensionPath.length + 1)
        : relativePath
    const toRepoRelativePath = (relativePath) =>
      relativePath.startsWith(`${extensionPath}/`)
        ? relativePath
        : posix.join(extensionPath, relativePath)
    const readGit = (gitArgs, options = {}) =>
      execFileSync("git", ["-c", "gc.auto=0", "-C", repo, ...gitArgs], {
        maxBuffer: 16 * 1024 * 1024,
        ...options
      })

    return {
      listFiles(relativePath) {
        const repoRelativePath = toRepoRelativePath(relativePath)
        return readGit(["ls-tree", "-r", "--name-only", args.gitRef, repoRelativePath], {
          encoding: "utf8"
        })
          .split("\n")
          .map((entry) => entry.trim())
          .filter(Boolean)
          .map(toExtensionRelativePath)
      },
      readBuffer(relativePath) {
        const repoRelativePath = toRepoRelativePath(relativePath)
        return readGit(["show", `${args.gitRef}:${repoRelativePath}`])
      },
      readText(relativePath) {
        return this.readBuffer(relativePath).toString("utf8")
      },
      sourceLabel: `${repo}:${args.gitRef}:${args.extensionPath}`
    }
  }

  const root = resolve(args.extensionPath)
  const extensionPath = stripTrailingSlash(args.extensionPath)
  const toLocalPath = (relativePath) => {
    const path = String(relativePath)
    if (path === extensionPath || path === root) {
      return ""
    }
    if (path.startsWith(`${extensionPath}/`)) {
      return path.slice(extensionPath.length + 1)
    }
    if (path.startsWith(`${root}/`)) {
      return path.slice(root.length + 1)
    }
    return path
  }

  return {
    listFiles(relativePath) {
      const absoluteRoot = join(root, toLocalPath(relativePath))
      if (!existsSync(absoluteRoot)) {
        return []
      }

      return execFileSync("find", [absoluteRoot, "-type", "f"], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024
      })
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => entry.slice(root.length + 1))
    },
    readBuffer(relativePath) {
      return readFileSync(join(root, toLocalPath(relativePath)))
    },
    readText(relativePath) {
      return readFileSync(join(root, toLocalPath(relativePath)), "utf8")
    },
    sourceLabel: root
  }
}

function stripTrailingSlash(path) {
  return String(path).replace(/\/+$/, "")
}

function readPackageJson(reader, extensionPath) {
  const raw = reader.readText(posix.join(extensionPath, "package.json"))
  return JSON.parse(raw)
}

function toOpenworkToolName(raycastName) {
  return String(raycastName).replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase())
}

function normalizeInstructions(value) {
  if (typeof value !== "string") {
    return []
  }

  return value
    .replaceAll("\\n", "\n")
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^[-*]\s*/, "")
        .trim()
    )
    .filter(Boolean)
}

function mapPlatforms(platforms) {
  if (!Array.isArray(platforms)) {
    return undefined
  }

  const mapped = platforms
    .map((platform) => SUPPORTED_PLATFORM_MAP[platform])
    .filter((platform) => typeof platform === "string")

  return mapped.length > 0 ? mapped : undefined
}

function buildManifestPreview(pkg, sourceFiles, target) {
  const tools = Array.isArray(pkg.tools) ? pkg.tools : []
  const toolNames = tools.map((tool) => toOpenworkToolName(tool.name)).filter(Boolean)
  const migratedPreferences = migratePreferences(pkg.preferences)
  const requiredPreferenceNames = suggestRequiredPreferenceNames(migratedPreferences)
  const toolDisplays = Object.fromEntries(
    tools
      .filter((tool) => typeof tool.name === "string")
      .map((tool) => [
        toOpenworkToolName(tool.name),
        {
          description: tool.description ?? tool.title ?? tool.name,
          title: tool.title ?? tool.name
        }
      ])
  )

  return rewritePublicOpenworkCopy({
    aiCapability: {
      connectionId: "default",
      description: pkg.description,
      guide: buildGuide(pkg, target, requiredPreferenceNames),
      id: target.extensionId,
      instructions: normalizeInstructions(pkg.ai?.instructions),
      mention: {
        label: target.title,
        value: target.extensionId
      },
      requiredPreferenceNames,
      supportedPlatforms: mapPlatforms(pkg.platforms),
      title: target.title,
      toolDisplays,
      toolNames
    },
    capabilities: inferLauncherCapabilities(pkg, sourceFiles),
    commands: (pkg.commands ?? []).map((command) => ({
      arguments: command.arguments ?? [],
      description: command.description,
      mode: command.mode,
      name: command.name,
      preferences: migratePreferences(command.preferences),
      runtime:
        command.mode === "view"
          ? {
              viewport: {
                bodyHeight: 520
              }
            }
          : undefined,
      title: command.title
    })),
    connection: {
      auth: buildConnectionAuthPreview(requiredPreferenceNames),
      id: "default",
      provider: pkg.name,
      title: target.title
    },
    description: pkg.description,
    icon: pkg.icon ? `assets/${pkg.icon}` : undefined,
    name: target.extensionId,
    preferences: migratedPreferences,
    runtimeCapabilities: inferRuntimeCapabilities(sourceFiles),
    runtimeShell: inferRuntimeShell(sourceFiles),
    supportedPlatforms: mapPlatforms(pkg.platforms),
    title: target.title
  })
}

function buildConnectionAuthPreview(requiredPreferenceNames) {
  return requiredPreferenceNames.length > 0
    ? {
        secretNames: requiredPreferenceNames,
        type: "apiKey"
      }
    : {
        type: "none"
      }
}

function inferLauncherCapabilities(pkg, sourceFiles) {
  const capabilities = new Set(["navigation", "surface"])
  if (Array.isArray(pkg.rpcMethods) && pkg.rpcMethods.length > 0) {
    capabilities.add("rpc")
  }
  return ["clipboard", "navigation", "rpc", "surface", "threads"].filter((capability) =>
    capabilities.has(capability)
  )
}

function inferRuntimeCapabilities(sourceFiles) {
  const capabilities = new Set()

  for (const file of sourceFiles) {
    for (const importEntry of file.imports) {
      if (importEntry.source === "@raycast/api") {
        for (const specifier of importEntry.specifiers.filter((entry) => !entry.typeOnly)) {
          const capability = RUNTIME_CAPABILITY_IMPORTS[specifier.imported]
          if (capability) {
            capabilities.add(capability)
          }
        }
      }

      if (importEntry.source === "@raycast/utils") {
        for (const specifier of importEntry.specifiers.filter((entry) => !entry.typeOnly)) {
          const capabilitiesForImport = normalizeRuntimeCapabilities(
            UTILS_RUNTIME_CAPABILITY_IMPORTS[specifier.imported]
          )
          for (const capability of capabilitiesForImport) {
            capabilities.add(capability)
          }
        }
      }
    }

    for (const usage of file.memberUsages) {
      const capability = RUNTIME_CAPABILITY_MEMBERS[usage.member]
      if (capability) {
        capabilities.add(capability)
      }
    }

    for (const capability of file.implicitRuntimeCapabilities) {
      capabilities.add(capability)
    }
  }

  return RUNTIME_CAPABILITY_ORDER.filter((capability) => capabilities.has(capability))
}

function normalizeRuntimeCapabilities(value) {
  if (!value) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

function inferRuntimeShell(sourceFiles) {
  const allowedUrlSchemes = Array.from(
    new Set(sourceFiles.flatMap((file) => extractDesktopUrlSchemes(file.sourceText)))
  ).sort((left, right) => left.localeCompare(right))

  return allowedUrlSchemes.length > 0 ? { allowedUrlSchemes } : undefined
}

function extractDesktopUrlSchemes(sourceText) {
  const schemes = []
  for (const match of sourceText.matchAll(/\b([a-z][a-z0-9+.-]*):\/\//gi)) {
    const scheme = match[1]?.toLowerCase()
    if (!scheme || scheme === "http" || scheme === "https" || scheme === "raycast") {
      continue
    }
    schemes.push(scheme)
  }
  return schemes
}

function migratePreferences(preferences) {
  if (!Array.isArray(preferences)) {
    return []
  }

  return preferences.map((preference) => migratePreference(preference))
}

function migratePreference(preference) {
  let migratedPreference = preference

  if (preference.type === "password" && /token|secret|key/i.test(preference.name ?? "")) {
    migratedPreference = {
      ...preference,
      description:
        preference.description ??
        "Token used by Openwork to connect this extension to the external service.",
      name: "accessToken",
      title: preference.title ?? "Access Token"
    }
  }

  if (migratedPreference.type !== "appPicker") {
    return migratedPreference
  }

  const defaultApplication = normalizeApplicationPreferenceDefault(migratedPreference.default)
  if (defaultApplication === undefined) {
    const preferenceWithoutDefault = { ...migratedPreference }
    delete preferenceWithoutDefault.default
    return preferenceWithoutDefault
  }

  return {
    ...migratedPreference,
    default: defaultApplication
  }
}

function normalizeApplicationPreferenceDefault(value) {
  if (value === undefined) {
    return undefined
  }

  if (typeof value === "string") {
    const name = value.trim()
    return name ? { name } : undefined
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  const application = {}
  for (const key of ["name", "bundleId", "path"]) {
    if (typeof value[key] === "string" && value[key].trim()) {
      application[key] = value[key].trim()
    }
  }

  return Object.keys(application).length > 0 ? application : undefined
}

function buildDependencyReport(pkg, sourceFiles) {
  const runtimeDependencies = pkg.dependencies ?? {}
  const devDependencies = pkg.devDependencies ?? {}
  const importUsage = new Map()

  for (const file of sourceFiles) {
    for (const source of file.imports.map((entry) => entry.source)) {
      const dependencyName = normalizeImportDependencyName(source)
      if (!isPackageDependencyName(dependencyName)) {
        continue
      }
      if (!importUsage.has(dependencyName)) {
        importUsage.set(dependencyName, [])
      }
      importUsage.get(dependencyName).push(file.path)
    }
  }

  const dependencyNames = Array.from(
    new Set([...Object.keys(runtimeDependencies), ...importUsage.keys()])
  ).sort((left, right) => left.localeCompare(right))

  return dependencyNames.map((name) => {
    const decision = DEPENDENCY_DECISIONS[name] ?? {
      category: name.startsWith("@raycast/") ? "runtime-facade" : "unclassified",
      decision: name.startsWith("@raycast/") ? "rewrite-import" : "review",
      openworkTarget: name.startsWith("@raycast/") ? undefined : name,
      reason: name.startsWith("@raycast/")
        ? "Raycast runtime package needs an Openwork facade or rewrite."
        : "No migration decision is encoded for this dependency yet."
    }
    const version = runtimeDependencies[name]

    return {
      category: decision.category,
      decision: decision.decision,
      declaredAs: Object.hasOwn(runtimeDependencies, name)
        ? "dependency"
        : Object.hasOwn(devDependencies, name)
          ? "devDependency"
          : "import",
      importedBy: Array.from(new Set(importUsage.get(name) ?? [])).sort(),
      name,
      openworkTarget: decision.openworkTarget,
      reason: decision.reason,
      version
    }
  })
}

function buildRuntimeCompatibilityReport(sourceFiles) {
  const entries = []

  for (const file of sourceFiles) {
    const importSupportEntries = file.imports.flatMap((importEntry) =>
      importEntry.specifiers.map((specifier) => ({
        import: specifier.imported,
        localName: specifier.local,
        source: importEntry.source,
        ...resolveImportSupport(importEntry.source, specifier.imported)
      }))
    )
    const memberSupportEntries = file.memberUsages
    const unsupportedImports = importSupportEntries.filter(
      (entry) => !isSupportedStatus(entry.status)
    )
    const unsupportedMembers = memberSupportEntries.filter(
      (usage) => !isSupportedStatus(usage.status)
    )
    const adapterNotes = collectSupportNotes("supported-with-adapter-note", [
      ...importSupportEntries,
      ...memberSupportEntries
    ])
    const degradationNotes = collectSupportNotes("supported-with-degradation", [
      ...importSupportEntries,
      ...memberSupportEntries
    ])
    const migrationNotes = collectSupportNotes("supported-with-migration-note", [
      ...importSupportEntries,
      ...memberSupportEntries
    ])
    const blockingAdapters = Array.from(new Set([...file.blockingAdapters]))

    if (
      adapterNotes.length === 0 &&
      degradationNotes.length === 0 &&
      migrationNotes.length === 0 &&
      unsupportedImports.length === 0 &&
      unsupportedMembers.length === 0 &&
      blockingAdapters.length === 0
    ) {
      continue
    }

    entries.push({
      adapterNotes,
      blockingAdapters,
      degradationNotes,
      file: file.path,
      migrationNotes,
      unsupportedImports,
      unsupportedMembers
    })
  }

  const adapterNoteCount = entries.reduce((count, entry) => count + entry.adapterNotes.length, 0)
  const blockingAdapterCount = entries.reduce(
    (count, entry) => count + entry.blockingAdapters.length,
    0
  )
  const degradationNoteCount = entries.reduce(
    (count, entry) => count + entry.degradationNotes.length,
    0
  )
  const migrationNoteCount = entries.reduce((count, entry) => count + entry.migrationNotes.length, 0)
  const unsupportedImportCount = entries.reduce(
    (count, entry) => count + entry.unsupportedImports.length,
    0
  )
  const unsupportedMemberCount = entries.reduce(
    (count, entry) => count + entry.unsupportedMembers.length,
    0
  )

  const counts = {
    adapterNotes: adapterNoteCount,
    blockingAdapters: blockingAdapterCount,
    blockingIssues: blockingAdapterCount + unsupportedImportCount + unsupportedMemberCount,
    compatibilityNotes: adapterNoteCount + degradationNoteCount + migrationNoteCount,
    degradationNotes: degradationNoteCount,
    files: entries.length,
    migrationNotes: migrationNoteCount,
    unsupportedImports: unsupportedImportCount,
    unsupportedMembers: unsupportedMemberCount
  }

  return {
    counts,
    entries
  }
}

function collectSupportNotes(status, entries) {
  return entries.filter((entry) => entry.status === status)
}

function collectSourceFiles(reader, extensionPath, target) {
  const sourceFiles = reader
    .listFiles(posix.join(extensionPath, "src"))
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .map((file) => {
      const sourceText = reader.readText(file)
      const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true)
      const imports = extractImportDetails(sourceFile)
      return {
        blockingAdapters: detectBlockingAdapters(sourceText, file, target),
        implicitRuntimeCapabilities: extractImplicitRuntimeCapabilities(sourceFile, imports),
        imports,
        memberUsages: extractMemberUsages(sourceFile, imports),
        path: file,
        sourceText
      }
    })
  return suppressKnownExtensionBlockingAdapters(sourceFiles, target)
}

function buildGuide(pkg, target, requiredPreferenceNames = []) {
  const title = target.title
  const guide = [
    `Use ${title} only when the user asks for ${title} data or actions.`,
    requiredPreferenceNames.length > 0
      ? `${title} tools require a connected account before reading or changing extension data.`
      : null,
    "If auth status is missing, explain that the extension must be connected in Settings first."
  ]
    .filter(Boolean)
    .join(" ")
  return extendKnownExtensionGuide(guide, { pkg, target })
}

function suggestRequiredPreferenceNames(preferences) {
  if (!Array.isArray(preferences)) {
    return []
  }

  const token = preferences.find((preference) => /token|secret|key/i.test(preference.name ?? ""))
  if (!token) {
    return []
  }

  return ["accessToken"]
}

function extractToolPreview(reader, extensionPath, pkg, target) {
  const toolFiles = reader
    .listFiles(posix.join(extensionPath, "src/tools"))
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))

  const manifestToolsByName = new Map((pkg.tools ?? []).map((tool) => [tool.name, tool]))

  return toolFiles.map((file) => {
    const sourceText = reader.readText(file)
    const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true)
    const raycastName = basename(file).replace(/\.[cm]?tsx?$/, "")
    const manifestTool = manifestToolsByName.get(raycastName)
    return {
      blockingAdapters: detectBlockingAdapters(sourceText, file, target),
      confirmation: extractToolConfirmation(sourceFile, file),
      dependencies: extractImports(sourceFile),
      description: manifestTool?.description,
      input: extractInputShape(sourceFile),
      openworkName: toOpenworkToolName(raycastName),
      raycastName,
      recommendedAccess: inferAccess(raycastName, sourceText),
      sourceFile: file,
      title: manifestTool?.title ?? raycastName,
      zodSchemaDraft: buildZodSchemaDraft(
        toOpenworkToolName(raycastName),
        extractInputShape(sourceFile)
      )
    }
  })
}

function hasExportModifier(node) {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
}

function hasNamedExport(sourceFile, exportName) {
  let found = false

  sourceFile.forEachChild((node) => {
    if (found) {
      return
    }

    if (
      ts.isFunctionDeclaration(node) &&
      hasExportModifier(node) &&
      node.name?.text === exportName
    ) {
      found = true
      return
    }

    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      found = node.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === exportName
      )
      return
    }

    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      found = node.exportClause.elements.some(
        (element) => (element.propertyName?.text ?? element.name.text) === exportName
      )
    }
  })

  return found
}

function extractToolConfirmation(sourceFile, file) {
  return hasNamedExport(sourceFile, "confirmation")
    ? {
        exportName: "confirmation",
        sourceFile: file
      }
    : undefined
}

function extractImports(sourceFile) {
  return extractImportDetails(sourceFile).map((entry) => entry.source)
}

function extractImportDetails(sourceFile) {
  const imports = []
  sourceFile.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({
        source: node.moduleSpecifier.text,
        specifiers: extractImportSpecifiers(node)
      })
    }
  })
  return imports
}

function extractImportSpecifiers(node) {
  const importClause = node.importClause
  if (!importClause) {
    return []
  }

  const specifiers = []
  if (importClause.name) {
    specifiers.push({
      imported: "default",
      local: importClause.name.text,
      typeOnly: importClause.isTypeOnly
    })
  }

  const namedBindings = importClause.namedBindings
  if (namedBindings && ts.isNamedImports(namedBindings)) {
    for (const element of namedBindings.elements) {
      specifiers.push({
        imported: element.propertyName?.text ?? element.name.text,
        local: element.name.text,
        typeOnly: importClause.isTypeOnly || element.isTypeOnly
      })
    }
  }

  return specifiers
}

function extractRelativeImportTargets(filePath, imports) {
  return imports
    .map((entry) => entry.source)
    .filter((source) => source.startsWith("."))
    .map((source) => normalizeRelativeImportPath(filePath, source))
}

function normalizeRelativeImportPath(filePath, importSource) {
  const baseDirectory = posix.dirname(filePath)
  const normalized = posix.normalize(posix.join(baseDirectory, importSource))
  return normalized.replace(/^\.\//, "")
}

function resolveImportSupport(source, importedName) {
  const support =
    source === "@raycast/api"
      ? RAYCAST_API_IMPORT_SUPPORT[importedName]
      : source === "@raycast/utils"
        ? RAYCAST_UTILS_IMPORT_SUPPORT[importedName]
        : undefined

  if (!support) {
    return {
      status: source.startsWith("@raycast/") ? "unsupported" : "supported"
    }
  }

  return support
}

function extractMemberUsages(sourceFile, imports) {
  const importedRaycastLocals = new Map()
  for (const importEntry of imports) {
    if (importEntry.source !== "@raycast/api" && importEntry.source !== "@raycast/utils") {
      continue
    }

    for (const specifier of importEntry.specifiers) {
      if (specifier.typeOnly) {
        continue
      }
      importedRaycastLocals.set(specifier.local, specifier.imported)
    }
  }

  const usages = new Map()
  visitMemberExpressions(sourceFile, (node) => {
    const expression = node.expression
    if (!ts.isIdentifier(expression)) {
      return
    }

    const importedName = importedRaycastLocals.get(expression.text)
    if (!importedName) {
      return
    }

    const memberName = node.name.text
    const key = `${importedName}.${memberName}`
    const support = resolveMemberSupport(importedName, memberName)
    if (support.status === "supported" && !RUNTIME_CAPABILITY_MEMBERS[key]) {
      return
    }

    const previous = usages.get(key)
    usages.set(key, {
      count: (previous?.count ?? 0) + 1,
      member: key,
      ...support
    })
  })

  return Array.from(usages.values()).sort((left, right) => left.member.localeCompare(right.member))
}

function extractImplicitRuntimeCapabilities(sourceFile, imports) {
  const importedRaycastApiLocals = new Map()
  for (const importEntry of imports) {
    if (importEntry.source !== "@raycast/api") {
      continue
    }

    for (const specifier of importEntry.specifiers) {
      if (specifier.typeOnly) {
        continue
      }
      importedRaycastApiLocals.set(specifier.local, specifier.imported)
    }
  }

  const capabilities = new Set()
  visitJsxElements(sourceFile, (node) => {
    if (!hasEnabledJsxAttribute(node.attributes, "storeValue")) {
      return
    }

    const componentPath = resolveRaycastJsxComponentPath(node.tagName, importedRaycastApiLocals)
    if (componentPath && STORE_VALUE_COMPONENTS.has(componentPath)) {
      capabilities.add("storage")
    }
  })

  return Array.from(capabilities).sort((left, right) => left.localeCompare(right))
}

function visitJsxElements(node, callback) {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    callback(node)
  }

  node.forEachChild((child) => visitJsxElements(child, callback))
}

function hasEnabledJsxAttribute(attributes, name) {
  for (const property of attributes.properties) {
    if (!ts.isJsxAttribute(property) || property.name.text !== name) {
      continue
    }

    if (!property.initializer) {
      return true
    }

    if (ts.isJsxExpression(property.initializer)) {
      const expression = property.initializer.expression
      return Boolean(expression && expression.kind !== ts.SyntaxKind.FalseKeyword)
    }

    return true
  }

  return false
}

function resolveRaycastJsxComponentPath(tagName, importedRaycastApiLocals) {
  const path = resolveExpressionPath(tagName)
  if (!path || path.length === 0) {
    return null
  }

  const importedRoot = importedRaycastApiLocals.get(path[0])
  if (!importedRoot) {
    return null
  }

  return [importedRoot, ...path.slice(1)].join(".")
}

function resolveExpressionPath(expression) {
  if (ts.isIdentifier(expression)) {
    return [expression.text]
  }

  if (ts.isPropertyAccessExpression(expression)) {
    const left = resolveExpressionPath(expression.expression)
    return left ? [...left, expression.name.text] : null
  }

  return null
}

function visitMemberExpressions(node, callback) {
  if (ts.isPropertyAccessExpression(node)) {
    callback(node)
  }

  node.forEachChild((child) => visitMemberExpressions(child, callback))
}

function resolveMemberSupport(importedName, memberName) {
  const explicit = MEMBER_SUPPORT[`${importedName}.${memberName}`]
  if (explicit) {
    return explicit
  }

  if (importedName === "Icon") {
    return SUPPORTED_ICON_MEMBERS.has(memberName)
      ? { status: "supported" }
      : {
          note: `Icon.${memberName} is not in the Openwork icon facade yet.`,
          status: "unsupported"
        }
  }

  return {
    status: "supported"
  }
}

function detectBlockingAdapters(sourceText, filePath, target) {
  const blockers = []
  const isToolFile = filePath.includes("/src/tools/") || filePath.startsWith("src/tools/")
  blockers.push(...detectKnownExtensionBlockingAdapters({ filePath, isToolFile, sourceText, target }))
  return blockers
}

function buildUtilsBoundaryReport(sourceFiles) {
  const sourceFilesByPath = new Map(sourceFiles.map((file) => [file.path, file]))
  const resolvedRelativeImportsByPath = new Map(
    sourceFiles.map((file) => [
      file.path,
      extractRelativeImportTargets(file.path, file.imports)
        .map((target) => resolveSourceFilePath(target, sourceFilesByPath))
        .filter((target) => target !== null)
    ])
  )
  const toolReachableFiles = findFilesReachableFromTools(sourceFiles, resolvedRelativeImportsByPath)

  const entries = sourceFiles
    .filter((file) => isUtilsSourceFile(file.path))
    .map((file) => {
      const runtimeImports = file.imports
        .filter((entry) => entry.source === "@raycast/api" || entry.source === "@raycast/utils")
        .map((entry) => entry.source)
        .sort((left, right) => left.localeCompare(right))
      const runtimeMembers = [
        ...file.memberUsages.map((usage) => usage.member),
        ...file.implicitRuntimeCapabilities.map((capability) => `implicit:${capability}`)
      ].sort((left, right) => left.localeCompare(right))
      const toolReachable = toolReachableFiles.has(file.path)
      const classification = runtimeImports.length || runtimeMembers.length ? "runtime-bound" : "pure-helper"

      return {
        classification,
        file: file.path,
        recommendation:
          toolReachable && classification === "runtime-bound"
            ? "AI tool migration reaches a runtime-bound utils module; split pure helpers before promoting this path to main/domain tools."
            : classification === "runtime-bound"
              ? "Keep this helper on the UI/runtime side unless pure exports are split out."
              : "Safe as package-local pure helper; promote to shared package only after cross-extension reuse is proven.",
        runtimeImports,
        runtimeMembers,
        toolReachable
      }
    })

  return {
    counts: {
      pureHelpers: entries.filter((entry) => entry.classification === "pure-helper").length,
      runtimeBound: entries.filter((entry) => entry.classification === "runtime-bound").length,
      toolReachableRuntimeBound: entries.filter(
        (entry) => entry.toolReachable && entry.classification === "runtime-bound"
      ).length,
      utilsFiles: entries.length
    },
    entries
  }
}

function isUtilsSourceFile(filePath) {
  return filePath === "src/utils.ts" || filePath.startsWith("src/utils/")
}

function isToolSourceFile(filePath) {
  return filePath.includes("/src/tools/") || filePath.startsWith("src/tools/")
}

function findFilesReachableFromTools(sourceFiles, resolvedRelativeImportsByPath) {
  const reachable = new Set()
  const queue = sourceFiles.filter((file) => isToolSourceFile(file.path)).map((file) => file.path)

  while (queue.length > 0) {
    const currentPath = queue.shift()
    if (!currentPath || reachable.has(currentPath)) {
      continue
    }

    reachable.add(currentPath)
    for (const targetPath of resolvedRelativeImportsByPath.get(currentPath) ?? []) {
      queue.push(targetPath)
    }
  }

  return reachable
}

function resolveSourceFilePath(importTarget, sourceFilesByPath) {
  const candidates = [
    importTarget,
    `${importTarget}.ts`,
    `${importTarget}.tsx`,
    posix.join(importTarget, "index.ts"),
    posix.join(importTarget, "index.tsx")
  ]

  return candidates.find((candidate) => sourceFilesByPath.has(candidate)) ?? null
}

function inferAccess(raycastName, sourceText) {
  if (/^(add|create|delete|update|patch|archive|append)/i.test(raycastName)) {
    return "write"
  }
  if (
    sourceText.includes(".create(") ||
    sourceText.includes(".update(") ||
    sourceText.includes(".append(")
  ) {
    return "write"
  }
  return "read"
}

function extractInputShape(sourceFile) {
  const inputDeclaration = findInputDeclaration(sourceFile)
  if (!inputDeclaration) {
    return {
      fields: [],
      kind: "none"
    }
  }

  const members = ts.isInterfaceDeclaration(inputDeclaration)
    ? inputDeclaration.members
    : ts.isTypeLiteralNode(inputDeclaration.type)
      ? inputDeclaration.type.members
      : []

  return {
    fields: Array.from(members)
      .filter(ts.isPropertySignature)
      .map((member) => ({
        description: readJsDoc(member),
        name: member.name.getText(sourceFile).replace(/^["']|["']$/g, ""),
        optional: Boolean(member.questionToken),
        tsType: member.type ? member.type.getText(sourceFile) : "unknown",
        zod: toZodExpression(
          member.type ? member.type.getText(sourceFile) : "unknown",
          Boolean(member.questionToken)
        )
      })),
    kind: ts.isInterfaceDeclaration(inputDeclaration) ? "interface" : "type"
  }
}

function findInputDeclaration(sourceFile) {
  let found = null
  sourceFile.forEachChild((node) => {
    if (found) {
      return
    }
    if (ts.isTypeAliasDeclaration(node) && node.name.text === "Input") {
      found = node
      return
    }
    if (ts.isInterfaceDeclaration(node) && node.name.text === "Input") {
      found = node
    }
  })
  return found
}

function readJsDoc(node) {
  const comments = ts.getJSDocCommentsAndTags(node)
  return comments
    .map((comment) => {
      if (ts.isJSDoc(comment)) {
        return typeof comment.comment === "string" ? comment.comment : ""
      }
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function toZodExpression(tsType, optional) {
  let expression = "z.unknown()"
  if (tsType === "string") {
    expression = "z.string().trim().min(1)"
  } else if (tsType === "number") {
    expression = "z.number()"
  } else if (tsType === "boolean") {
    expression = "z.boolean()"
  } else if (/Array<|[\w)]\[\]$/.test(tsType)) {
    expression = "z.array(z.unknown())"
  } else if (/^".*"( \| ".*")*$/.test(tsType)) {
    const values = tsType
      .split("|")
      .map((entry) => entry.trim().replace(/^"|"$/g, ""))
      .filter(Boolean)
    if (values.length > 0) {
      expression = `z.enum(${JSON.stringify(values)})`
    }
  }

  return optional ? `${expression}.optional()` : expression
}

function buildZodSchemaDraft(openworkName, input) {
  if (input.fields.length === 0) {
    return `const ${openworkName}InputSchema = z.object({})`
  }

  const fields = input.fields
    .map((field) => `  ${JSON.stringify(field.name)}: ${field.zod}`)
    .join(",\n")

  return `const ${openworkName}InputSchema = z.object({\n${fields}\n})`
}

function classifyFeasibility(preview) {
  const tools = preview.tools
  const toolsWithSchemaDrafts = tools.filter((tool) => Boolean(tool.zodSchemaDraft)).length
  const runtimeCompatibility = getRuntimeCompatibility(preview)
  const unsupportedApiCount =
    runtimeCompatibility.counts.unsupportedImports + runtimeCompatibility.counts.unsupportedMembers
  const toolHandlersWithSource = tools.filter((tool) =>
    resolveToolSourceImportPath(preview, tool, "../")
  ).length
  const toolsWithBlockingAdapters = tools.filter((tool) => tool.blockingAdapters.length > 0).length
  const toolHandlerScore =
    tools.length === 0
      ? "none"
      : toolHandlersWithSource === tools.length && toolsWithBlockingAdapters === 0
        ? "high"
        : toolHandlersWithSource > 0
          ? "medium"
          : "low"
  return {
    automatic: [
      "package metadata -> Openwork extension manifest draft",
      "tools[] metadata -> aiCapability.toolNames and toolDisplays",
      "ai.instructions -> aiCapability.instructions",
      "simple TypeScript Input types -> zod schema drafts",
      "withAccessToken -> Openwork connection secret resolver",
      "src/tools handlers -> generated Openwork tool definitions through the migrated runtime SDK context"
    ],
    manualOrAdapterRequired: [
      "Raycast OAuth interactive authorization -> Openwork interactive connection flow",
      "Raycast UI commands/components -> Openwork runtime SDK components",
      "Raycast toast/navigation/storage hooks -> Openwork host capabilities"
    ],
    score: {
      manifest: "high",
      migrationReport: unsupportedApiCount > 0 ? "high" : "medium",
      toolMetadata: "high",
      toolInputSchemas: toolsWithSchemaDrafts === tools.length ? "high" : "medium",
      toolHandlers: toolHandlerScore,
      uiCommands: unsupportedApiCount === 0 ? "medium" : "low"
    }
  }
}

function getRuntimeCompatibility(preview) {
  return preview.runtimeCompatibility ?? preview.unsupportedApis
}

export function buildRaycastAiMigrationPreview(args) {
  const reader = createReader(args)
  const pkg = readPackageJson(reader, args.extensionPath)
  const target = resolveMigrationTarget(pkg, args)
  const sourceFiles = collectSourceFiles(reader, args.extensionPath, target)
  const runtimeCompatibility = buildRuntimeCompatibilityReport(sourceFiles)
  const utilsBoundaryReport = buildUtilsBoundaryReport(sourceFiles)
  const sourceMigration = buildSourceMigration(reader, args.extensionPath, sourceFiles, target)
  const preview = {
    dependencyReport: buildDependencyReport(pkg, sourceFiles),
    feasibility: null,
    hostEntryMode: args.hostEntryMode ?? "migrated-source",
    manifestPreview: buildManifestPreview(pkg, sourceFiles, target),
    runtimeCompatibility,
    source: {
      extensionPath: args.extensionPath,
      label: reader.sourceLabel,
      packageName: pkg.name,
      targetExtensionId: target.extensionId,
      targetTitle: target.title,
      title: pkg.title
    },
    sourceMigration,
    tools: extractToolPreview(reader, args.extensionPath, pkg, target),
    transformDiagnostics: sourceMigration.diagnostics,
    utilsBoundaryReport,
    unsupportedApis: runtimeCompatibility
  }
  preview.feasibility = classifyFeasibility(preview)
  return preview
}

function resolveMigrationTarget(pkg, args) {
  const sourceExtensionId = String(pkg.name).trim()
  if (!sourceExtensionId) {
    throw new Error("Source extension id must be non-empty.")
  }

  const extensionId =
    args.targetExtensionId == null
      ? normalizeOpenworkExtensionId(pkg.name)
      : String(args.targetExtensionId).trim()
  if (!extensionId) {
    throw new Error("Target extension id must be non-empty.")
  }
  assertOpenworkExtensionId(extensionId)

  const title = String(args.targetExtensionTitle ?? pkg.title ?? extensionId).trim()
  if (!title) {
    throw new Error("Target extension title must be non-empty.")
  }

  return {
    extensionId,
    sourceExtensionId,
    title
  }
}

function normalizeOpenworkExtensionId(value) {
  const normalized = normalizeIdentifier(value)
  return /^[A-Za-z]/.test(normalized) ? normalized : `extension${toPascalCase(normalized)}`
}

function assertOpenworkExtensionId(value) {
  if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(value)) {
    throw new Error(
      `Target extension id "${value}" must start with a letter and contain only letters, numbers, or hyphens.`
    )
  }
}

export function buildRaycastAiMigrationArtifacts(preview) {
  const runtimeCompatibility = getRuntimeCompatibility(preview)
  const packagePreview = buildPackagePreview(preview)
  const hostPreview =
    preview.hostEntryMode === "shell" ? buildHostShellPreview(preview) : preview

  return {
    "dependency-report.md": buildDependencyReportMarkdown(preview),
    "main.preview.ts": buildMainPreviewSource(preview),
    "manifest.patch.json": `${JSON.stringify(preview.manifestPreview, null, 2)}\n`,
    "manifest.preview.ts": buildManifestPreviewSource(preview),
    "migration-preview.json": `${JSON.stringify(serializeMigrationPreview(preview), null, 2)}\n`,
    "openwork-package/main.ts": buildMainPreviewSource(hostPreview, "./main/tools"),
    "openwork-package/identity.ts": buildIdentityPreviewSource(preview),
    "openwork-package/main/tools.ts": buildToolsPreviewSource(hostPreview, "../"),
    "openwork-package/manifest.ts": buildManifestPreviewSource(hostPreview, {
      useCommandMetaImports: true
    }),
    "openwork-package/package.json": `${JSON.stringify(packagePreview, null, 2)}\n`,
    "openwork-package/runtime-metadata.ts": buildRuntimeMetadataPreviewSource(hostPreview),
    "openwork-package/runtime.ts": buildRuntimePreviewSource(hostPreview),
    "openwork-package/tsconfig.check.json": `${JSON.stringify(buildPackageTypecheckConfig(hostPreview), null, 2)}\n`,
    "openwork-package/types.d.ts": buildTypesPreviewSource(hostPreview),
    ...buildSourceMigrationArtifacts(preview, {
      includeSources: preview.hostEntryMode !== "shell"
    }),
    ...buildCommandContractArtifacts(hostPreview),
    "package.preview.json": `${JSON.stringify(buildPackagePreview(preview), null, 2)}\n`,
    "tools.preview.json": `${JSON.stringify(preview.tools, null, 2)}\n`,
    "tools.preview.ts": buildToolsPreviewSource(preview, "./openwork-package/"),
    "transform-diagnostics.json": `${JSON.stringify(preview.transformDiagnostics, null, 2)}\n`,
    "utils-boundary-report.json": `${JSON.stringify(preview.utilsBoundaryReport, null, 2)}\n`,
    "runtime-compatibility.json": `${JSON.stringify(runtimeCompatibility, null, 2)}\n`,
    "unsupported-apis.json": `${JSON.stringify(runtimeCompatibility, null, 2)}\n`
  }
}

function buildHostShellPreview(preview) {
  return {
    ...preview,
    manifestPreview: {
      ...preview.manifestPreview,
      aiCapability: preview.manifestPreview.aiCapability
        ? {
            ...preview.manifestPreview.aiCapability,
            toolDisplays: {},
            toolNames: []
          }
        : preview.manifestPreview.aiCapability,
      commands: preview.manifestPreview.commands
        .filter(
          (command) =>
            command.mode === "view" || command.mode === "menu-bar" || command.mode === "no-view"
        )
        .map((command) => ({
          ...command,
          runtime: command.runtime ?? {
            viewport: {
              bodyHeight: 520
            }
          }
        })),
      runtimeCapabilities: ["preferences"],
      runtimeShell: undefined
    },
    sourceMigration: {
      ...preview.sourceMigration,
      sourceFiles: []
    },
    tools: []
  }
}

function buildPackageTypecheckConfig(preview) {
  const include =
    preview.hostEntryMode === "shell"
      ? [
          "main.ts",
          "main/**/*.ts",
          "identity.ts",
          "manifest.ts",
          "runtime-metadata.ts",
          "runtime.ts",
          "src/*.meta.ts",
          "types.d.ts"
        ]
      : [
          "main.ts",
          "main/**/*.ts",
          "identity.ts",
          "manifest.ts",
          "runtime-metadata.ts",
          "runtime.ts",
          "src/**/*.ts",
          "src/**/*.tsx",
          "types.d.ts"
        ]

  const config = {
    compilerOptions: {
      allowSyntheticDefaultImports: true,
      baseUrl: ".",
      esModuleInterop: true,
      jsx: "react-jsx",
      lib: ["ESNext", "DOM", "DOM.Iterable"],
      module: "ESNext",
      moduleResolution: "Bundler",
      noEmit: true,
      noImplicitReturns: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      paths: {
        ...buildDependencyTypecheckPaths(preview),
        "@openwork/extension-api": [
          join(OPENWORK_REPO_ROOT, "packages/extension-api/src/index.ts")
        ],
        "@openwork/extension-utils": [
          join(OPENWORK_REPO_ROOT, "packages/extension-utils/src/index.ts")
        ],
        "@shared/*": [join(OPENWORK_REPO_ROOT, "src/shared/*")]
      },
      skipLibCheck: true,
      strict: true,
      target: "ESNext",
      typeRoots: ["./node_modules/@types", join(OPENWORK_REPO_ROOT, "node_modules/@types")]
    },
    include
  }

  if (preview.hostEntryMode === "shell") {
    config.exclude = ["main/migrated-src/**/*.ts", "main/migrated-src/**/*.tsx"]
  }

  return config
}

function buildDependencyTypecheckPaths(preview) {
  const dependencies = buildPackagePreview(preview).dependencies
  const paths = {}

  for (const name of Object.keys(dependencies)) {
    if (name === "react" || name.startsWith("@openwork/")) {
      continue
    }

    const packageRoot = join(OPENWORK_REPO_ROOT, "node_modules", name)
    paths[name] = [packageRoot]
    paths[`${name}/*`] = [`${packageRoot}/*`]
  }

  return paths
}

export function runRaycastAiMigrationPreviewCli(argv, io = {}) {
  const args = parseRaycastAiMigrationPreviewArgs(argv)
  const preview = buildRaycastAiMigrationPreview(args)

  const output = `${JSON.stringify(serializeMigrationPreview(preview), null, 2)}\n`
  if (args.outDir) {
    writeRaycastAiMigrationArtifacts(args.outDir, preview)
  }
  if (args.out) {
    writeFileSync(resolve(args.out), output)
  } else if (!args.outDir) {
    ;(io.stdout ?? process.stdout).write(output)
  }
}

function writeRaycastAiMigrationArtifacts(outDir, preview) {
  const absoluteOutDir = resolve(outDir)
  mkdirSync(absoluteOutDir, { recursive: true })

  for (const [fileName, content] of Object.entries(buildRaycastAiMigrationArtifacts(preview))) {
    const filePath = join(absoluteOutDir, fileName)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content)
  }
}

function serializeMigrationPreview(preview) {
  return {
    ...preview,
    sourceMigration: {
      assetFiles: preview.sourceMigration.assetFiles.map(({ outputPath, path }) => ({
        outputPath,
        path
      })),
      diagnostics: preview.sourceMigration.diagnostics,
      sourceFiles: preview.sourceMigration.sourceFiles.map(
        ({ diagnostics, mainOutputPath, notes, outputPath, path }) => ({
          diagnostics,
          ...(mainOutputPath ? { mainOutputPath } : {}),
          notes,
          outputPath,
          path
        })
      )
    }
  }
}

function buildDependencyReportMarkdown(preview) {
  const runtimeCompatibility = getRuntimeCompatibility(preview)
  const dependencyRows = preview.dependencyReport.map((dependency) =>
    [
      formatMarkdownCell(dependency.name),
      formatMarkdownCell(dependency.category),
      formatMarkdownCell(dependency.decision),
      formatMarkdownCell(dependency.openworkTarget ?? ""),
      formatMarkdownCell(dependency.version ?? ""),
      formatMarkdownCell(dependency.importedBy.join(", ")),
      formatMarkdownCell(dependency.reason)
    ].join(" | ")
  )

  return `${[
    "# Extension Dependency Report",
    "",
    `Source: ${preview.source.label}`,
    `Package: ${preview.source.packageName}`,
    "",
    "## Dependencies",
    "",
    "Name | Category | Decision | Openwork Target | Version | Imported By | Reason",
    "--- | --- | --- | --- | --- | --- | ---",
    ...dependencyRows,
    "",
    "## Runtime Compatibility Summary",
    "",
    `Files: ${runtimeCompatibility.counts.files}`,
    `Blocking issues: ${runtimeCompatibility.counts.blockingIssues}`,
    `Compatibility notes: ${runtimeCompatibility.counts.compatibilityNotes}`,
    `Adapter notes: ${runtimeCompatibility.counts.adapterNotes}`,
    `Blocking adapters: ${runtimeCompatibility.counts.blockingAdapters}`,
    `Degradation notes: ${runtimeCompatibility.counts.degradationNotes}`,
    `Migration notes: ${runtimeCompatibility.counts.migrationNotes}`,
    `Unsupported imports: ${runtimeCompatibility.counts.unsupportedImports}`,
    `Unsupported members: ${runtimeCompatibility.counts.unsupportedMembers}`,
    "",
    "## Utils Boundary Summary",
    "",
    `Utils files: ${preview.utilsBoundaryReport.counts.utilsFiles}`,
    `Pure helpers: ${preview.utilsBoundaryReport.counts.pureHelpers}`,
    `Runtime-bound utils: ${preview.utilsBoundaryReport.counts.runtimeBound}`,
    `AI tool reachable runtime-bound utils: ${preview.utilsBoundaryReport.counts.toolReachableRuntimeBound}`,
    "",
    "## Transform Diagnostics Summary",
    "",
    `Diagnostics: ${preview.transformDiagnostics.length}`,
    ...preview.transformDiagnostics.map(
      (diagnostic) =>
        `- ${diagnostic.severity}: ${diagnostic.transform} (${diagnostic.file}) - ${diagnostic.message}`
    ),
    "",
    "## Feasibility",
    "",
    `Manifest: ${preview.feasibility.score.manifest}`,
    `Migration report: ${preview.feasibility.score.migrationReport}`,
    `Tool metadata: ${preview.feasibility.score.toolMetadata}`,
    `Tool input schemas: ${preview.feasibility.score.toolInputSchemas}`,
    `Tool handlers: ${preview.feasibility.score.toolHandlers}`,
    `UI commands: ${preview.feasibility.score.uiCommands}`
  ].join("\n")}\n`
}

function collectTransformDiagnostics(sourceFiles) {
  const seen = new Set()
  const diagnostics = []

  for (const file of sourceFiles) {
    for (const diagnostic of file.diagnostics ?? []) {
      const key = [file.path, diagnostic.transform, diagnostic.severity, diagnostic.message].join("\0")
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      diagnostics.push({
        file: file.path,
        message: diagnostic.message,
        severity: diagnostic.severity,
        transform: diagnostic.transform
      })
    }
  }

  return diagnostics
}

function formatMarkdownCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>")
}

function buildToolsPreviewSource(preview, migratedSourceImportPrefix = "./") {
  const tools = preview.tools
  const hasTools = tools.length > 0
  const schemaDefinitions = tools.map((tool) => tool.zodSchemaDraft).join("\n\n")
  const toolDefinitions = tools.map(buildToolDefinitionSource).join(",\n\n")
  const hasMigratedToolSources = tools.some((tool) =>
    resolveToolSourceImportPath(preview, tool, migratedSourceImportPrefix)
  )

  return `${[
    hasTools ? 'import { z } from "zod/v4"' : null,
    hasMigratedToolSources
      ? 'import { runWithExtensionRuntimeSdk } from "@openwork/extension-api"'
      : null,
    hasMigratedToolSources
      ? 'import type { ExtensionToolConfirmation, ExtensionToolContext, ExtensionToolDefinition } from "@openwork/extension-api"'
      : 'import type { ExtensionToolDefinition } from "@openwork/extension-api"',
    hasMigratedToolSources
      ? `import { EXTENSION_AI_TOOL_HOST_REQUEST_ID } from ${JSON.stringify(`${migratedSourceImportPrefix}identity`)}`
      : null,
    "",
    hasMigratedToolSources
      ? "// Generated migration preview. Handlers call migrated source tool modules inside an Openwork SDK context."
      : "// Generated migration preview. Fill each handler with migrated Openwork logic before wiring this into an extension package.",
    schemaDefinitions,
    "",
    hasMigratedToolSources
      ? buildMigratedToolRunnerSource(preview, migratedSourceImportPrefix)
      : null,
    hasMigratedToolSources ? "" : null,
    `export function ${getToolsFactoryName(preview)}(): ExtensionToolDefinition[] {`,
    "  return [",
    hasTools ? indent(toolDefinitions, 4) : null,
    "  ]",
    "}",
    ""
  ]
    .filter((line) => line !== null)
    .join("\n")}`
}

function buildManifestPreviewSource(preview, options = {}) {
  const manifestName = getManifestExportName(preview)
  const viewportImports = options.useCommandMetaImports ? buildManifestViewportImports(preview) : []
  const manifestSource = options.useCommandMetaImports
    ? buildManifestPreviewObjectSource(preview)
    : JSON.stringify(preview.manifestPreview, null, 2)
  return `${[
    'import { defineNativeExtensionManifest } from "@openwork/extension-api"',
    ...viewportImports,
    "",
    "// Generated migration preview. Review commands, preferences, runtime capabilities, and connection semantics before wiring this into an extension package.",
    `export const ${manifestName} = defineNativeExtensionManifest(${manifestSource})`,
    ""
  ].join("\n")}`
}

function buildManifestViewportImports(preview) {
  const imports = preview.manifestPreview.commands
    .filter((command) => command.mode === "view")
    .map(
      (command) =>
        `import { viewport as ${getCommandViewportImportName(command.name)} } from ${JSON.stringify(
          `./src/${command.name}.meta`
        )}`
    )
  imports.push(
    'import { EXTENSION_ID, EXTENSION_PROVIDER_ID, EXTENSION_TITLE } from "./identity"'
  )
  return imports
}

function buildManifestPreviewObjectSource(preview) {
  const manifest = JSON.parse(JSON.stringify(preview.manifestPreview))
  const replacements = new Map()

  if (manifest.aiCapability?.id) {
    manifest.aiCapability.id = "__OPENWORK_EXTENSION_ID__"
    replacements.set(JSON.stringify("__OPENWORK_EXTENSION_ID__"), "EXTENSION_ID")
  }
  if (manifest.aiCapability?.title) {
    manifest.aiCapability.title = "__OPENWORK_EXTENSION_TITLE__"
    replacements.set(JSON.stringify("__OPENWORK_EXTENSION_TITLE__"), "EXTENSION_TITLE")
  }
  if (manifest.aiCapability?.mention?.value) {
    manifest.aiCapability.mention.value = "__OPENWORK_EXTENSION_ID__"
  }
  if (manifest.connection?.provider) {
    manifest.connection.provider = "__OPENWORK_EXTENSION_PROVIDER_ID__"
    replacements.set(
      JSON.stringify("__OPENWORK_EXTENSION_PROVIDER_ID__"),
      "EXTENSION_PROVIDER_ID"
    )
  }
  if (manifest.connection?.title) {
    manifest.connection.title = "__OPENWORK_EXTENSION_TITLE__"
  }
  if (manifest.name) {
    manifest.name = "__OPENWORK_EXTENSION_ID__"
  }
  if (manifest.title) {
    manifest.title = "__OPENWORK_EXTENSION_TITLE__"
  }

  for (const command of manifest.commands) {
    if (command.mode !== "view" || !command.runtime?.viewport) {
      continue
    }

    const placeholder = `__OPENWORK_COMMAND_VIEWPORT_${command.name}__`
    command.runtime.viewport = placeholder
    replacements.set(JSON.stringify(placeholder), getCommandViewportImportName(command.name))
  }

  let source = JSON.stringify(manifest, null, 2)
  for (const [placeholder, replacement] of replacements) {
    source = source.replaceAll(placeholder, replacement)
  }

  return source
}

function buildMainPreviewSource(preview, toolsImportPath = "./tools.preview") {
  const mainName = getMainExportName(preview)
  const toolsFactoryName = getToolsFactoryName(preview)
  return `${[
    'import { defineNativeExtensionMain } from "@openwork/extension-api"',
    `import { ${toolsFactoryName} } from ${JSON.stringify(toolsImportPath)}`,
    "",
    "// Generated migration preview. Add a native service if migrated commands need RPC handlers.",
    `export const ${mainName} = defineNativeExtensionMain({`,
    `  tools: ${toolsFactoryName}()`,
    "})",
    ""
  ].join("\n")}`
}

function buildRuntimePreviewSource(preview) {
  const runtimeName = getRuntimeExportName(preview)
  const commandEntries = preview.manifestPreview.commands.filter(
    (command) => command.runtime
  )
  const componentCommands = commandEntries.filter((command) => command.mode !== "no-view")
  const commandSourceEntries = componentCommands.map((command) => ({
    command,
    componentName: getCommandComponentName(preview, command.name),
    importPath: resolveCommandRuntimeImportPath(preview, command)
  }))
  const placeholderComponents = commandSourceEntries
    .filter((entry) => !entry.importPath)
    .map((entry) => buildRuntimePlaceholderComponentSource(entry))
  const importedComponents = commandSourceEntries
    .filter((entry) => entry.importPath)
    .map(
      (entry) =>
        `import ${entry.componentName}Source from ${JSON.stringify(entry.importPath)}`
    )
  const componentAliases = commandSourceEntries
    .filter((entry) => entry.importPath)
    .map(
      (entry) =>
        `const ${entry.componentName} = ${entry.componentName}Source as ComponentType<Record<string, unknown>>`
    )
  const commandDefinitions = commandEntries
    .map((command) =>
      buildRuntimeCommandDefinitionSource(preview, command)
    )
    .join(",\n")
  const reactImport =
    placeholderComponents.length > 0 && componentAliases.length > 0
      ? 'import { createElement, type ComponentType } from "react"'
      : placeholderComponents.length > 0
        ? 'import { createElement } from "react"'
        : componentAliases.length > 0
          ? 'import type { ComponentType } from "react"'
          : null
  const runtimeImport =
    placeholderComponents.length > 0
      ? `import { ${buildRuntimePlaceholderImportNames(commandSourceEntries)}, defineNativeExtensionRuntime } from "@openwork/extension-api"`
      : 'import { defineNativeExtensionRuntime } from "@openwork/extension-api"'

  return `${[
    reactImport,
    runtimeImport,
    ...importedComponents,
    "",
    ...componentAliases,
    componentAliases.length > 0 ? "" : null,
    ...placeholderComponents,
    placeholderComponents.length > 0 ? "" : null,
    "// Generated migration preview. Source files are import-rewritten but may still need SDK facade work before this runtime compiles.",
    `export const ${runtimeName} = defineNativeExtensionRuntime({`,
    "  commands: {",
    indent(commandDefinitions, 4),
    "  },",
    `  extensionName: ${JSON.stringify(preview.manifestPreview.name)}`,
    "})",
    ""
  ]
    .filter((line) => line !== null)
    .join("\n")}`
}

function buildRuntimePlaceholderComponentSource(entry) {
  return entry.command.mode === "menu-bar"
    ? buildMenuBarRuntimePlaceholderComponentSource(entry)
    : buildDetailRuntimePlaceholderComponentSource(entry)
}

function buildDetailRuntimePlaceholderComponentSource(entry) {
  return [
    `function ${entry.componentName}() {`,
    "  return createElement(Detail, {",
    `    markdown: ${JSON.stringify(
      [
        `# ${entry.command.title}`,
        "",
        `Migrated command source for \`${entry.command.name}\` is present in this extension package, but this host entry is still running in shell mode.`,
        "",
        "Adapt the migrated Raycast command source to the Openwork extension runtime before promoting this command to a live UI command."
      ].join("\n")
    )},`,
    `    navigationTitle: ${JSON.stringify(entry.command.title)}`,
    "  })",
    "}"
  ].join("\n")
}

function buildMenuBarRuntimePlaceholderComponentSource(entry) {
  return [
    `function ${entry.componentName}() {`,
    "  return createElement(MenuBarExtra, {",
    `    title: ${JSON.stringify(entry.command.title)},`,
    `    tooltip: ${JSON.stringify(`${entry.command.title} is running in shell mode.`)}`,
    "  })",
    "}"
  ].join("\n")
}

function buildRuntimePlaceholderImportNames(commandSourceEntries) {
  const placeholderModes = new Set(
    commandSourceEntries
      .filter((entry) => !entry.importPath)
      .map((entry) => entry.command.mode)
  )
  const importNames = []
  if (placeholderModes.has("view")) {
    importNames.push("Detail")
  }
  if (placeholderModes.has("menu-bar")) {
    importNames.push("MenuBarExtra")
  }
  return importNames.join(", ")
}

function buildRuntimeCommandDefinitionSource(preview, command) {
  if (command.mode === "no-view") {
    return [
      `${JSON.stringify(command.name)}: {`,
      '  mode: "no-view",',
      "  run: async () => {}",
      "}"
    ].join("\n")
  }

  return [
    `${JSON.stringify(command.name)}: {`,
    `  Component: ${getCommandComponentName(preview, command.name)},`,
    `  mode: ${JSON.stringify(command.mode)}`,
    "}"
  ].join("\n")
}

function buildTypesPreviewSource(preview) {
  return `${[
    'import type { RuntimeOpenApplication } from "@openwork/extension-api"',
    "",
    "// Generated migration preview types that Openwork injects for migrated extensions.",
    "declare global {",
    `  type Preferences = Preferences.Extension`,
    "",
    "  namespace Preferences {",
    ...buildPreferenceTypeAliases(preview).map((line) => `    ${line}`),
    "  }",
    "",
    "  namespace Arguments {",
    ...buildArgumentTypeAliases(preview).map((line) => `    ${line}`),
    "  }",
    "}",
    "",
    "export {}",
    ""
  ].join("\n")}`
}

function buildPreferenceTypeAliases(preview) {
  const extensionPreferences = preview.manifestPreview.preferences ?? []
  const lines = [
    `type Extension = ${formatPreferenceTypeLiteral(preview, extensionPreferences, (preference) =>
      preferenceToType(preference)
    )}`
  ]

  for (const command of preview.manifestPreview.commands) {
    if (!Array.isArray(command.preferences) || command.preferences.length === 0) {
      continue
    }

    lines.push(
      `type ${toPascalCase(command.name)} = Extension & ${formatPreferenceTypeLiteral(
        preview,
        command.preferences,
        (preference) => preferenceToType(preference)
      )}`
    )
  }

  return lines
}

function buildArgumentTypeAliases(preview) {
  const lines = []

  for (const command of preview.manifestPreview.commands) {
    if (!Array.isArray(command.arguments) || command.arguments.length === 0) {
      continue
    }

    lines.push(
      `type ${toPascalCase(command.name)} = ${formatTypeLiteral(command.arguments, (argument) =>
        argumentToType(argument)
      )}`
    )
  }

  return lines.length > 0 ? lines : ["type Empty = Record<string, never>"]
}

function formatTypeLiteral(items, getType) {
  if (items.length === 0) {
    return "Record<string, never>"
  }

  return `{\n${items
    .map((item) => `      ${item.name}${item.required === false ? "?" : ""}: ${getType(item)}`)
    .join("\n")}\n    }`
}

function formatPreferenceTypeLiteral(preview, items, getType) {
  const literal = formatTypeLiteral(items, getType)
  return extendKnownExtensionPreferenceTypeLiteral(literal, { items, preview })
}

function preferenceToType(preference) {
  switch (preference.type) {
    case "checkbox":
      return "boolean"
    case "appPicker":
      return "RuntimeOpenApplication"
    case "dropdown":
    case "password":
    case "textfield":
    case "text":
    default:
      return "string"
  }
}

function argumentToType(argument) {
  switch (argument.type) {
    case "text":
    default:
      return "string"
  }
}

function buildRuntimeMetadataPreviewSource(preview) {
  const runtimeMetadataName = getRuntimeMetadataExportName(preview)
  const commands = preview.manifestPreview.commands.filter((command) => command.runtime)
  const commandConfigs = commands.map((command, index) =>
    buildRuntimeMetadataSearchConfig(command, index)
  )

  if (commands.length === 0) {
    return `${[
      'import { defineNativeExtensionRuntimeMetadata } from "@openwork/extension-api"',
      'import { EXTENSION_ID } from "./identity"',
      "",
      `export const ${runtimeMetadataName} = defineNativeExtensionRuntimeMetadata(${JSON.stringify(
        {
          commands: [],
          extensionName: "__OPENWORK_EXTENSION_ID__"
        },
        null,
        2
      ).replace(JSON.stringify("__OPENWORK_EXTENSION_ID__"), "EXTENSION_ID")})`,
      ""
    ].join("\n")}`
  }

  const searchCommandName = commands[0].name
  const commandEntries = commands
    .map((command) => {
      const lines = ["    {"]
      if (command.name === searchCommandName) {
        lines.push(`      name: ${JSON.stringify(command.name)},`, "      search")
      } else {
        lines.push(`      name: ${JSON.stringify(command.name)}`)
      }
      lines.push("    }")
      return lines.join("\n")
    })
    .join(",\n")

  return `${[
    'import { defineNativeExtensionRuntimeMetadata } from "@openwork/extension-api"',
    'import { EXTENSION_ICON, EXTENSION_ID, EXTENSION_SUBJECT_TERMS } from "./identity"',
    "",
    "interface GeneratedSearchCopy {",
    "  launcher: {",
    "    openGeneric: string",
    "    resultKindExtension: string",
    "  }",
    "}",
    "",
    "interface GeneratedCommandSearchConfig {",
    "  aliases: string[]",
    "  commandName: string",
    "  primaryActionLabel: string",
    "  priority: number",
    "  subtitle: string",
    "  terms: string[]",
    "  title: string",
    "  urlFallback: boolean",
    "}",
    "",
    `const commandSearchConfigs: GeneratedCommandSearchConfig[] = ${JSON.stringify(
      commandConfigs,
      null,
      2
    )}`,
    "",
    "function normalizeQuery(query: string): string {",
    "  return query.trim().toLowerCase()",
    "}",
    "",
    "function hasAnyTerm(query: string, terms: readonly string[]): boolean {",
    "  return terms.some((term) => query.includes(term))",
    "}",
    "",
    "function extractUrl(query: string): string | null {",
    "  return query.match(/https?:\\/\\/\\S+/i)?.[0] ?? null",
    "}",
    "",
    "function hasExtensionSubject(query: string): boolean {",
    "  return hasAnyTerm(query, EXTENSION_SUBJECT_TERMS)",
    "}",
    "",
    "function matchesCommandAlias(query: string, config: GeneratedCommandSearchConfig): boolean {",
    "  return EXTENSION_SUBJECT_TERMS.some((subject) =>",
    "    config.aliases.some((alias) => query === `${subject} ${alias}` || query === `${alias} ${subject}`)",
    "  )",
    "}",
    "",
    "function createExtensionIcon() {",
    "  if (EXTENSION_ICON) {",
    "    return {",
    "      extensionName: EXTENSION_ID,",
    "      icon: EXTENSION_ICON,",
    "      type: \"extension\" as const",
    "    }",
    "  }",
    "",
    "  return {",
    "    extensionName: EXTENSION_ID,",
    "    type: \"extension\" as const",
    "  }",
    "}",
    "",
    "function createPresentation(copy: GeneratedSearchCopy, primaryActionLabel: string) {",
    "  return {",
    "    categoryLabel: copy.launcher.resultKindExtension,",
    "    icon: createExtensionIcon(),",
    "    listActionLabel: copy.launcher.openGeneric,",
    "    primaryActionLabel,",
    "    tone: \"accent\" as const",
    "  }",
    "}",
    "",
    "const search = {",
    "  buildIntentItems: ({ copy, query }: { copy: GeneratedSearchCopy; query: string }) => {",
    "    const trimmedQuery = query.trim()",
    "    const normalizedQuery = normalizeQuery(query)",
    "",
    "    if (!trimmedQuery || !hasExtensionSubject(normalizedQuery)) {",
    "      return []",
    "    }",
    "",
    "    return commandSearchConfigs.flatMap((config) => {",
    "      if (!hasAnyTerm(normalizedQuery, config.terms)) {",
    "        return []",
    "      }",
    "",
    "      const url = config.urlFallback ? extractUrl(trimmedQuery) : null",
    "",
    "      return [",
    "        {",
    "          commandName: config.commandName,",
    "          id: `${EXTENSION_ID}:${config.commandName}:intent:${trimmedQuery}`,",
    "          kind: \"plugin\" as const,",
    "          openOptions: url",
    "            ? {",
    "                launchProps: {",
    "                  fallbackText: url",
    "                },",
    "                seedQuery: trimmedQuery",
    "              }",
    "            : {",
    "                seedQuery: trimmedQuery",
    "              },",
    "          presentation: createPresentation(copy, config.primaryActionLabel),",
    "          priority: config.priority,",
    "          subtitle: config.subtitle,",
    "          title: config.title",
    "        }",
    "      ]",
    "    })",
    "  },",
    "  resolveCommand: ({",
    "    altKey,",
    "    ctrlKey,",
    "    key,",
    "    metaKey,",
    "    query",
    "  }: {",
    "    altKey: boolean",
    "    ctrlKey: boolean",
    "    key: string",
    "    metaKey: boolean",
    "    query: string",
    "  }) => {",
    "    if (altKey || ctrlKey || metaKey || key !== \" \") {",
    "      return null",
    "    }",
    "",
    "    const normalizedQuery = normalizeQuery(query)",
    "    const matchedConfig = commandSearchConfigs.find((config) =>",
    "      matchesCommandAlias(normalizedQuery, config)",
    "    )",
    "",
    "    if (!matchedConfig) {",
    "      return null",
    "    }",
    "",
    "    return {",
    "      commandName: matchedConfig.commandName,",
    "      openOptions: {",
    "        seedQuery: \"\"",
    "      }",
    "    }",
    "  }",
    "}",
    "",
    `export const ${runtimeMetadataName} = defineNativeExtensionRuntimeMetadata({`,
    "  commands: [",
    commandEntries,
    "  ],",
    "  extensionName: EXTENSION_ID",
    "})",
    ""
  ].join("\n")}`
}

function buildIdentityPreviewSource(preview) {
  return `${[
    "export interface ExtensionIdentityProfile {",
    "  aiToolHostRequestId: string",
    "  extensionId: string",
    "  extensionTitle: string",
    "  providerId: string",
    "  subjectTerms: readonly string[]",
    "}",
    "",
    "export const EXTENSION_IDENTITY = {",
    `  aiToolHostRequestId: ${JSON.stringify(`${preview.manifestPreview.name}-ai-tool-host-request`)},`,
    `  extensionId: ${JSON.stringify(preview.manifestPreview.name)},`,
    `  extensionTitle: ${JSON.stringify(preview.manifestPreview.title)},`,
    `  providerId: ${JSON.stringify(preview.manifestPreview.connection?.provider ?? preview.manifestPreview.name)},`,
    `  subjectTerms: ${JSON.stringify(buildRuntimeMetadataExtensionSubjectTerms(preview), null, 2).replaceAll("\n", "\n  ")}`,
    "} as const satisfies ExtensionIdentityProfile",
    "",
    "export const EXTENSION_ID = EXTENSION_IDENTITY.extensionId",
    "export const EXTENSION_TITLE = EXTENSION_IDENTITY.extensionTitle",
    "export const EXTENSION_PROVIDER_ID = EXTENSION_IDENTITY.providerId",
    `export const EXTENSION_ICON = ${JSON.stringify(preview.manifestPreview.icon ?? null)}`,
    "export const EXTENSION_SUBJECT_TERMS = EXTENSION_IDENTITY.subjectTerms",
    "export const EXTENSION_AI_TOOL_HOST_REQUEST_ID = EXTENSION_IDENTITY.aiToolHostRequestId",
    ""
  ].join("\n")}`
}

function buildRuntimeMetadataExtensionSubjectTerms(preview) {
  return normalizeSearchTerms([
    preview.manifestPreview.name,
    preview.manifestPreview.name?.replace(/-/g, " "),
    preview.manifestPreview.title,
    preview.source.packageName,
    preview.source.title,
    String(preview.manifestPreview.name).split("-")[0],
    String(preview.manifestPreview.title).split(/\s+/)[0]
  ])
}

function buildRuntimeMetadataSearchConfig(command, index) {
  const searchText = `${command.name} ${command.title ?? ""} ${command.description ?? ""}`.toLowerCase()
  const terms = [
    command.name,
    command.name?.replace(/-/g, " "),
    command.title,
    ...inferCommandIntentTerms(searchText)
  ]

  return {
    aliases: buildRuntimeMetadataCommandAliases(command),
    commandName: command.name,
    primaryActionLabel: command.title ?? command.name,
    priority: Math.max(50, 120 - index * 5),
    subtitle: command.description ?? "",
    terms: normalizeSearchTerms(terms),
    title: command.title ?? command.name,
    urlFallback: /\b(capture|clip|save)\b|quick-capture/.test(searchText)
  }
}

function buildRuntimeMetadataCommandAliases(command) {
  return normalizeSearchTerms([
    command.name,
    command.name?.replace(/-/g, " "),
    command.title
  ])
}

function inferCommandIntentTerms(searchText) {
  const terms = []

  if (/\b(search|find)\b/.test(searchText)) {
    terms.push("search", "find", "look up", "搜索", "查找", "查询")
  }

  if (/\b(create|new)\b/.test(searchText)) {
    terms.push("create", "new", "新增", "新建", "创建")
  }

  if (/\b(capture|clip|save)\b|quick-capture/.test(searchText)) {
    terms.push("capture", "clip", "save", "保存", "收藏", "剪藏", "捕获")
  }

  if (/add-text|\b(add text|append|prepend)\b/.test(searchText)) {
    terms.push("add text", "append", "prepend", "追加", "写入", "添加内容", "添加文字")
  }

  return terms
}

function normalizeSearchTerms(values) {
  return Array.from(
    new Set(
      values
        .filter((value) => typeof value === "string")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    )
  )
}

function buildCommandContractArtifacts(preview) {
  const artifacts = {}
  const runtimeCommands = preview.manifestPreview.commands.filter((command) => command.runtime)

  for (const command of runtimeCommands) {
    if (command.mode === "view") {
      artifacts[`openwork-package/src/${command.name}.meta.ts`] = buildCommandMetaSource(command)
    }

    const wrapperSource = buildCommandWrapperSource(preview, command)
    if (wrapperSource) {
      artifacts[`openwork-package/src/${command.name}.tsx`] = wrapperSource
    } else if (preview.hostEntryMode === "shell") {
      artifacts[`openwork-package/src/${command.name}.tsx`] = buildCommandShellSource(command)
    }
  }

  return artifacts
}

function buildCommandMetaSource(command) {
  return `${[
    "export const viewport = {",
    `  bodyHeight: ${command.runtime.viewport.bodyHeight}`,
    "}",
    ""
  ].join("\n")}`
}

function buildCommandWrapperSource(preview, command) {
  if (preview.hostEntryMode === "shell") {
    return buildCommandShellSource(command)
  }

  if (resolveCanonicalCommandSourcePath(preview, command)) {
    return null
  }

  const importPath = resolveCommandSourceImportPath(preview, command)
  if (!importPath) {
    return null
  }

  return `export { default } from ${JSON.stringify(toCommandWrapperImportPath(importPath))}\n`
}

function buildCommandShellSource(command) {
  if (command.mode === "menu-bar") {
    return `${[
      'import { createElement } from "react"',
      'import { MenuBarExtra } from "@openwork/extension-api"',
      "",
      `export default function ${toPascalCase(command.name)}ShellCommand() {`,
      "  return createElement(MenuBarExtra, {",
      `    title: ${JSON.stringify(command.title ?? command.name)},`,
      `    tooltip: ${JSON.stringify(`${command.title ?? command.name} is running in shell mode.`)}`,
      "  })",
      "}",
      ""
    ].join("\n")}`
  }

  return `${[
    'import { createElement } from "react"',
    'import { Detail } from "@openwork/extension-api"',
    "",
    `export default function ${toPascalCase(command.name)}ShellCommand() {`,
    "  return createElement(Detail, {",
    `    markdown: ${JSON.stringify(
      [
        `# ${command.title ?? command.name}`,
        "",
        `Migrated command source for \`${command.name}\` is not wired into the Openwork runtime yet.`,
        "",
        "This shell keeps the extension package loadable while the Raycast command source is adapted."
      ].join("\n")
    )},`,
    `    navigationTitle: ${JSON.stringify(command.title ?? command.name)}`,
    "  })",
    "}",
    ""
  ].join("\n")}`
}

function toCommandWrapperImportPath(importPath) {
  return importPath.replace(/^\.\//, "./").replace(/^\.\.?\/*src\//, "./")
}

function buildPackagePreview(preview) {
  if (preview.hostEntryMode === "shell") {
    return {
      name: toOpenworkPackageName(preview.source.targetExtensionId ?? preview.source.packageName),
      version: "0.0.0",
      private: true,
      type: "module",
      main: "./main.ts",
      types: "./manifest.ts",
      dependencies: sortRecord({
        "@openwork/extension-api": "workspace:*",
        react:
          OPENWORK_DEFAULT_DEPENDENCY_VERSIONS.react ??
          preview.dependencyReport.find((dependency) => dependency.name === "react")?.version ??
          "latest"
      })
    }
  }

  const dependencies = Object.fromEntries(
    preview.dependencyReport
      .filter(
        (dependency) => dependency.openworkTarget && dependency.openworkTarget !== "@raycast/api"
      )
      .filter((dependency) => isPackageDependencyName(dependency.openworkTarget))
      .map((dependency) => [
        dependency.openworkTarget,
        dependency.openworkTarget?.startsWith("@openwork/")
          ? "workspace:*"
          : (OPENWORK_DEFAULT_DEPENDENCY_VERSIONS[dependency.openworkTarget] ??
            dependency.version ??
            "latest")
      ])
  )

  dependencies["@openwork/extension-api"] = "workspace:*"
  dependencies.zod = OPENWORK_DEFAULT_DEPENDENCY_VERSIONS.zod

  return {
    name: toOpenworkPackageName(preview.source.targetExtensionId ?? preview.source.packageName),
    version: "0.0.0",
    private: true,
    type: "module",
    main: "./main.ts",
    types: "./manifest.ts",
    dependencies: sortRecord(dependencies)
  }
}

function isPackageDependencyName(value) {
  const name = String(value)
  return (
    !name.startsWith(".") &&
    !name.startsWith("/") &&
    !NODE_BUILTIN_MODULES.has(name) &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(name)
  )
}

function normalizeImportDependencyName(source) {
  const value = String(source)
  if (value.startsWith("@")) {
    const [scope, name] = value.split("/")
    return name ? `${scope}/${name}` : value
  }
  return value.split("/")[0] ?? value
}

function toOpenworkPackageName(packageName) {
  const normalized = String(packageName)
    .replace(/^@raycast\//, "")
    .replace(/^@openwork\/extension-/, "")
  return `@openwork/extension-${normalized}`
}

function getExtensionIdentifier(preview) {
  return normalizeIdentifier(preview.manifestPreview.name ?? preview.source.packageName)
}

function getManifestExportName(preview) {
  return `${getExtensionIdentifier(preview)}Manifest`
}

function getMainExportName(preview) {
  return `${getExtensionIdentifier(preview)}Main`
}

function getRuntimeExportName(preview) {
  return `${getExtensionIdentifier(preview)}Runtime`
}

function getRuntimeMetadataExportName(preview) {
  return `${getExtensionIdentifier(preview)}RuntimeMetadata`
}

function getToolsFactoryName(preview) {
  return `create${toPascalCase(getExtensionIdentifier(preview))}Tools`
}

function getCommandComponentName(preview, commandName) {
  return `${toPascalCase(getExtensionIdentifier(preview))}${toPascalCase(commandName)}Command`
}

function getCommandViewportImportName(commandName) {
  return `${normalizeIdentifier(commandName)}Viewport`
}

function getToolFunctionName(tool) {
  return `${tool.openworkName}Tool`
}

function getToolConfirmationFunctionName(tool) {
  return `${tool.openworkName}Confirmation`
}

function resolveCommandSourceImportPath(preview, command) {
  const sourcePaths = new Set(preview.sourceMigration.sourceFiles.map((file) => file.path))
  for (const extension of [".tsx", ".ts"]) {
    const candidate = `src/${command.name}${extension}`
    if (sourcePaths.has(candidate)) {
      return `./${stripTypeScriptExtension(candidate)}`
    }
  }

  const viewCommands = preview.manifestPreview.commands.filter((entry) => entry.mode === "view")
  if (viewCommands.length === 1) {
    for (const candidate of ["src/index.tsx", "src/index.ts"]) {
      if (sourcePaths.has(candidate)) {
        return `./${stripTypeScriptExtension(candidate)}`
      }
    }
  }

  return null
}

function resolveCanonicalCommandSourcePath(preview, command) {
  const sourcePaths = new Set(preview.sourceMigration.sourceFiles.map((file) => file.path))
  for (const extension of [".tsx", ".ts"]) {
    const candidate = `src/${command.name}${extension}`
    if (sourcePaths.has(candidate)) {
      return candidate
    }
  }

  return null
}

function resolveCommandRuntimeImportPath(preview, command) {
  if (resolveCanonicalCommandSourcePath(preview, command)) {
    return `./src/${command.name}`
  }

  if (resolveCommandSourceImportPath(preview, command)) {
    return `./src/${command.name}`
  }

  return null
}

function resolveToolSourceImportPath(preview, tool, migratedSourceImportPrefix = "./") {
  const sourcePaths = new Set(preview.sourceMigration.sourceFiles.map((file) => file.mainOutputPath ?? file.path))
  for (const extension of [".ts", ".tsx"]) {
    const candidate = `main/migrated-src/tools/${tool.raycastName}${extension}`
    if (sourcePaths.has(candidate)) {
      return `${migratedSourceImportPrefix}${stripTypeScriptExtension(candidate)}`
    }
  }

  return null
}

function stripTypeScriptExtension(path) {
  return path.replace(/\.[cm]?tsx?$/, "")
}

function normalizeIdentifier(value) {
  const words = String(value)
    .replace(/^@[^/]+\//, "")
    .replace(/^extension-/, "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
  const normalized = words
    .map((word, index) => {
      const lower = word.toLowerCase()
      return index === 0 ? lower : toPascalCase(lower)
    })
    .join("")
  return normalized || "extension"
}

function toPascalCase(value) {
  return String(value)
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join("")
}

function sortRecord(record) {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
  )
}

function buildToolDefinitionSource(tool) {
  const schemaName = `${tool.openworkName}InputSchema`
  const functionName = getToolFunctionName(tool)
  const confirmationFunctionName = tool.confirmation ? getToolConfirmationFunctionName(tool) : null
  return `${[
    "{",
    `  access: ${JSON.stringify(tool.recommendedAccess)},`,
    confirmationFunctionName
      ? [
          "  approval: {",
          "    confirmation: async (input, ctx) => {",
          `      return ${confirmationFunctionName}(ctx, input)`,
          "    }",
          "  },"
        ].join("\n")
      : null,
    `  description: ${JSON.stringify(tool.description ?? tool.title)},`,
    "  handler: async (ctx, input) => {",
    `    return ${functionName}(ctx, input)`,
    "  },",
    `  inputSchema: ${schemaName},`,
    `  name: ${JSON.stringify(tool.openworkName)},`,
    `  title: ${JSON.stringify(tool.title)}`,
    "}"
  ]
    .filter((line) => line !== null)
    .join("\n")}`
}

function buildMigratedToolRunnerSource(preview, migratedSourceImportPrefix = "./") {
  const toolLoaders = preview.tools
    .map((tool) => {
      const importPath = resolveToolSourceImportPath(preview, tool, migratedSourceImportPrefix)
      if (!importPath) {
        return [
          `async function ${getToolFunctionName(tool)}(_ctx: ExtensionToolContext, _input: unknown): Promise<unknown> {`,
          `  throw new Error(${JSON.stringify(`Migrate ${tool.sourceFile} into an Openwork handler.`)})`,
          "}"
        ].join("\n")
      }

      return [
        `async function ${getToolFunctionName(tool)}(ctx: ExtensionToolContext, input: unknown): Promise<unknown> {`,
        `  return runMigratedTool(ctx, input, async () => (await import(${JSON.stringify(importPath)})).default)`,
        "}",
        tool.confirmation
          ? [
              "",
              `async function ${getToolConfirmationFunctionName(tool)}(ctx: ExtensionToolContext, input: unknown): Promise<ExtensionToolConfirmation> {`,
              `  return runMigratedTool<ExtensionToolConfirmation>(ctx, input, async () => (await import(${JSON.stringify(importPath)})).confirmation)`,
              "}"
            ].join("\n")
          : null
      ].join("\n")
    })
    .join("\n\n")

  return `${[
    "function createToolHostResponse(result: unknown) {",
    "  return {",
    "    id: EXTENSION_AI_TOOL_HOST_REQUEST_ID,",
    "    ok: true as const,",
    "    result",
    "  }",
    "}",
    "",
    "function createToolHostError(message: string) {",
    "  return {",
    "    error: {",
    '      code: "UNAVAILABLE",',
    "      message",
    "    },",
    "    id: EXTENSION_AI_TOOL_HOST_REQUEST_ID,",
    "    ok: false as const",
    "  }",
    "}",
    "",
    "async function requestMigratedToolHost(request: { capability: string; method: string }) {",
    '  if (request.capability === "toast" && request.method === "show") {',
    "    return createToolHostResponse(null)",
    "  }",
    "",
    '  if (request.capability === "navigation" && request.method === "hide-launcher") {',
    "    return createToolHostResponse(null)",
    "  }",
    "",
    "  return createToolHostError(",
    '    `Host capability "${request.capability}.${request.method}" is unavailable in migrated AI tool handlers.`',
    "  )",
    "}",
    "",
    "async function runMigratedTool<TOutput = unknown>(",
    "  ctx: ExtensionToolContext,",
    "  input: unknown,",
    "  loadHandler: () => Promise<(input: any) => TOutput | Promise<TOutput>>",
    "): Promise<TOutput> {",
    "  return runWithExtensionRuntimeSdk(",
    "    {",
    "      commandName: ctx.toolName,",
    "      commandPreferences: {},",
    "      extensionName: ctx.extensionName,",
    "      extensionPreferences: ctx.extensionPreferences,",
    '      initialAction: "open",',
    '      locale: "zh-CN",',
    '      mode: "no-view",',
    "      navigation: {",
    "        canPop: false,",
    "        goHome: () => {},",
    "        hideLauncher: async () => {},",
    "        openCommand: async () => {},",
    "        pop: () => {},",
    "        push: () => {}",
    "      },",
    "      requestHost: requestMigratedToolHost,",
    '      seedQuery: ""',
    "    },",
    "    async () => {",
    "      const handler = await loadHandler()",
    "      return handler(input)",
    "    }",
    "  )",
    "}",
    "",
    toolLoaders
  ].join("\n")}`
}

function indent(value, spaces) {
  const padding = " ".repeat(spaces)
  return value
    .split("\n")
    .map((line) => (line.length > 0 ? `${padding}${line}` : line))
    .join("\n")
}

function buildSourceMigration(reader, extensionPath, sourceFiles, target) {
  const sourceFilesByPath = new Map(sourceFiles.map((file) => [file.path, file]))
  const resolvedRelativeImportsByPath = new Map(
    sourceFiles.map((file) => [
      file.path,
      extractRelativeImportTargets(file.path, file.imports)
        .map((target) => resolveSourceFilePath(target, sourceFilesByPath))
        .filter((target) => target !== null)
    ])
  )
  const toolReachableFiles = findFilesReachableFromTools(sourceFiles, resolvedRelativeImportsByPath)
  const rewrittenSourceFiles = sourceFiles.flatMap((file) => {
    const rewrittenSource = rewriteSourceForOpenwork(file.sourceText, file.path, target, {
      sourceFiles
    })
    const output = {
      diagnostics: rewrittenSource.diagnostics,
      notes: file.blockingAdapters,
      outputPath: `openwork-package/${file.path}`,
      path: file.path,
      sourceText: rewrittenSource.sourceText
    }

    if (!toolReachableFiles.has(file.path)) {
      return [output]
    }

    const mainOutputPath = `main/migrated-${file.path}`
    return [
      output,
      {
        diagnostics: rewrittenSource.diagnostics,
        mainOutputPath,
        notes: file.blockingAdapters,
        outputPath: `openwork-package/${mainOutputPath}`,
        path: file.path,
        sourceText: rewrittenSource.sourceText
      }
    ]
  })
  const assetFiles = reader.listFiles(posix.join(extensionPath, "assets")).map((path) => ({
    outputPath: `openwork-package/${path}`,
    path,
    sourceBase64: reader.readBuffer(path).toString("base64")
  }))

  return {
    assetFiles,
    diagnostics: collectTransformDiagnostics(rewrittenSourceFiles),
    sourceFiles: rewrittenSourceFiles
  }
}

function buildSourceMigrationArtifacts(preview, options = {}) {
  const includeSources = options.includeSources ?? true
  const artifacts = {}

  if (includeSources) {
    for (const file of preview.sourceMigration.sourceFiles) {
      artifacts[file.outputPath] = file.sourceText
    }
  }

  if (preview.sourceMigration.assetFiles.length === 0) {
    artifacts["openwork-package/assets/.gitkeep"] = ""
  } else {
    for (const file of preview.sourceMigration.assetFiles) {
      artifacts[file.outputPath] = Buffer.from(file.sourceBase64, "base64")
    }
  }

  return artifacts
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRaycastAiMigrationPreviewCli(process.argv.slice(2))
}
