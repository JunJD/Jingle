import { app, nativeImage, shell } from "electron"
import PinyinMatch from "pinyin-match"
import { execFile } from "node:child_process"
import { promises as fs, watch, type Dirent, type FSWatcher } from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { createLauncherHistoryKey } from "@shared/launcher-history"
import type {
  LauncherSearchAction,
  LauncherSearchRequest,
  LauncherSearchResult
} from "@shared/launcher-search"
import type { LauncherSearchProvider, LauncherSearchProviderResponse } from "../types"
import {
  isWindowsShortcutPath,
  resolveWindowsApplicationIconPathCandidates
} from "./windows-shortcut-icon"

export interface LauncherApplicationRecord {
  appUserModelId?: string
  id: string
  bundleName: string
  displayName: string
  keywords: string[]
  localizedNames: string[]
  path: string
  subtitle: string
}

interface SystemProfilerApplicationEntry {
  _name?: string
  path?: string
}

interface SystemProfilerApplicationsPayload {
  SPApplicationsDataType?: SystemProfilerApplicationEntry[]
}

type WindowsStartMenuRootKind = "user-start-menu" | "system-start-menu"

interface WindowsStartMenuRoot {
  kind: WindowsStartMenuRootKind
  path: string
  priority: number
}

interface WindowsApplicationRecord extends LauncherApplicationRecord {
  sourcePriority: number
  targetPath?: string
}

interface WindowsPackagedApplicationRecord {
  appUserModelId: string
  bundleName: string
  displayName: string
  iconPath?: string
  id: string
  keywords: string[]
  localizedNames: string[]
  subtitle: string
}

type LauncherApplicationCatalogEntry =
  | {
      kind: "path"
      record: LauncherApplicationRecord
    }
  | {
      kind: "windows-packaged"
      record: WindowsPackagedApplicationRecord
    }

interface LauncherApplicationCatalogLoadResult {
  entries: LauncherApplicationCatalogEntry[]
  windowsPackagedApplicationIdByPath: ReadonlyMap<string, string>
  windowsPackagedApplicationsLoaded: boolean
  windowsSuppressedPathApplicationsByPath: ReadonlyMap<string, LauncherApplicationRecord>
}

interface WindowsApplicationCatalogMergeResult {
  entries: LauncherApplicationCatalogEntry[]
  windowsPackagedApplicationIdByPath: Map<string, string>
  windowsSuppressedPathApplicationsByPath: Map<string, LauncherApplicationRecord>
}

interface ApplicationsLauncherSearchProviderOptions {
  loadApplicationCatalog?: () => Promise<LauncherApplicationRecord[]>
  loadWindowsPackagedApplications?: () => Promise<WindowsPackagedApplicationRecord[]>
  now?: () => number
  platform?: NodeJS.Platform
  resolveApplicationIconDataUrl?: (applicationPath: string) => Promise<string | undefined>
}

const MAX_SCAN_DEPTH = 3
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
const execFileAsync = promisify(execFile)
const GENERIC_MAC_APP_ICON =
  "/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns"
const MAC_APPLICATION_DIRECTORIES = [
  "/Applications",
  path.join(os.homedir(), "Applications"),
  "/System/Applications",
  "/System/Applications/Utilities",
  "/System/Library/CoreServices/Applications"
]
const MAC_CHINESE_LOCALIZATION_DIRECTORIES = [
  "zh-Hans.lproj",
  "zh_CN.lproj",
  "zh.lproj",
  "Chinese.lproj"
]
const WINDOWS_START_MENU_FALLBACK_SUBTITLE = "开始菜单"
const APPLICATION_INDEX_REFRESH_DEBOUNCE_MS = 750
const WINDOWS_APPLICATION_CATALOG_TTL_MS = 30_000
const WINDOWS_PACKAGED_APPLICATION_SUBTITLE = "Microsoft Store"
const WINDOWS_START_APPS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
  "$OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
  "$packagesByFamily = @{}",
  "Get-AppxPackage | ForEach-Object { if ($_.PackageFamilyName -and $_.InstallLocation) { $packagesByFamily[[string]$_.PackageFamilyName] = $_ } }",
  "$applications = @(Get-StartApps | Where-Object { $_.AppID -like '*!*' } | ForEach-Object {",
  "  $appUserModelId = [string]$_.AppID",
  "  $appIdParts = $appUserModelId.Split('!', 2)",
  "  $iconPath = $null",
  "  $package = $packagesByFamily[$appIdParts[0]]",
  "  if ($package) {",
  "    try {",
  "      $manifest = Get-AppxPackageManifest -Package $package",
  "      $application = @($manifest.Package.Applications.Application) | Where-Object { [string]$_.Id -eq $appIdParts[1] } | Select-Object -First 1",
  "      $logo = [string]$application.VisualElements.Square44x44Logo",
  "      if (-not $logo) { $logo = [string]$application.VisualElements.Square30x30Logo }",
  "      if (-not $logo) { $logo = [string]$application.VisualElements.Square150x150Logo }",
  "      if (-not $logo) { $logo = [string]$application.VisualElements.Logo }",
  "      if ($logo -and -not $logo.StartsWith('ms-resource:')) { $iconPath = Join-Path ([string]$package.InstallLocation) $logo }",
  "    } catch {}",
  "  }",
  "  [PSCustomObject]@{ appUserModelId = $appUserModelId; displayName = [string]$_.Name; iconPath = [string]$iconPath }",
  "})",
  "ConvertTo-Json -Compress -InputObject $applications"
].join("\n")

