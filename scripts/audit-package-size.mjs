import { execFileSync } from "node:child_process"
import { existsSync, lstatSync, readdirSync, statSync } from "node:fs"
import { basename, join, relative, resolve, sep } from "node:path"

const root = resolve(process.argv[2] ?? "dist")
const limit = Number(process.argv[3] ?? 25)

function toMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function pathLabel(path) {
  return relative(process.cwd(), path) || "."
}

function sizeOf(path) {
  const entry = lstatSync(path)
  if (!entry.isDirectory()) {
    return entry.size
  }

  let total = entry.size
  for (const child of readdirSync(path)) {
    total += sizeOf(join(path, child))
  }
  return total
}

function collectMatching(start, predicate, matches = []) {
  if (!existsSync(start)) {
    return matches
  }

  const entry = lstatSync(start)
  if (predicate(start, entry)) {
    matches.push(start)
  }

  if (!entry.isDirectory()) {
    return matches
  }

  for (const child of readdirSync(start)) {
    collectMatching(join(start, child), predicate, matches)
  }
  return matches
}

function collectFiles(start, matches = []) {
  if (!existsSync(start)) {
    return matches
  }

  const entry = lstatSync(start)
  if (!entry.isDirectory()) {
    matches.push(start)
    return matches
  }

  for (const child of readdirSync(start)) {
    collectFiles(join(start, child), matches)
  }
  return matches
}

function printEntries(title, entries) {
  console.log(`\n${title}`)
  if (entries.length === 0) {
    console.log("  (none)")
    return
  }

  for (const { path, bytes } of entries) {
    console.log(`  ${toMiB(bytes).padStart(9)}  ${pathLabel(path)}`)
  }
}

function topImmediateChildren(path) {
  if (!existsSync(path)) {
    return []
  }

  return readdirSync(path)
    .map((child) => {
      const childPath = join(path, child)
      return { path: childPath, bytes: sizeOf(childPath) }
    })
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, limit)
}

function listAsarNodeModulePackages(asarPath) {
  const asarBin = resolve("node_modules/.bin/asar")
  if (!existsSync(asarBin)) {
    return []
  }

  const output = execFileSync(asarBin, ["list", asarPath], {
    encoding: "utf-8",
    maxBuffer: 128 * 1024 * 1024
  })
  const counts = new Map()

  for (const line of output.split("\n")) {
    if (!line.startsWith("/node_modules/")) {
      continue
    }

    const parts = line.slice("/node_modules/".length).split("/")
    const packageName = parts[0]?.startsWith("@") ? (parts[1] ? `${parts[0]}/${parts[1]}` : null) : parts[0]
    if (packageName) {
      counts.set(packageName, (counts.get(packageName) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
}

if (!existsSync(root)) {
  throw new Error(`Package output not found: ${root}`)
}

const roots = [
  { path: root, bytes: sizeOf(root) },
  ...collectMatching(root, (path, entry) => entry.isDirectory() && path.endsWith(".app")).map(
    (path) => ({ path, bytes: sizeOf(path) })
  ),
  ...collectMatching(root, (path, entry) => !entry.isDirectory() && /\.(asar|dmg|exe|zip|AppImage)$/i.test(path)).map(
    (path) => ({ path, bytes: statSync(path).size })
  ),
  ...collectMatching(
    root,
    (path, entry) => entry.isDirectory() && basename(path) === "app.asar.unpacked"
  ).map((path) => ({ path, bytes: sizeOf(path) }))
].sort((a, b) => b.bytes - a.bytes)

printEntries("Package artifacts", roots)

const largestFiles = collectFiles(root)
  .map((path) => ({ path, bytes: statSync(path).size }))
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, limit)

printEntries(`Largest files (top ${limit})`, largestFiles)

const unpackedNodeModules = collectMatching(
  root,
  (path, entry) => entry.isDirectory() && path.split(sep).slice(-2).join(sep) === `app.asar.unpacked${sep}node_modules`
)

for (const nodeModulesPath of unpackedNodeModules) {
  printEntries(`Unpacked node_modules entries: ${pathLabel(nodeModulesPath)}`, topImmediateChildren(nodeModulesPath))
}

const nativeFiles = collectMatching(root, (path, entry) => !entry.isDirectory() && path.endsWith(".node")).map(
  (path) => ({ path, bytes: statSync(path).size })
)
printEntries("Native .node files", nativeFiles.sort((a, b) => b.bytes - a.bytes))

for (const asarPath of collectMatching(root, (path, entry) => !entry.isDirectory() && path.endsWith(".asar"))) {
  const packageCounts = listAsarNodeModulePackages(asarPath)
  console.log(`\nAsar node_modules package entries: ${pathLabel(asarPath)}`)
  if (packageCounts.length === 0) {
    console.log("  (none)")
    continue
  }

  for (const [packageName, count] of packageCounts) {
    console.log(`  ${String(count).padStart(6)}  ${packageName}`)
  }
}
