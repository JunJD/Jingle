import crypto from "node:crypto"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

export const doctorSchemaVersion = 1
export const requiredReactDoctorVersion = "0.7.4"
const reactDoctorConfigFilenames = Object.freeze([
  "doctor.config.ts",
  "doctor.config.mts",
  "doctor.config.cts",
  "doctor.config.js",
  "doctor.config.mjs",
  "doctor.config.cjs",
  "doctor.config.json",
  "doctor.config.jsonc",
  "react-doctor.config.json"
])
const reactDoctorAdoptedLintConfigFilenames = Object.freeze([".oxlintrc.json", ".eslintrc.json"])
const reactDoctorTargetSuppressionFilenames = Object.freeze([
  ".eslintignore",
  ".oxlintignore",
  ".prettierignore",
  ".gitattributes",
  ".gitignore",
  "knip.json"
])
const reactDoctorResolvedRuntimePackages = Object.freeze([
  Object.freeze({
    declaredRange: "^7.1.1",
    label: "react-doctor-resolved:eslint-plugin-react-hooks",
    runtimeFiles: Object.freeze(["index.js"]),
    runtimeTrees: Object.freeze(["cjs"]),
    specifier: "eslint-plugin-react-hooks",
    version: "7.1.1"
  })
])
export const doctorScannerInputManifest = Object.freeze({
  version: 4,
  requiredFiles: [
    "scripts/guardrails/doctor-contracts.mjs",
    "scripts/guardrails/doctor-frontend.mjs",
    "scripts/guardrails/doctor-lock.mjs",
    "scripts/guardrails/doctor-react-report.mjs",
    "scripts/guardrails/doctor-run.mjs",
    "scripts/guardrails/doctor-show-group.mjs",
    "scripts/guardrails/lib/architecture-guardrails.mjs",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "node_modules/react-doctor/package.json",
    "node_modules/oxlint/package.json",
    "node_modules/oxlint-plugin-react-doctor/package.json",
    "node_modules/deslop-js/package.json",
    "node_modules/yaml/package.json",
    "node_modules/typescript/package.json",
    "node_modules/typescript/lib/typescript.js"
  ],
  requiredTrees: [
    ".jingle-doctor/cases",
    "node_modules/react-doctor/bin",
    "node_modules/react-doctor/dist",
    "node_modules/oxlint/bin",
    "node_modules/oxlint/dist",
    "node_modules/oxlint-plugin-react-doctor/dist",
    "node_modules/deslop-js/dist",
    "node_modules/yaml/dist",
    "node_modules/@oxlint"
  ],
  optionalFiles: [
    "doctor.config.js",
    "doctor.config.cjs",
    "doctor.config.cts",
    "doctor.config.json",
    "doctor.config.jsonc",
    "doctor.config.mjs",
    "doctor.config.mts",
    "doctor.config.ts",
    "react-doctor.config.json",
    "oxlint.json",
    ".oxlintrc.json",
    ".eslintrc.json",
    "eslint.config.mjs",
    "tsconfig.base.json",
    "tsconfig.json",
    "tsconfig.node.json",
    "tsconfig.web.json",
    "package-lock.json",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
    ".gitignore",
    ".eslintignore",
    ".oxlintignore",
    ".prettierignore",
    ".gitattributes",
    "knip.json"
  ],
  reactDoctorAncestorFilenames: [
    ...reactDoctorConfigFilenames,
    ...reactDoctorAdoptedLintConfigFilenames,
    ...reactDoctorTargetSuppressionFilenames,
    "package.json",
    "pnpm-workspace.yaml",
    "tsconfig.json",
    "tsconfig.base.json",
    "oxlint.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "bun.lock",
    "bun.lockb"
  ],
  resolvedRuntimePackages: reactDoctorResolvedRuntimePackages,
  gitEligibleFileInputs: ["repository info/exclude", "core.excludesFile"],
  topologyTrees: [
    "src/extensions",
    "src/plugins",
    "src/shared",
    "packages/extension-api/src",
    "packages/extension-utils/src"
  ]
})