function normalizeSearchValue(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function getTitleMatchRange(title: string, query: string): [number, number] | undefined {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return undefined
  }

  const index = title.toLocaleLowerCase().indexOf(trimmedQuery.toLocaleLowerCase())
  if (index >= 0) {
    return [index, index + trimmedQuery.length - 1]
  }

  return getPinyinMatchRange(title, trimmedQuery)
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function buildSearchKeywords(...names: string[]): string[] {
  const variants: string[] = []

  for (const name of names) {
    if (!name.trim()) {
      continue
    }

    const normalizedName = name
      .replace(/[._-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
    const compactName = normalizedName.replace(/\s+/g, "")
    const segments = normalizedName.split(" ").filter(Boolean)
    const acronym = segments.length > 1 ? segments.map((segment) => segment[0]).join("") : ""

    variants.push(...[name, normalizedName, compactName, acronym].map(normalizeSearchValue))
  }

  return uniqueStrings(variants)
}

function normalizeApplicationContainerLabel(label: string): string {
  const trimmedLabel = label
    .replace(/^\{[0-9a-f-]+\}\s*/i, "")
    .replace(/\.localized$/i, "")
    .trim()

  switch (trimmedLabel) {
    case "Applications":
      return "应用程序"
    case "Utilities":
      return "实用工具"
    default:
      return trimmedLabel
  }
}

function getMacApplicationSubtitle(applicationPath: string): string {
  const parentDirectoryName = normalizeApplicationContainerLabel(
    path.basename(path.dirname(applicationPath))
  )
  const grandparentDirectoryName = normalizeApplicationContainerLabel(
    path.basename(path.dirname(path.dirname(applicationPath)))
  )

  if (
    parentDirectoryName === "应用程序" &&
    grandparentDirectoryName &&
    grandparentDirectoryName !== "应用程序" &&
    /Applications/i.test(grandparentDirectoryName)
  ) {
    return grandparentDirectoryName
  }

  if (parentDirectoryName) {
    return parentDirectoryName
  }

  if (grandparentDirectoryName) {
    return grandparentDirectoryName
  }

  return "应用程序"
}

function getWindowsStartMenuRoots(): WindowsStartMenuRoot[] {
  const appData = process.env.APPDATA
  const programData = process.env.PROGRAMDATA

  if (!appData || !programData) {
    throw new Error("Missing Windows Start Menu environment variables")
  }

  return [
    {
      kind: "user-start-menu",
      path: path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs"),
      priority: 0
    },
    {
      kind: "system-start-menu",
      path: path.join(programData, "Microsoft", "Windows", "Start Menu", "Programs"),
      priority: 1
    }
  ]
}

function normalizeWindowsPath(filePath: string): string {
  return path.win32.normalize(filePath).toLowerCase()
}

function getWindowsPowerShellPath(): string {
  const systemRoot = process.env.SystemRoot?.trim()
  if (!systemRoot) {
    throw new Error("Missing Windows SystemRoot environment variable")
  }

  return path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
}

function isWindowsPackagedApplicationId(value: string): boolean {
  return /^[a-z0-9._-]+![a-z0-9._-]+$/i.test(value)
}

function getWindowsPackagedApplicationIdKey(value: string | undefined): string | undefined {
  const appUserModelId = value?.trim()
  if (!appUserModelId || !isWindowsPackagedApplicationId(appUserModelId)) {
    return undefined
  }

  return appUserModelId.toLowerCase()
}

function parseWindowsPackagedApplications(value: unknown): WindowsPackagedApplicationRecord[] {
  if (!Array.isArray(value)) {
    throw new Error("Windows Start Apps returned an invalid catalog payload")
  }

  const applicationsById = new Map<string, WindowsPackagedApplicationRecord>()

  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue
    }

    const record = entry as Record<string, unknown>
    const appUserModelId =
      typeof record["appUserModelId"] === "string" ? record["appUserModelId"].trim() : ""
    const displayName =
      typeof record["displayName"] === "string" ? record["displayName"].trim() : ""
    const iconPath = typeof record["iconPath"] === "string" ? record["iconPath"].trim() : ""

    if (
      !appUserModelId ||
      !displayName ||
      !isWindowsPackagedApplicationId(appUserModelId) ||
      isWindowsUninstallEntry(displayName)
    ) {
      continue
    }

    const normalizedId = appUserModelId.toLowerCase()
    applicationsById.set(normalizedId, {
      appUserModelId,
      bundleName: displayName,
      displayName,
      ...(iconPath ? { iconPath } : {}),
      id: `windows-packaged:${appUserModelId}`,
      keywords: buildSearchKeywords(displayName, appUserModelId),
      localizedNames: [],
      subtitle: WINDOWS_PACKAGED_APPLICATION_SUBTITLE
    })
  }

  return [...applicationsById.values()].toSorted((left, right) => {
    const displayOrder = collator.compare(left.displayName, right.displayName)
    if (displayOrder !== 0) {
      return displayOrder
    }

    return collator.compare(left.appUserModelId, right.appUserModelId)
  })
}

async function loadWindowsPackagedApplications(): Promise<WindowsPackagedApplicationRecord[]> {
  const { stdout } = await execFileAsync(
    getWindowsPowerShellPath(),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_START_APPS_SCRIPT],
    {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 10_000,
      windowsHide: true
    }
  )
  const serialized = stdout.toString().trim()
  if (!serialized) {
    return []
  }

  return parseWindowsPackagedApplications(JSON.parse(serialized) as unknown)
}

function getApplicationPathLookupKey(applicationPath: string): string {
  if (process.platform === "win32") {
    return normalizeWindowsPath(applicationPath)
  }

  return path.normalize(applicationPath)
}

async function resolveMacApplicationDisplayName(
  applicationPath: string
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/mdls", [
      "-raw",
      "-name",
      "kMDItemDisplayName",
      applicationPath
    ])
    const displayName = stdout.toString().trim()

    if (!displayName || displayName === "(null)") {
      return undefined
    }

    return displayName
  } catch {
    return undefined
  }
}

async function readPlistJsonObject(plistPath: string): Promise<Record<string, unknown> | null> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/plutil", [
      "-convert",
      "json",
      "-o",
      "-",
      plistPath
    ])
    const parsed = JSON.parse(stdout.toString()) as unknown

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }

    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function readStringProperty(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === "string" ? value.trim() : ""
}

async function readMacLocalizedApplicationNames(applicationPath: string): Promise<string[]> {
  const resourcesPath = path.join(applicationPath, "Contents", "Resources")
  const localizedNames = (
    await Promise.all(
      MAC_CHINESE_LOCALIZATION_DIRECTORIES.map(async (directoryName) => {
        const infoPlistStringsPath = path.join(resourcesPath, directoryName, "InfoPlist.strings")

        try {
          await fs.access(infoPlistStringsPath)
        } catch {
          return []
        }

        const localizedPlist = await readPlistJsonObject(infoPlistStringsPath)
        if (!localizedPlist) {
          return []
        }

        return [
          readStringProperty(localizedPlist, "CFBundleDisplayName"),
          readStringProperty(localizedPlist, "CFBundleName")
        ]
      })
    )
  ).flat()

  return uniqueStrings(localizedNames)
}

function getWindowsApplicationSubtitle(shortcutPath: string, rootPath: string): string {
  const relativePath = path.win32.relative(rootPath, shortcutPath)
  const relativeDirectory = path.win32.dirname(relativePath)

  if (!relativeDirectory || relativeDirectory === ".") {
    return WINDOWS_START_MENU_FALLBACK_SUBTITLE
  }

  const containerLabel = normalizeApplicationContainerLabel(path.win32.basename(relativeDirectory))
  if (!containerLabel) {
    return WINDOWS_START_MENU_FALLBACK_SUBTITLE
  }

  return containerLabel
}

function isWindowsUninstallEntry(label: string): boolean {
  return /(^|[\s._-])(uninstall|unins|卸载)([\s._-]|$)/i.test(label)
}

