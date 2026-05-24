import { chmodSync, existsSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { execFileSync } from "node:child_process"

if (process.platform !== "darwin") {
  process.exit(0)
}

const targets = [
  {
    frameworks: ["AppKit"],
    label: "native-island",
    outputPath: resolve("out/native/openwork-minimal-island"),
    sourcePath: resolve("src/native/openwork-minimal-island.swift")
  },
  {
    frameworks: ["AppKit", "ApplicationServices"],
    label: "desktop-automation",
    outputPath: resolve("out/native/openwork-desktop-automation"),
    sourcePath: resolve("src/native/openwork-desktop-automation.swift")
  },
  {
    frameworks: ["EventKit", "AppKit"],
    infoPlistPath: resolve("src/native/openwork-apple-reminders-info.plist"),
    label: "apple-reminders",
    outputPath: resolve("out/native/openwork-apple-reminders"),
    sourcePath: resolve("src/native/openwork-apple-reminders.swift")
  }
]

for (const target of targets) {
  if (!existsSync(target.sourcePath)) {
    throw new Error(`Native Swift source not found: ${target.sourcePath}`)
  }

  mkdirSync(dirname(target.outputPath), { recursive: true })
  execFileSync(
    "swiftc",
    [
      "-parse-as-library",
      "-O",
      target.sourcePath,
      "-o",
      target.outputPath,
      ...(target.infoPlistPath ? ["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", target.infoPlistPath] : []),
      ...target.frameworks.flatMap((framework) => ["-framework", framework])
    ],
    {
      stdio: "inherit"
    }
  )
  chmodSync(target.outputPath, 0o755)
  console.log(`[${target.label}] built ${target.outputPath}`)
}