function listFiles(directory, visitedDirectories = new Set()) {
  if (!fs.existsSync(directory)) {
    return []
  }

  const realDirectory = fs.realpathSync(directory)
  if (visitedDirectories.has(realDirectory)) {
    return []
  }
  visitedDirectories.add(realDirectory)

  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name)
    const stats = fs.statSync(absolutePath)
    if (stats.isDirectory()) {
      files.push(...listFiles(absolutePath, visitedDirectories))
    } else if (stats.isFile()) {
      files.push(absolutePath)
    }
  }
  return files
}

function hashFile(hash, repoRoot, relativePath) {
  const absolutePath = path.join(repoRoot, relativePath)
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`Required Doctor scanner input is missing: ${relativePath}`)
  }
  hash.update(`file\0${relativePath}\0`)
  hash.update(fs.readFileSync(absolutePath))
  hash.update("\0")
}

function hashTree(hash, repoRoot, relativePath) {
  const absolutePath = path.join(repoRoot, relativePath)
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
    throw new Error(`Required Doctor scanner input tree is missing: ${relativePath}`)
  }
  const files = listFiles(absolutePath).sort()
  if (files.length === 0) {
    throw new Error(`Required Doctor scanner input tree is empty: ${relativePath}`)
  }
  hash.update(`tree\0${relativePath}\0${files.length}\0`)
  for (const file of files) {
    const repoFile = path.relative(repoRoot, file).split(path.sep).join("/")
    hash.update(`${repoFile}\0`)
    hash.update(fs.readFileSync(file))
    hash.update("\0")
  }
  return files.length
}

function hashOptionalFile(hash, repoRoot, relativePath) {
  const absolutePath = path.join(repoRoot, relativePath)
  return hashOptionalAbsoluteFile(hash, absolutePath, relativePath)
}

function hashOptionalAbsoluteFile(hash, absolutePath, label) {
  if (!fs.existsSync(absolutePath)) {
    hash.update(`optional\0${label}\0missing\0`)
    return 0
  }
  if (!fs.statSync(absolutePath).isFile()) {
    throw new Error(`Optional Doctor scanner input is not a file: ${label}`)
  }
  hash.update(`optional\0${label}\0present\0`)
  hash.update(fs.readFileSync(absolutePath))
  hash.update("\0")
  return 1
}

function hashTopologyTree(hash, repoRoot, relativePath) {
  const absolutePath = path.join(repoRoot, relativePath)
  if (!fs.existsSync(absolutePath)) {
    hash.update(`topology\0${relativePath}\0missing\0`)
    return 0
  }
  if (!fs.statSync(absolutePath).isDirectory()) {
    throw new Error(`Doctor resolver topology input is not a directory: ${relativePath}`)
  }
  const entries = listFiles(absolutePath)
    .map((file) => path.relative(repoRoot, file).split(path.sep).join("/"))
    .sort()
  hash.update(`topology\0${relativePath}\0present\0${entries.length}\0`)
  for (const entry of entries) {
    hash.update(`${entry}\0`)
  }
  return entries.length
}

function readToolVersion(repoRoot, packageName) {
  const packagePath = path.join(repoRoot, "node_modules", packageName, "package.json")
  return JSON.parse(fs.readFileSync(packagePath, "utf8")).version
}

function resolveReactDoctorRuntimePackage(repoRoot, descriptor) {
  const requireFromReactDoctor = createRequire(
    path.join(repoRoot, "node_modules/react-doctor/package.json")
  )
  const entryPath = fs.realpathSync(requireFromReactDoctor.resolve(descriptor.specifier))
  let packageRoot = path.dirname(entryPath)
  for (;;) {
    const packagePath = path.join(packageRoot, "package.json")
    if (fs.existsSync(packagePath)) {
      const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"))
      if (packageJson.name === descriptor.specifier) {
        return { entryPath, packageJson, packagePath, packageRoot }
      }
    }
    const parent = path.dirname(packageRoot)
    if (parent === packageRoot) {
      throw new Error(
        `React Doctor resolved ${descriptor.specifier} without a matching package root`
      )
    }
    packageRoot = parent
  }
}