async function collectMacApplicationPaths(
  directoryPath: string,
  depth: number,
  target: Set<string>
): Promise<void> {
  let entries: Dirent[] = []

  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true })
  } catch {
    return
  }

  await Promise.all(
    entries.map(async (entry) => {
      if (entry.name.startsWith(".")) {
        return
      }

      const fullPath = path.join(directoryPath, entry.name)
      const isApplicationBundle = entry.name.endsWith(".app")

      if (isApplicationBundle && (entry.isDirectory() || entry.isSymbolicLink())) {
        target.add(fullPath)
        return
      }

      if (!entry.isDirectory() || depth <= 0) {
        return
      }

      await collectMacApplicationPaths(fullPath, depth - 1, target)
    })
  )
}

async function createMacApplicationRecord(
  applicationPath: string,
  displayName: string
): Promise<LauncherApplicationRecord> {
  const extension = path.extname(applicationPath)
  const bundleName = path.basename(applicationPath, extension)
  const localizedNames = await readMacLocalizedApplicationNames(applicationPath)

  return {
    bundleName,
    displayName,
    id: applicationPath,
    keywords: buildSearchKeywords(displayName, bundleName, ...localizedNames),
    localizedNames,
    path: applicationPath,
    subtitle: getMacApplicationSubtitle(applicationPath)
  }
}

function compareLauncherApplicationRecords(
  left: LauncherApplicationRecord,
  right: LauncherApplicationRecord
): number {
  const displayOrder = collator.compare(left.displayName, right.displayName)
  if (displayOrder !== 0) {
    return displayOrder
  }

  return collator.compare(left.bundleName, right.bundleName)
}

function getSystemProfilerDisplayName(
  entry: SystemProfilerApplicationEntry,
  bundleName: string
): string {
  const displayName = entry._name?.trim()
  if (displayName) {
    return displayName
  }

  return bundleName
}

async function loadMacApplicationsFromSystemProfiler(): Promise<LauncherApplicationRecord[]> {
  const { stdout } = await execFileAsync(
    "/usr/sbin/system_profiler",
    ["-json", "SPApplicationsDataType"],
    {
      maxBuffer: 64 * 1024 * 1024
    }
  )
  const payload = JSON.parse(stdout.toString()) as SystemProfilerApplicationsPayload
  const applicationsByPath = new Map<string, LauncherApplicationRecord>()
  const applicationRecordInputs: Array<{ applicationPath: string; displayName: string }> = []

  for (const entry of payload.SPApplicationsDataType ?? []) {
    const applicationPath = entry.path?.trim()
    if (!applicationPath) {
      continue
    }

    const extension = path.extname(applicationPath)
    if (extension !== ".app" && extension !== ".prefPane") {
      continue
    }

    const bundleName = path.basename(applicationPath, extension)
    applicationRecordInputs.push({
      applicationPath,
      displayName: getSystemProfilerDisplayName(entry, bundleName)
    })
  }

  const applicationRecords = await Promise.all(
    applicationRecordInputs.map(({ applicationPath, displayName }) =>
      createMacApplicationRecord(applicationPath, displayName)
    )
  )
  for (const applicationRecord of applicationRecords) {
    applicationsByPath.set(applicationRecord.path, applicationRecord)
  }

  return [...applicationsByPath.values()].toSorted(compareLauncherApplicationRecords)
}

async function loadMacApplications(): Promise<LauncherApplicationRecord[]> {
  const applicationsByPath = new Map<string, LauncherApplicationRecord>()

  try {
    for (const application of await loadMacApplicationsFromSystemProfiler()) {
      applicationsByPath.set(application.path, application)
    }
  } catch {
    // Directory scanning below still gives the launcher a usable catalog.
  }

  const applicationPaths = new Set<string>()
  await Promise.all(
    MAC_APPLICATION_DIRECTORIES.map((directoryPath) =>
      collectMacApplicationPaths(directoryPath, MAX_SCAN_DEPTH, applicationPaths)
    )
  )

  const scannedApplicationRecordInputs: Array<{ applicationPath: string; bundleName: string }> = []
  for (const applicationPath of applicationPaths) {
    if (applicationsByPath.has(applicationPath)) {
      continue
    }

    const extension = path.extname(applicationPath)
    const bundleName = path.basename(applicationPath, extension)
    scannedApplicationRecordInputs.push({ applicationPath, bundleName })
  }

  const scannedApplicationRecords = await Promise.all(
    scannedApplicationRecordInputs.map(({ applicationPath, bundleName }) =>
      createMacApplicationRecord(applicationPath, bundleName)
    )
  )
  for (const applicationRecord of scannedApplicationRecords) {
    applicationsByPath.set(applicationRecord.path, applicationRecord)
  }

  return [...applicationsByPath.values()].toSorted(compareLauncherApplicationRecords)
}

async function collectWindowsShortcutPaths(
  directoryPath: string,
  target: Set<string>
): Promise<void> {
  let entries: Dirent[] = []

  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true })
  } catch {
    return
  }

  await Promise.all(
    entries.map(async (entry) => {
      if (entry.name.startsWith(".")) {
        return
      }

      const fullPath = path.join(directoryPath, entry.name)
      const isShortcut = entry.name.toLowerCase().endsWith(".lnk")

      if (isShortcut && entry.isFile()) {
        target.add(fullPath)
        return
      }

      if (!entry.isDirectory()) {
        return
      }

      await collectWindowsShortcutPaths(fullPath, target)
    })
  )
}

function compareWindowsApplicationRecords(
  left: WindowsApplicationRecord,
  right: WindowsApplicationRecord
): number {
  if (left.sourcePriority !== right.sourcePriority) {
    return left.sourcePriority - right.sourcePriority
  }

  if (left.displayName.length !== right.displayName.length) {
    return left.displayName.length - right.displayName.length
  }

  const displayOrder = collator.compare(left.displayName, right.displayName)
  if (displayOrder !== 0) {
    return displayOrder
  }

  return collator.compare(left.path, right.path)
}

function toLauncherApplicationRecord(
  application: WindowsApplicationRecord
): LauncherApplicationRecord {
  return {
    ...(application.appUserModelId ? { appUserModelId: application.appUserModelId } : {}),
    bundleName: application.bundleName,
    displayName: application.displayName,
    id: application.id,
    keywords: application.keywords,
    localizedNames: application.localizedNames,
    path: application.path,
    subtitle: application.subtitle
  }
}

function findWindowsStartMenuRoot(
  normalizedStartMenuRoots: Array<{
    normalizedPath: string
    root: WindowsStartMenuRoot
  }>,
  normalizedShortcutPath: string
): WindowsStartMenuRoot | undefined {
  for (const entry of normalizedStartMenuRoots) {
    if (normalizedShortcutPath.startsWith(entry.normalizedPath)) {
      return entry.root
    }
  }

  return undefined
}

function getWindowsApplicationDedupePath(application: WindowsApplicationRecord): string {
  if (application.targetPath) {
    return application.targetPath
  }

  return application.path
}

