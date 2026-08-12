import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { execFileSync } from "node:child_process"

const outputDirectory = resolve("out/native")
const computerUseSourceDirectory = resolve("packages/computer-use-core/src/native")

const computerUseScripts = [
  {
    mode: 0o755,
    name: "jingle-computer-use-linux.py"
  },
  {
    mode: 0o644,
    name: "jingle-computer-use-windows.ps1"
  }
]

const targets = [
  {
    frameworks: ["AppKit"],
    label: "native-island",
    outputPath: resolve("out/native/jingle-minimal-island"),
    sourcePath: resolve("src/native/jingle-minimal-island.swift")
  },
  {
    frameworks: ["AppKit", "ApplicationServices"],
    label: "computer-use-macos",
    outputPath: resolve(outputDirectory, "jingle-computer-use-macos"),
    sourcePaths: [
      resolve(computerUseSourceDirectory, "jingle-computer-use-parent-lifetime.swift"),
      resolve(computerUseSourceDirectory, "jingle-computer-use-macos.swift")
    ]
  },
  {
    frameworks: ["AppKit", "ApplicationServices"],
    label: "selection-capture",
    outputPath: resolve("out/native/jingle-selection-capture"),
    sourcePath: resolve("src/native/jingle-selection-capture.swift")
  },
  {
    frameworks: ["EventKit", "AppKit"],
    infoPlistPath: resolve("src/native/jingle-apple-reminders-info.plist"),
    label: "apple-reminders",
    outputPath: resolve("out/native/jingle-apple-reminders"),
    sourcePath: resolve("src/native/jingle-apple-reminders.swift")
  }
]

rmSync(outputDirectory, { force: true, recursive: true })
mkdirSync(outputDirectory, { recursive: true })

for (const script of computerUseScripts) {
  const sourcePath = resolve(computerUseSourceDirectory, script.name)
  const outputPath = resolve(outputDirectory, script.name)
  if (!existsSync(sourcePath)) {
    throw new Error(`Computer Use native source not found: ${sourcePath}`)
  }
  copyFileSync(sourcePath, outputPath)
  chmodSync(outputPath, script.mode)
  console.log(`[computer-use] copied ${outputPath}`)
}

if (process.platform !== "darwin") {
  process.exit(0)
}

for (const target of targets) {
  const sourcePaths = target.sourcePaths ?? [target.sourcePath]
  for (const sourcePath of sourcePaths) {
    if (!existsSync(sourcePath)) {
      throw new Error(`Native Swift source not found: ${sourcePath}`)
    }
  }

  mkdirSync(dirname(target.outputPath), { recursive: true })
  execFileSync(
    "swiftc",
    [
      "-parse-as-library",
      "-O",
      ...sourcePaths,
      "-o",
      target.outputPath,
      ...(target.infoPlistPath
        ? [
            "-Xlinker",
            "-sectcreate",
            "-Xlinker",
            "__TEXT",
            "-Xlinker",
            "__info_plist",
            "-Xlinker",
            target.infoPlistPath
          ]
        : []),
      ...target.frameworks.flatMap((framework) => ["-framework", framework])
    ],
    {
      stdio: "inherit"
    }
  )
  chmodSync(target.outputPath, 0o755)
  console.log(`[${target.label}] built ${target.outputPath}`)
}