function hashReactDoctorResolvedRuntimePackage(hash, repoRoot, descriptor) {
  const resolved = resolveReactDoctorRuntimePackage(repoRoot, descriptor)
  if (resolved.packageJson.version !== descriptor.version) {
    throw new Error(
      `${descriptor.label} ${resolved.packageJson.version} is installed; Doctor requires ${descriptor.version}`
    )
  }
  const runtimeFiles = [
    ...descriptor.runtimeFiles.map((file) => path.join(resolved.packageRoot, file)),
    ...descriptor.runtimeTrees
      .flatMap((tree) => listFiles(path.join(resolved.packageRoot, tree)))
      .filter((file) => /\.(?:cjs|js|mjs)$/i.test(file))
  ].sort()
  for (const file of runtimeFiles) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error(`${descriptor.label} runtime input is missing: ${file}`)
    }
  }
  if (!runtimeFiles.some((file) => fs.realpathSync(file) === resolved.entryPath)) {
    throw new Error(`${descriptor.label} runtime tree does not contain its resolved entry point`)
  }

  hash.update(`resolved-package\0${descriptor.label}\0${descriptor.specifier}\0`)
  hash.update(fs.readFileSync(resolved.packagePath))
  hash.update("\0")
  for (const file of runtimeFiles) {
    const packageFile = path.relative(resolved.packageRoot, file).split(path.sep).join("/")
    hash.update(`${packageFile}\0`)
    hash.update(fs.readFileSync(file))
    hash.update("\0")
  }
  return { contentFileCount: runtimeFiles.length + 1, version: resolved.packageJson.version }
}

function readGitPath(repoRoot, args) {
  try {
    const value = execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim()
    if (!value) {
      return null
    }
    return path.isAbsolute(value) ? value : path.resolve(repoRoot, value)
  } catch {
    return null
  }
}