function parseWindowsApplicationRecord(
  shortcutPath: string,
  root: WindowsStartMenuRoot
): WindowsApplicationRecord | null {
  const shortcutDetails = shell.readShortcutLink(shortcutPath)
  const appUserModelId = shortcutDetails.appUserModelId?.trim()
  const targetPath = shortcutDetails.target.trim()

  if (!targetPath) {
    return null
  }

  const bundleName = path.win32.basename(shortcutPath, path.win32.extname(shortcutPath)).trim()
  if (!bundleName) {
    return null
  }

  const targetName = path.win32.basename(targetPath, path.win32.extname(targetPath)).trim()
  if (isWindowsUninstallEntry(bundleName) || isWindowsUninstallEntry(targetName)) {
    return null
  }

  return {
    ...(getWindowsPackagedApplicationIdKey(appUserModelId) ? { appUserModelId } : {}),
    bundleName,
    displayName: bundleName,
    id: shortcutPath,
    keywords: buildSearchKeywords(bundleName, targetName),
    localizedNames: [],
    path: shortcutPath,
    sourcePriority: root.priority,
    subtitle: getWindowsApplicationSubtitle(shortcutPath, root.path),
    targetPath
  }
}

async function loadWindowsApplications(): Promise<LauncherApplicationRecord[]> {
  const shortcutPaths = new Set<string>()
  const startMenuRoots = getWindowsStartMenuRoots()
  const normalizedStartMenuRoots = startMenuRoots.map((root) => ({
    normalizedPath: `${normalizeWindowsPath(root.path)}\\`,
    root
  }))

  await Promise.all(
    startMenuRoots.map((root) => collectWindowsShortcutPaths(root.path, shortcutPaths))
  )

  const applicationsByTarget = new Map<string, WindowsApplicationRecord>()

  for (const shortcutPath of shortcutPaths) {
    const normalizedShortcutPath = normalizeWindowsPath(shortcutPath)
    const root = findWindowsStartMenuRoot(normalizedStartMenuRoots, normalizedShortcutPath)
    if (!root) {
      continue
    }

    let application: WindowsApplicationRecord | null = null

    try {
      application = parseWindowsApplicationRecord(shortcutPath, root)
    } catch {
      continue
    }

    if (!application) {
      continue
    }

    const dedupeKey = normalizeWindowsPath(getWindowsApplicationDedupePath(application))
    const existing = applicationsByTarget.get(dedupeKey)

    if (!existing || compareWindowsApplicationRecords(application, existing) < 0) {
      applicationsByTarget.set(dedupeKey, application)
    }
  }

  return [...applicationsByTarget.values()]
    .map((application) => toLauncherApplicationRecord(application))
    .toSorted((left, right) => {
      const displayOrder = collator.compare(left.displayName, right.displayName)
      if (displayOrder !== 0) {
        return displayOrder
      }

      const bundleOrder = collator.compare(left.bundleName, right.bundleName)
      if (bundleOrder !== 0) {
        return bundleOrder
      }

      return collator.compare(left.path, right.path)
    })
}

function createPathApplicationCatalogEntries(
  records: LauncherApplicationRecord[]
): LauncherApplicationCatalogEntry[] {
  return records.map((record) => ({ kind: "path", record }))
}

function createWindowsApplicationCatalogEntries(
  pathApplications: LauncherApplicationRecord[],
  packagedApplications: WindowsPackagedApplicationRecord[]
): WindowsApplicationCatalogMergeResult {
  const packagedApplicationsById = new Map(
    packagedApplications.flatMap((application) => {
      const appUserModelId = getWindowsPackagedApplicationIdKey(application.appUserModelId)
      return appUserModelId ? [[appUserModelId, application] as const] : []
    })
  )
  const windowsPackagedApplicationIdByPath = new Map<string, string>()
  const windowsSuppressedPathApplicationsByPath = new Map<
    string,
    LauncherApplicationRecord
  >()

  const pathEntries = createPathApplicationCatalogEntries(
    pathApplications.filter((application) => {
      const appUserModelId = getWindowsPackagedApplicationIdKey(application.appUserModelId)
      const packagedApplication = appUserModelId
        ? packagedApplicationsById.get(appUserModelId)
        : undefined
      if (!packagedApplication) {
        return true
      }

      windowsPackagedApplicationIdByPath.set(
        normalizeWindowsPath(application.path),
        packagedApplication.appUserModelId
      )
      windowsSuppressedPathApplicationsByPath.set(
        normalizeWindowsPath(application.path),
        application
      )
      return false
    })
  )

  return {
    entries: [
      ...pathEntries,
      ...packagedApplications.map(
        (record): LauncherApplicationCatalogEntry => ({ kind: "windows-packaged", record })
      )
    ],
    windowsPackagedApplicationIdByPath,
    windowsSuppressedPathApplicationsByPath
  }
}

function getApplicationCatalogEntryIdentity(entry: LauncherApplicationCatalogEntry): string {
  return entry.kind === "path" ? entry.record.path : entry.record.appUserModelId
}

function getApplicationCatalogFingerprint(entries: LauncherApplicationCatalogEntry[]): string {
  return JSON.stringify(
    entries
      .map((entry) => [
        entry.kind,
        getApplicationCatalogEntryIdentity(entry),
        entry.record.displayName,
        entry.record.subtitle,
        entry.kind === "windows-packaged"
          ? (entry.record.iconPath ?? "")
          : (entry.record.appUserModelId ?? "")
      ])
      .toSorted((left, right) => collator.compare(left.join("\0"), right.join("\0")))
  )
}

async function loadWindowsApplicationCatalog(
  loadPathApplications: () => Promise<LauncherApplicationRecord[]> = loadWindowsApplications,
  loadPackagedApplications: () => Promise<
    WindowsPackagedApplicationRecord[]
  > = loadWindowsPackagedApplications
): Promise<LauncherApplicationCatalogLoadResult> {
  const [pathApplications, packagedApplicationsResult] = await Promise.all([
    loadPathApplications(),
    loadPackagedApplications().then(
      (applications) => ({ applications, status: "fulfilled" as const }),
      (error: unknown) => ({ error, status: "rejected" as const })
    )
  ])
  const entries = createPathApplicationCatalogEntries(pathApplications)

  if (packagedApplicationsResult.status === "rejected") {
    console.warn("[LauncherSearch] Windows packaged application discovery failed:", {
      error:
        packagedApplicationsResult.error instanceof Error
          ? packagedApplicationsResult.error.message
          : String(packagedApplicationsResult.error)
    })
    return {
      entries,
      windowsPackagedApplicationIdByPath: new Map(),
      windowsPackagedApplicationsLoaded: false,
      windowsSuppressedPathApplicationsByPath: new Map()
    }
  }

  const mergedCatalog = createWindowsApplicationCatalogEntries(
    pathApplications,
    packagedApplicationsResult.applications
  )
  return {
    entries: mergedCatalog.entries,
    windowsPackagedApplicationIdByPath: mergedCatalog.windowsPackagedApplicationIdByPath,
    windowsPackagedApplicationsLoaded: true,
    windowsSuppressedPathApplicationsByPath:
      mergedCatalog.windowsSuppressedPathApplicationsByPath
  }
}

