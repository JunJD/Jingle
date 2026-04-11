import { chmodSync, existsSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { execFileSync } from "node:child_process"

if (process.platform !== "darwin") {
  process.exit(0)
}

const sourcePath = resolve("src/native/openwork-minimal-island.swift")
const outputPath = resolve("out/native/openwork-minimal-island")

if (!existsSync(sourcePath)) {
  throw new Error(`Native island Swift source not found: ${sourcePath}`)
}

mkdirSync(dirname(outputPath), { recursive: true })
execFileSync("swiftc", [
  "-parse-as-library",
  "-O",
  sourcePath,
  "-o",
  outputPath,
  "-framework",
  "AppKit"
], {
  stdio: "inherit"
})
chmodSync(outputPath, 0o755)
console.log(`[native-island] built ${outputPath}`)