export function assertDoctorDependencyClosure(repoRoot) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"))
  if (Object.hasOwn(packageJson, "reactDoctor")) {
    throw new Error(
      "package.json#reactDoctor is not allowed because Doctor requires the complete pinned rule surface"
    )
  }
  let ancestor = path.join(repoRoot, "src/renderer/src")
  const targetSuppressionFile = reactDoctorTargetSuppressionFilenames.find((filename) =>
    fs.existsSync(path.join(ancestor, filename))
  )
  if (targetSuppressionFile !== undefined) {
    throw new Error(
      `src/renderer/src/${targetSuppressionFile} is not allowed because Doctor requires the complete pinned scan surface`
    )
  }
  for (;;) {
    const configFile = [
      ...reactDoctorConfigFilenames,
      ...reactDoctorAdoptedLintConfigFilenames
    ].find((filename) => fs.existsSync(path.join(ancestor, filename)))
    if (configFile !== undefined) {
      throw new Error(
        `${path.relative(repoRoot, path.join(ancestor, configFile))} is not allowed because Doctor requires the complete pinned rule surface`
      )
    }
    const packagePath = path.join(ancestor, "package.json")
    if (fs.existsSync(packagePath)) {
      const ancestorPackage = JSON.parse(fs.readFileSync(packagePath, "utf8"))
      for (const configKey of ["reactDoctor", "knip"]) {
        if (Object.hasOwn(ancestorPackage, configKey)) {
          throw new Error(
            `${path.relative(repoRoot, packagePath)}#${configKey} is not allowed because Doctor requires the complete pinned scan surface`
          )
        }
      }
    }
    if (ancestor === repoRoot) {
      break
    }
    const parent = path.dirname(ancestor)
    const resolvedParent = path.resolve(parent)
    const resolvedRepoRoot = path.resolve(repoRoot)
    if (
      parent === ancestor ||
      (resolvedParent !== resolvedRepoRoot &&
        !resolvedParent.startsWith(`${resolvedRepoRoot}${path.sep}`))
    ) {
      throw new Error("React Doctor target is outside the repository root")
    }
    ancestor = parent
  }
  if (packageJson.devDependencies?.["react-doctor"] !== requiredReactDoctorVersion) {
    throw new Error(`package.json must pin react-doctor exactly to ${requiredReactDoctorVersion}`)
  }
  for (const packageName of ["react-doctor", "oxlint-plugin-react-doctor", "deslop-js"]) {
    const version = readToolVersion(repoRoot, packageName)
    if (version !== requiredReactDoctorVersion) {
      throw new Error(
        `${packageName} ${version} is installed; Doctor requires ${requiredReactDoctorVersion}`
      )
    }
  }

  const requireFromReactDoctor = createRequire(
    path.join(repoRoot, "node_modules/react-doctor/package.json")
  )
  const { parse } = requireFromReactDoctor("yaml")
  const lock = parse(fs.readFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "utf8"))
  const rootEntry = lock?.importers?.["."]?.devDependencies?.["react-doctor"]
  const rootVersion = rootEntry?.version
  if (
    rootEntry?.specifier !== requiredReactDoctorVersion ||
    typeof rootVersion !== "string" ||
    (rootVersion !== requiredReactDoctorVersion &&
      !rootVersion.startsWith(`${requiredReactDoctorVersion}(`))
  ) {
    throw new Error(
      `pnpm-lock.yaml must resolve the root react-doctor dependency to ${requiredReactDoctorVersion}`
    )
  }
  for (const packageName of ["react-doctor", "oxlint-plugin-react-doctor", "deslop-js"]) {
    const packageKey = `${packageName}@${requiredReactDoctorVersion}`
    if (!Object.hasOwn(lock?.packages ?? {}, packageKey)) {
      throw new Error(`pnpm-lock.yaml is missing ${packageKey}`)
    }
  }
  const reactDoctorSnapshot = lock?.snapshots?.[`react-doctor@${rootVersion}`]
  const reactDoctorPackage = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "node_modules/react-doctor/package.json"), "utf8")
  )
  const missingSnapshotDependencies = Object.keys(reactDoctorPackage.dependencies ?? {}).filter(
    (dependency) => !Object.hasOwn(reactDoctorSnapshot?.dependencies ?? {}, dependency)
  )
  if (
    reactDoctorSnapshot?.dependencies?.["oxlint-plugin-react-doctor"] !==
      requiredReactDoctorVersion ||
    reactDoctorSnapshot?.dependencies?.["deslop-js"] !== requiredReactDoctorVersion ||
    missingSnapshotDependencies.length > 0
  ) {
    throw new Error(
      `pnpm-lock.yaml has an incomplete React Doctor scanner dependency closure${
        missingSnapshotDependencies.length > 0 ? `: ${missingSnapshotDependencies.join(", ")}` : ""
      }`
    )
  }
  for (const descriptor of doctorScannerInputManifest.resolvedRuntimePackages) {
    const resolved = resolveReactDoctorRuntimePackage(repoRoot, descriptor)
    const lockedResolution = reactDoctorSnapshot?.dependencies?.[descriptor.specifier]
    const lockedVersion =
      typeof lockedResolution === "string" ? lockedResolution.match(/^[^(]+/)?.[0] : null
    if (
      reactDoctorPackage.dependencies?.[descriptor.specifier] !== descriptor.declaredRange ||
      resolved.packageJson.version !== descriptor.version ||
      lockedVersion !== resolved.packageJson.version ||
      !Object.hasOwn(
        lock?.packages ?? {},
        `${descriptor.specifier}@${resolved.packageJson.version}`
      ) ||
      !Object.hasOwn(lock?.snapshots ?? {}, `${descriptor.specifier}@${lockedResolution}`)
    ) {
      throw new Error(
        `pnpm-lock.yaml does not match the resolved ${descriptor.label} ${resolved.packageJson.version}`
      )
    }
  }
}