async function loadApplicationCatalog(
  platform: NodeJS.Platform = process.platform
): Promise<LauncherApplicationCatalogLoadResult> {
  switch (platform) {
    case "darwin": {
      return {
        entries: createPathApplicationCatalogEntries(await loadMacApplications()),
        windowsPackagedApplicationIdByPath: new Map(),
        windowsPackagedApplicationsLoaded: false,
        windowsSuppressedPathApplicationsByPath: new Map()
      }
    }
    case "win32":
      return loadWindowsApplicationCatalog()
    default:
      return {
        entries: [],
        windowsPackagedApplicationIdByPath: new Map(),
        windowsPackagedApplicationsLoaded: false,
        windowsSuppressedPathApplicationsByPath: new Map()
      }
  }
}

async function readPlistRawValue(
  plistPath: string,
  key: "CFBundleIconFile" | "CFBundleIconName"
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/plutil", [
      "-extract",
      key,
      "raw",
      "-o",
      "-",
      plistPath
    ])
    const value = stdout.toString().trim()
    if (!value) {
      return undefined
    }

    return value
  } catch {
    return undefined
  }
}

function buildMacApplicationIconCandidatePaths(
  resourcesPath: string,
  iconBaseNames: string[]
): string[] {
  const iconPaths: string[] = []

  for (const iconBaseName of iconBaseNames) {
    const normalizedBaseName = iconBaseName.trim()
    if (!normalizedBaseName) {
      continue
    }

    for (const iconCandidate of [
      normalizedBaseName,
      `${normalizedBaseName}.icns`,
      `${normalizedBaseName}.png`,
      `${normalizedBaseName}.tiff`
    ]) {
      iconPaths.push(path.join(resourcesPath, iconCandidate))
    }
  }

  return iconPaths
}

async function findExistingIconPath(
  resourcesPath: string,
  iconBaseNames: string[]
): Promise<string | undefined> {
  const iconPaths = buildMacApplicationIconCandidatePaths(resourcesPath, iconBaseNames)
  const existingIconPaths = await Promise.all(
    iconPaths.map(async (iconPath) => {
      try {
        await fs.access(iconPath)
        return iconPath
      } catch {
        return undefined
      }
    })
  )

  return existingIconPaths.find((iconPath): iconPath is string => Boolean(iconPath))
}

function collectMacApplicationIconBaseNames(params: {
  bundleName: string
  iconFileName: string | undefined
  iconName: string | undefined
}): string[] {
  const iconBaseNames: string[] = []

  if (params.iconFileName) {
    iconBaseNames.push(params.iconFileName)
  }

  if (params.iconName) {
    iconBaseNames.push(params.iconName)
  }

  iconBaseNames.push(params.bundleName, params.bundleName.replace(/\s+/g, ""), "AppIcon")
  return uniqueStrings(iconBaseNames)
}

function getMacApplicationIconFileScore(entryName: string): number {
  if (entryName.toLowerCase().endsWith(".icns")) {
    return 0
  }

  return 1
}

async function resolveMacApplicationIconPath(applicationPath: string): Promise<string | undefined> {
  const infoPlistPath = path.join(applicationPath, "Contents", "Info.plist")
  const resourcesPath = path.join(applicationPath, "Contents", "Resources")
  const bundleName = path.basename(applicationPath, path.extname(applicationPath))
  const [iconFileName, iconName] = await Promise.all([
    readPlistRawValue(infoPlistPath, "CFBundleIconFile"),
    readPlistRawValue(infoPlistPath, "CFBundleIconName")
  ])
  const iconBaseNames = collectMacApplicationIconBaseNames({
    bundleName,
    iconFileName,
    iconName
  })

  const resolvedIconPath = await findExistingIconPath(resourcesPath, iconBaseNames)
  if (resolvedIconPath) {
    return resolvedIconPath
  }

  try {
    const resourceEntries = await fs.readdir(resourcesPath)
    const fallbackIcon = resourceEntries
      .filter((entry) => /\.(icns|png|tiff)$/i.test(entry))
      .toSorted((left, right) => {
        const leftScore = getMacApplicationIconFileScore(left)
        const rightScore = getMacApplicationIconFileScore(right)
        if (leftScore !== rightScore) {
          return leftScore - rightScore
        }

        return collator.compare(left, right)
      })[0]

    if (fallbackIcon) {
      return path.join(resourcesPath, fallbackIcon)
    }
  } catch {
    // Ignore missing Resources directories and fall back below.
  }

  return GENERIC_MAC_APP_ICON
}

async function createIconDataUrlFromPath(iconPath: string): Promise<string | undefined> {
  try {
    const thumbnail = await nativeImage.createThumbnailFromPath(iconPath, {
      height: 64,
      width: 64
    })
    if (!thumbnail.isEmpty()) {
      return thumbnail.toDataURL()
    }
  } catch {
    // Fall back to createFromPath below.
  }

  try {
    const icon = nativeImage.createFromPath(iconPath)
    if (!icon.isEmpty()) {
      return icon
        .resize({
          height: 64,
          quality: "best",
          width: 64
        })
        .toDataURL()
    }
  } catch {
    return undefined
  }

  return undefined
}

function createIconDataUrlFromNativeImage(icon: Electron.NativeImage): string | undefined {
  if (icon.isEmpty()) {
    return undefined
  }

  return icon
    .resize({
      height: 64,
      quality: "best",
      width: 64
    })
    .toDataURL()
}

function getWindowsApplicationIconPathCandidates(applicationPath: string): string[] {
  if (!isWindowsShortcutPath(applicationPath)) {
    return [applicationPath]
  }

  try {
    const shortcutDetails = shell.readShortcutLink(applicationPath)
    return resolveWindowsApplicationIconPathCandidates({
      applicationPath,
      shortcutIconPath: shortcutDetails.icon,
      shortcutTargetPath: shortcutDetails.target
    })
  } catch {
    return [applicationPath]
  }
}

async function createWindowsApplicationIconDataUrl(
  applicationPath: string
): Promise<string | undefined> {
  const iconPathCandidates = getWindowsApplicationIconPathCandidates(applicationPath)
  const iconDataUrls = await Promise.all(
    iconPathCandidates.map(async (iconPathCandidate) => {
      const iconDataUrl = await createIconDataUrlFromPath(iconPathCandidate)
      if (iconDataUrl) {
        return iconDataUrl
      }

      try {
        const icon = await app.getFileIcon(iconPathCandidate, { size: "large" })
        const iconDataUrl = createIconDataUrlFromNativeImage(icon)
        if (iconDataUrl) {
          return iconDataUrl
        }
      } catch {
        return undefined
      }
      return undefined
    })
  )

  return iconDataUrls.find((iconDataUrl): iconDataUrl is string => Boolean(iconDataUrl))
}

