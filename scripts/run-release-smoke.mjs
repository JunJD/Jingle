import { runLocalCommand } from "./lib/run-local-command.mjs"

const targetByPlatform = {
  darwin: "--mac",
  linux: "--linux",
  win32: "--win"
}

const target = targetByPlatform[process.platform]
if (!target) {
  throw new Error(`Release smoke does not support platform: ${process.platform}`)
}

if (process.platform === "win32") {
  await runLocalCommand("node", ["scripts/build-win-icon.mjs"])
}

await runLocalCommand("node", [
  "scripts/run-electron-builder.mjs",
  target,
  "--dir",
  "--publish",
  "never"
])