export function computeDoctorContractSnapshot(repoRoot) {
  const hash = crypto.createHash("sha256")
  hash.update(`doctor-scanner-input-manifest\0${doctorScannerInputManifest.version}\0`)
  let contentFileCount = 0
  for (const relativePath of [...doctorScannerInputManifest.requiredFiles].sort()) {
    hashFile(hash, repoRoot, relativePath)
    contentFileCount += 1
  }
  for (const relativePath of [...doctorScannerInputManifest.requiredTrees].sort()) {
    contentFileCount += hashTree(hash, repoRoot, relativePath)
  }
  for (const relativePath of [...doctorScannerInputManifest.optionalFiles].sort()) {
    contentFileCount += hashOptionalFile(hash, repoRoot, relativePath)
  }
  const resolvedRuntimeVersions = {}
  for (const descriptor of doctorScannerInputManifest.resolvedRuntimePackages) {
    const resolvedRuntime = hashReactDoctorResolvedRuntimePackage(hash, repoRoot, descriptor)
    contentFileCount += resolvedRuntime.contentFileCount
    resolvedRuntimeVersions[descriptor.specifier] = resolvedRuntime.version
  }
  let ancestor = path.join(repoRoot, "src/renderer/src")
  for (;;) {
    for (const filename of [...doctorScannerInputManifest.reactDoctorAncestorFilenames].sort()) {
      const absolutePath = path.join(ancestor, filename)
      const relativePath = path.relative(repoRoot, absolutePath)
      const label = relativePath.startsWith(`..${path.sep}`)
        ? absolutePath.split(path.sep).join("/")
        : relativePath.split(path.sep).join("/")
      contentFileCount += hashOptionalAbsoluteFile(
        hash,
        absolutePath,
        `react-doctor-ancestor:${label}`
      )
    }
    const parent = path.dirname(ancestor)
    if (parent === ancestor) {
      break
    }
    ancestor = parent
  }
  for (const [label, absolutePath] of [
    ["git-info-exclude", readGitPath(repoRoot, ["rev-parse", "--git-path", "info/exclude"])],
    [
      "git-global-excludes",
      readGitPath(repoRoot, ["config", "--path", "--get", "core.excludesFile"])
    ]
  ]) {
    if (absolutePath === null) {
      hash.update(`optional\0${label}\0unconfigured\0`)
    } else {
      contentFileCount += hashOptionalAbsoluteFile(hash, absolutePath, label)
    }
  }
  let topologyEntryCount = 0
  for (const relativePath of [...doctorScannerInputManifest.topologyTrees].sort()) {
    topologyEntryCount += hashTopologyTree(hash, repoRoot, relativePath)
  }
  const toolVersions = {
    deslopJs: readToolVersion(repoRoot, "deslop-js"),
    oxlint: readToolVersion(repoRoot, "oxlint"),
    reactDoctor: readToolVersion(repoRoot, "react-doctor"),
    reactDoctorPlugin: readToolVersion(repoRoot, "oxlint-plugin-react-doctor"),
    resolvedReactHooksPlugin: resolvedRuntimeVersions["eslint-plugin-react-hooks"],
    typescript: readToolVersion(repoRoot, "typescript"),
    yaml: readToolVersion(repoRoot, "yaml")
  }
  return {
    digest: hash.digest("hex"),
    manifestVersion: doctorScannerInputManifest.version,
    contentFileCount,
    topologyEntryCount,
    toolVersions
  }
}

export function computeDoctorContractDigest(repoRoot) {
  return computeDoctorContractSnapshot(repoRoot).digest
}

export function stableDiagnosticId(parts) {
  return crypto.createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 20)
}

export function readGitHead(repoRoot) {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8"
  }).trim()
}

export function computeRendererGitIndexDigest(repoRoot) {
  const indexEntries = execFileSync("git", ["ls-files", "-s", "--", "src/renderer/src"], {
    cwd: repoRoot,
    encoding: "utf8"
  })
  return crypto.createHash("sha256").update(indexEntries).digest("hex")
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

export function loadCaseCatalog(repoRoot) {
  const indexPath = path.join(repoRoot, ".jingle-doctor/cases/index.json")
  const catalog = JSON.parse(fs.readFileSync(indexPath, "utf8"))

  if (catalog.schemaVersion !== doctorSchemaVersion || !Array.isArray(catalog.cases)) {
    throw new Error("Doctor case catalog has an unsupported schema")
  }

  const seenIds = new Set()
  const seenRuleIds = new Set()
  for (const entry of catalog.cases) {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      typeof entry.ruleId !== "string" ||
      typeof entry.title !== "string" ||
      typeof entry.owner !== "string" ||
      typeof entry.path !== "string" ||
      !["error", "warning"].includes(entry.severity) ||
      !["active", "retired"].includes(entry.status)
    ) {
      throw new Error("Doctor case catalog contains an invalid entry")
    }
    if (seenIds.has(entry.id) || seenRuleIds.has(entry.ruleId)) {
      throw new Error(`Doctor case catalog contains a duplicate: ${entry.id}`)
    }
    seenIds.add(entry.id)
    seenRuleIds.add(entry.ruleId)

    const casePath = path.resolve(repoRoot, entry.path)
    const casesRoot = path.resolve(repoRoot, ".jingle-doctor/cases")
    if (!casePath.startsWith(`${casesRoot}${path.sep}`) || !fs.existsSync(casePath)) {
      throw new Error(`Doctor case file is missing or outside the catalog: ${entry.path}`)
    }
    if (path.basename(casePath) !== `${entry.id}.md`) {
      throw new Error(`Doctor case filename must match its id: ${entry.path}`)
    }
    const caseSource = fs.readFileSync(casePath, "utf8")
    for (const heading of [
      `# ${entry.id}:`,
      "## Symptom",
      "## Owner",
      "## Cause",
      "## Required fix",
      "## Recurrence guard"
    ]) {
      if (!caseSource.includes(heading)) {
        throw new Error(`Doctor case ${entry.id} is missing heading: ${heading}`)
      }
    }
  }

  return catalog
}