function scoreWindowsPackagedApplicationIconVariant(fileName: string): number {
  const normalizedName = fileName.toLowerCase()
  if (normalizedName.includes("_contrast-")) {
    return -1
  }

  const targetSize = /\.targetsize-(\d+)/.exec(normalizedName)
  const scale = /\.scale-(\d+)/.exec(normalizedName)
  const resolutionScore = targetSize
    ? 20_000 + Number.parseInt(targetSize[1]!, 10)
    : scale
      ? 10_000 + Number.parseInt(scale[1]!, 10)
      : 0
  const presentationScore = normalizedName.includes("_altform-unplated")
    ? 2_000
    : normalizedName.includes("_altform-lightunplated")
      ? 1_000
      : 0

  return resolutionScore + presentationScore
}

async function resolveWindowsPackagedApplicationIconPath(
  declaredIconPath: string | undefined
): Promise<string | undefined> {
  if (!declaredIconPath) {
    return undefined
  }

  try {
    await fs.access(declaredIconPath)
    return declaredIconPath
  } catch {
    // Appx manifests often omit the scale or target-size qualifier present on disk.
  }

  const parsedPath = path.win32.parse(declaredIconPath)
  let entries: Dirent[]
  try {
    entries = await fs.readdir(parsedPath.dir, { withFileTypes: true })
  } catch {
    return undefined
  }

  const variantPrefix = `${parsedPath.name}.`.toLowerCase()
  const extension = parsedPath.ext.toLowerCase()
  const variant = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.toLowerCase().startsWith(variantPrefix) &&
        path.win32.extname(entry.name).toLowerCase() === extension
    )
    .map((entry) => ({
      entry,
      score: scoreWindowsPackagedApplicationIconVariant(entry.name)
    }))
    .filter(({ score }) => score >= 0)
    .toSorted(
      (left, right) =>
        right.score - left.score || collator.compare(left.entry.name, right.entry.name)
    )[0]

  return variant ? path.win32.join(parsedPath.dir, variant.entry.name) : undefined
}

async function resolveApplicationIconDataUrl(applicationPath: string): Promise<string | undefined> {
  if (process.platform === "darwin") {
    const iconPath = await resolveMacApplicationIconPath(applicationPath)
    if (iconPath) {
      const iconDataUrl = await createIconDataUrlFromPath(iconPath)
      if (iconDataUrl) {
        return iconDataUrl
      }
    }
  }

  if (process.platform === "win32") {
    return createWindowsApplicationIconDataUrl(applicationPath)
  }

  try {
    const icon = await app.getFileIcon(applicationPath, { size: "small" })
    return createIconDataUrlFromNativeImage(icon)
  } catch {
    return undefined
  }
}

function scoreKeywordMatch(keyword: string, query: string): number {
  if (!query) {
    return -1
  }

  if (keyword === query) {
    return 120
  }

  if (keyword.startsWith(query)) {
    return 100
  }

  const includesIndex = keyword.indexOf(query)
  if (includesIndex >= 0) {
    return 70 - Math.min(includesIndex, 20)
  }

  return -1
}

function getPinyinMatchRange(value: string, query: string): [number, number] | undefined {
  const match = PinyinMatch.match(value, query)
  return Array.isArray(match) ? match : undefined
}

function scorePinyinMatch(
  value: string,
  query: string
): { match: [number, number]; score: number } | null {
  if (!query) {
    return null
  }

  const match = getPinyinMatchRange(value, query)
  if (!match) {
    return null
  }

  const [start, end] = match
  const span = end - start

  return {
    match,
    score: 68 - Math.min(start, 10) * 3 - Math.min(span, 6)
  }
}

function getApplicationMatch(
  application: LauncherApplicationRecord | WindowsPackagedApplicationRecord,
  query: string
): {
  match?: [number, number]
  score: number
  title: string
} | null {
  const candidates = [
    {
      normalizedValue: normalizeSearchValue(application.displayName),
      title: application.displayName,
      value: application.displayName
    },
    {
      normalizedValue: normalizeSearchValue(application.bundleName),
      title: application.bundleName,
      value: application.bundleName
    },
    ...application.localizedNames.map((localizedName) => ({
      normalizedValue: normalizeSearchValue(localizedName),
      title: localizedName,
      value: localizedName
    }))
  ]
  let bestMatch: { match?: [number, number]; score: number; title: string } | null = null

  for (const candidate of candidates) {
    const literalScore = scoreKeywordMatch(candidate.normalizedValue, query)
    if (literalScore >= 0) {
      const nextMatch = {
        match: getTitleMatchRange(candidate.title, query),
        score: literalScore,
        title: candidate.title
      }

      if (!bestMatch || nextMatch.score > bestMatch.score) {
        bestMatch = nextMatch
      }
    }

    const pinyinScore = scorePinyinMatch(candidate.value, query)
    if (!pinyinScore) {
      continue
    }

    const nextMatch = {
      match: pinyinScore.match,
      score: pinyinScore.score,
      title: candidate.title
    }

    if (!bestMatch || nextMatch.score > bestMatch.score) {
      bestMatch = nextMatch
    }
  }

  if (bestMatch) {
    return bestMatch
  }

  let bestKeywordScore = -1

  for (const keyword of application.keywords) {
    const score = scoreKeywordMatch(keyword, query)
    if (score > bestKeywordScore) {
      bestKeywordScore = score
    }
  }

  if (bestKeywordScore < 0) {
    return null
  }

  return {
    score: bestKeywordScore,
    title: application.displayName
  }
}

export class ApplicationsLauncherSearchProvider implements LauncherSearchProvider {
  readonly source = "applications" as const
  private applicationCatalogGeneration = 0
  private applicationCatalogPromise: Promise<LauncherApplicationCatalogEntry[]> | null = null
  private applicationCatalogRefreshPromise: Promise<boolean> | null = null
  private applicationDisplayNamePromiseCache = new Map<string, Promise<string | undefined>>()
  private applicationIconPromiseCache = new Map<string, Promise<string | undefined>>()
  private windowsPackagedApplicationIdByPath = new Map<string, string>()
  private windowsPackagedApplicationCatalogLoadedAt = 0
  private windowsSuppressedPathApplicationsByPath = new Map<
    string,
    LauncherApplicationRecord
  >()

  constructor(private readonly options: ApplicationsLauncherSearchProviderOptions = {}) {}

  async warmup(): Promise<void> {
    await this.getApplicationCatalog()
  }

  invalidate(): void {
    this.applicationCatalogGeneration += 1
    this.applicationCatalogPromise = null
    this.applicationDisplayNamePromiseCache.clear()
    this.applicationIconPromiseCache.clear()
    this.windowsPackagedApplicationIdByPath.clear()
    this.windowsPackagedApplicationCatalogLoadedAt = 0
    this.windowsSuppressedPathApplicationsByPath.clear()
  }

  async refreshIfStale(): Promise<boolean> {
    if (this.getPlatform() !== "win32") {
      return false
    }

    const currentCatalog = await this.getApplicationCatalog()
    if (
      this.getCurrentTime() - this.windowsPackagedApplicationCatalogLoadedAt <
      WINDOWS_APPLICATION_CATALOG_TTL_MS
    ) {
      return false
    }

    if (!this.applicationCatalogRefreshPromise) {
      const refreshGeneration = this.applicationCatalogGeneration
      const refreshPromise = (async () => {
        const packagedApplications = await this.loadWindowsPackagedApplications()
        if (refreshGeneration !== this.applicationCatalogGeneration) {
          return false
        }

        const pathApplicationsByPath = new Map(
          currentCatalog
            .filter((entry) => entry.kind === "path")
            .map((entry) => [normalizeWindowsPath(entry.record.path), entry.record] as const)
        )
        for (const [applicationPath, application] of this
          .windowsSuppressedPathApplicationsByPath) {
          pathApplicationsByPath.set(applicationPath, application)
        }
        const mergedCatalog = createWindowsApplicationCatalogEntries(
          [...pathApplicationsByPath.values()],
          packagedApplications
        )
        const nextCatalog = mergedCatalog.entries
        const changed =
          getApplicationCatalogFingerprint(currentCatalog) !==
          getApplicationCatalogFingerprint(nextCatalog)

        this.windowsPackagedApplicationIdByPath =
          mergedCatalog.windowsPackagedApplicationIdByPath
        this.windowsPackagedApplicationCatalogLoadedAt = this.getCurrentTime()
        this.windowsSuppressedPathApplicationsByPath =
          mergedCatalog.windowsSuppressedPathApplicationsByPath
        if (changed) {
          this.applicationCatalogPromise = Promise.resolve(nextCatalog)
          this.applicationDisplayNamePromiseCache.clear()
          this.applicationIconPromiseCache.clear()
        }

        return changed
      })()
      this.applicationCatalogRefreshPromise = refreshPromise
      const clearRefreshPromise = (): void => {
        if (this.applicationCatalogRefreshPromise === refreshPromise) {
          this.applicationCatalogRefreshPromise = null
        }
      }
      void refreshPromise.then(clearRefreshPromise, clearRefreshPromise)
    }

    return this.applicationCatalogRefreshPromise
  }

  async search(request: LauncherSearchRequest): Promise<LauncherSearchProviderResponse> {
    const query = normalizeSearchValue(request.query)

    if (!query) {
      return {
        results: []
      }
    }

    const catalog = await this.getApplicationCatalog()
    const matches: Array<{
      application: LauncherApplicationCatalogEntry
      match?: [number, number]
      score: number
      title: string
    }> = []

    for (const application of catalog) {
      const match = getApplicationMatch(application.record, query)
      if (!match) {
        continue
      }

      matches.push({
        application,
        match: match.match,
        score: match.score,
        title: match.title
      })
    }

    matches.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      const titleOrder = collator.compare(left.title, right.title)
      if (titleOrder !== 0) {
        return titleOrder
      }

      return collator.compare(
        getApplicationCatalogEntryIdentity(left.application),
        getApplicationCatalogEntryIdentity(right.application)
      )
    })

    const results = await Promise.all(
      matches
        .slice(0, Math.max(request.limit, 1))
        .map((entry) =>
          this.mapApplicationResult(entry.application, entry.title, entry.score, entry.match)
        )
    )

    return {
      results
    }
  }

  async getApplicationIconDataUrl(applicationIdentity: string): Promise<string | undefined> {
    const lookupKey = getApplicationPathLookupKey(applicationIdentity)
    let iconPromise = this.applicationIconPromiseCache.get(lookupKey)

    if (!iconPromise) {
      iconPromise = this.resolveApplicationIdentityIconDataUrl(applicationIdentity, lookupKey)

      this.applicationIconPromiseCache.set(lookupKey, iconPromise)
    }

    return iconPromise
  }

  async getApplicationDisplayName(applicationPath: string): Promise<string | undefined> {
    const lookupKey = getApplicationPathLookupKey(applicationPath)
    let displayNamePromise = this.applicationDisplayNamePromiseCache.get(lookupKey)

    if (!displayNamePromise) {
      displayNamePromise = (async () => {
        if (this.getPlatform() === "darwin") {
          const displayName = await resolveMacApplicationDisplayName(applicationPath)
          if (displayName) {
            return displayName
          }
        }

        const catalog = await this.getApplicationCatalog()
        const application = catalog.find(
          (entry) =>
            getApplicationPathLookupKey(getApplicationCatalogEntryIdentity(entry)) === lookupKey
        )

        return getCatalogApplicationDisplayName(application?.record)
      })()

      this.applicationDisplayNamePromiseCache.set(lookupKey, displayNamePromise)
    }

    return displayNamePromise
  }

  async getApplicationSubtitle(applicationIdentity: string): Promise<string | undefined> {
    const lookupKey = getApplicationPathLookupKey(applicationIdentity)
    const catalog = await this.getApplicationCatalog()
    return catalog.find(
      (entry) =>
        getApplicationPathLookupKey(getApplicationCatalogEntryIdentity(entry)) === lookupKey
    )?.record.subtitle
  }

  async getWindowsPackagedApplicationIdForPath(
    applicationPath: string
  ): Promise<string | undefined> {
    if (this.getPlatform() !== "win32") {
      return undefined
    }

    await this.getApplicationCatalog()
    return this.windowsPackagedApplicationIdByPath.get(normalizeWindowsPath(applicationPath))
  }

  private async loadApplicationCatalog(): Promise<LauncherApplicationCatalogLoadResult> {
    if (this.options.loadApplicationCatalog) {
      if (this.getPlatform() === "win32" && this.options.loadWindowsPackagedApplications) {
        return loadWindowsApplicationCatalog(
          this.options.loadApplicationCatalog,
          this.options.loadWindowsPackagedApplications
        )
      }

      return {
        entries: createPathApplicationCatalogEntries(await this.options.loadApplicationCatalog()),
        windowsPackagedApplicationIdByPath: new Map(),
        windowsPackagedApplicationsLoaded: false,
        windowsSuppressedPathApplicationsByPath: new Map()
      }
    }

    return loadApplicationCatalog(this.getPlatform())
  }

  private loadWindowsPackagedApplications(): Promise<WindowsPackagedApplicationRecord[]> {
    return this.options.loadWindowsPackagedApplications
      ? this.options.loadWindowsPackagedApplications()
      : loadWindowsPackagedApplications()
  }

  private async getApplicationCatalog(): Promise<LauncherApplicationCatalogEntry[]> {
    if (!this.applicationCatalogPromise) {
      const loadGeneration = this.applicationCatalogGeneration
      const loadPromise = this.loadApplicationCatalog()
      const catalogPromise: Promise<LauncherApplicationCatalogEntry[]> = (async () => {
        const result = await loadPromise
        if (loadGeneration !== this.applicationCatalogGeneration) {
          return this.getApplicationCatalog()
        }
        if (result.windowsPackagedApplicationsLoaded) {
          this.windowsPackagedApplicationCatalogLoadedAt = this.getCurrentTime()
        }
        this.windowsPackagedApplicationIdByPath = new Map(
          result.windowsPackagedApplicationIdByPath
        )
        this.windowsSuppressedPathApplicationsByPath = new Map(
          result.windowsSuppressedPathApplicationsByPath
        )
        return result.entries
      })()
      this.applicationCatalogPromise = catalogPromise
      try {
        return await catalogPromise
      } catch (error) {
        if (this.applicationCatalogPromise === catalogPromise) {
          this.applicationCatalogPromise = null
        }
        throw error
      }
    }

    return this.applicationCatalogPromise
  }

  private async resolveApplicationIdentityIconDataUrl(
    applicationIdentity: string,
    lookupKey: string
  ): Promise<string | undefined> {
    const catalog = await this.getApplicationCatalog()
    const application = catalog.find(
      (entry) =>
        getApplicationPathLookupKey(getApplicationCatalogEntryIdentity(entry)) === lookupKey
    )
    if (application?.kind === "windows-packaged") {
      const iconPath = await resolveWindowsPackagedApplicationIconPath(application.record.iconPath)
      if (!iconPath) {
        return undefined
      }
      return this.resolveApplicationIconDataUrl(iconPath)
    }
    if (this.getPlatform() === "win32" && isWindowsPackagedApplicationId(applicationIdentity)) {
      return undefined
    }

    return this.resolveApplicationIconDataUrl(applicationIdentity)
  }

  private resolveApplicationIconDataUrl(applicationPath: string): Promise<string | undefined> {
    return this.options.resolveApplicationIconDataUrl
      ? this.options.resolveApplicationIconDataUrl(applicationPath)
      : resolveApplicationIconDataUrl(applicationPath)
  }

  private getCurrentTime(): number {
    return this.options.now ? this.options.now() : Date.now()
  }

  private getPlatform(): NodeJS.Platform {
    return this.options.platform ?? process.platform
  }

  private async mapApplicationResult(
    application: LauncherApplicationCatalogEntry,
    title: string,
    score: number,
    match?: [number, number]
  ): Promise<LauncherSearchResult> {
    const applicationIdentity = getApplicationCatalogEntryIdentity(application)
    const action: LauncherSearchAction =
      application.kind === "path"
        ? {
            executor: "shell",
            target: {
              kind: "application",
              path: application.record.path
            },
            type: "open-path"
          }
        : {
            executor: "shell",
            target: {
              appUserModelId: application.record.appUserModelId
            },
            type: "launch-windows-packaged-application"
          }
    const historyKey =
      application.kind === "path"
        ? createLauncherHistoryKey({
            path: application.record.path,
            type: "application"
          })
        : createLauncherHistoryKey({
            appUserModelId: application.record.appUserModelId,
            type: "windows-packaged-application"
          })

    return {
      action,
      historyKey,
      id: application.record.id,
      iconDataUrl: await this.getApplicationIconDataUrl(applicationIdentity),
      kind: "application",
      match,
      score,
      source: "applications",
      subtitle: application.record.subtitle,
      title
    }
  }
}