export function summarizeDiagnostics({ executionErrors, jingleReport, reactReport, runId, input }) {
  const diagnostics = [...jingleReport.diagnostics, ...reactReport.diagnostics]
  const groupsById = new Map()

  for (const diagnostic of diagnostics) {
    const groupId =
      diagnostic.source === "jingle-doctor"
        ? `jingle-doctor/${diagnostic.caseId}`
        : diagnostic.plugin === "react-doctor"
          ? `react-doctor/${diagnostic.ruleId}`
          : `react-doctor/${diagnostic.plugin}/${diagnostic.ruleId}`
    let group = groupsById.get(groupId)
    if (!group) {
      group = {
        groupId,
        source: diagnostic.source,
        plugin: diagnostic.plugin ?? null,
        ruleId: diagnostic.ruleId,
        caseId: diagnostic.caseId ?? null,
        caseTitle: diagnostic.caseTitle ?? null,
        casePath: diagnostic.casePath ?? null,
        owner: diagnostic.owner ?? null,
        count: 0,
        occurrences: 0,
        errors: 0,
        warnings: 0,
        files: new Set(),
        reportPath:
          diagnostic.source === "jingle-doctor"
            ? ".jingle-doctor/reports/latest/jingle-doctor.json"
            : ".jingle-doctor/reports/latest/react-doctor.json"
      }
      groupsById.set(groupId, group)
    }
    group.count += 1
    group.occurrences += diagnostic.occurrenceCount ?? 1
    group[diagnostic.severity === "error" ? "errors" : "warnings"] += 1
    group.files.add(diagnostic.file)
  }

  const groups = [...groupsById.values()]
    .map((group) => ({
      groupId: group.groupId,
      source: group.source,
      plugin: group.plugin,
      ruleId: group.ruleId,
      caseId: group.caseId,
      caseTitle: group.caseTitle,
      casePath: group.casePath,
      owner: group.owner,
      count: group.count,
      occurrences: group.occurrences,
      errors: group.errors,
      warnings: group.warnings,
      affectedFileCount: group.files.size,
      sampleFiles: [...group.files].sort().slice(0, 5),
      reportPath: group.reportPath
    }))
    .sort((left, right) => left.groupId.localeCompare(right.groupId))

  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length
  const warnings = diagnostics.length - errors
  const occurrences = diagnostics.reduce(
    (total, diagnostic) => total + (diagnostic.occurrenceCount ?? 1),
    0
  )
  const complete =
    executionErrors.length === 0 &&
    jingleReport.status === "complete" &&
    reactReport.status === "complete"

  return {
    schemaVersion: doctorSchemaVersion,
    runId,
    status: complete ? (diagnostics.length === 0 ? "clean" : "findings") : "incomplete",
    clean: complete && diagnostics.length === 0,
    input,
    counts: {
      total: diagnostics.length,
      occurrences,
      blocking: diagnostics.length,
      errors,
      warnings,
      groups: groups.length
    },
    coverage: {
      jingle: jingleReport.coverage,
      react: reactReport.coverage
    },
    reviewCommand: "node scripts/guardrails/doctor-show-group.mjs <group-id>",
    groups,
    executionErrors
  }
}