function getCatalogApplicationDisplayName(
  application: LauncherApplicationRecord | WindowsPackagedApplicationRecord | undefined
): string | undefined {
  if (!application) {
    return undefined
  }

  const localizedName = application.localizedNames[0]
  if (localizedName) {
    return localizedName
  }

  return application.displayName
}

export const applicationsLauncherSearchProvider = new ApplicationsLauncherSearchProvider()

export async function getApplicationIconDataUrl(
  applicationPath: string
): Promise<string | undefined> {
  return applicationsLauncherSearchProvider.getApplicationIconDataUrl(applicationPath)
}

export async function getApplicationDisplayName(
  applicationPath: string
): Promise<string | undefined> {
  return applicationsLauncherSearchProvider.getApplicationDisplayName(applicationPath)
}

export async function getApplicationSubtitle(
  applicationIdentity: string
): Promise<string | undefined> {
  return applicationsLauncherSearchProvider.getApplicationSubtitle(applicationIdentity)
}

export async function getWindowsPackagedApplicationIdForPath(
  applicationPath: string
): Promise<string | undefined> {
  return applicationsLauncherSearchProvider.getWindowsPackagedApplicationIdForPath(applicationPath)
}

export function refreshApplicationCatalogIfStale(): Promise<boolean> {
  return applicationsLauncherSearchProvider.refreshIfStale()
}

function getApplicationIndexWatchDirectories(): string[] {
  switch (process.platform) {
    case "darwin":
      return MAC_APPLICATION_DIRECTORIES
    case "win32":
      try {
        return getWindowsStartMenuRoots().map((root) => root.path)
      } catch {
        return []
      }
    default:
      return []
  }
}

function shouldRefreshApplicationIndexForPath(filePath: string | Buffer | null): boolean {
  if (!filePath) {
    return true
  }

  const normalizedPath = filePath.toString().toLowerCase()

  if (process.platform === "darwin") {
    return normalizedPath.includes(".app") || normalizedPath.includes(".prefpane")
  }

  if (process.platform === "win32") {
    return normalizedPath.endsWith(".lnk")
  }

  return true
}

export function startApplicationIndexRefreshWatcher(onRefresh: () => void): () => void {
  const watchers: FSWatcher[] = []
  let refreshTimer: NodeJS.Timeout | null = null

  const scheduleRefresh = (): void => {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
    }

    refreshTimer = setTimeout(() => {
      refreshTimer = null
      onRefresh()
    }, APPLICATION_INDEX_REFRESH_DEBOUNCE_MS)
  }

  for (const directoryPath of getApplicationIndexWatchDirectories()) {
    try {
      watchers.push(
        watch(
          directoryPath,
          { recursive: process.platform === "darwin" || process.platform === "win32" },
          (_eventType, filePath) => {
            if (shouldRefreshApplicationIndexForPath(filePath)) {
              scheduleRefresh()
            }
          }
        )
      )
    } catch {
      // Some system application directories may be absent or unavailable.
    }
  }

  return () => {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }

    for (const watcher of watchers) {
      watcher.close()
    }
  }
}
