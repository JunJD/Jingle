#!/usr/bin/env node

/**
 * Jingle CLI - Launches the Electron app
 */

const { spawn } = require("child_process")
const path = require("path")

// Set process title for Activity Monitor
process.title = "jingle"

const args = process.argv.slice(2)

// Handle --version flag
if (args.includes("--version") || args.includes("-v")) {
  const { version } = require("../package.json")
  console.log(`jingle v${version}`)
  process.exit(0)
}

// Handle --help flag
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
jingle - A desktop command launcher and agent workbench

Usage:
  jingle              Launch the application
  jingle --version    Show version
  jingle --help       Show this help
`)
  process.exit(0)
}

// Get the path to electron
const electron = require("electron")

// Launch electron with our main process
const mainPath = path.join(__dirname, "..", "out", "main", "index.js")

const child = spawn(electron, [mainPath, ...args], {
  stdio: "inherit"
})

// Forward signals to child process

function forwardSignal(signal) {
  if (child.pid) {
    process.kill(child.pid, signal)
  }
}

process.on("SIGINT", () => forwardSignal("SIGINT"))
process.on("SIGTERM", () => forwardSignal("SIGTERM"))

function exitCodeForSignal(signal) {
  const signals = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGTERM: 15
  }
  if (Object.prototype.hasOwnProperty.call(signals, signal)) {
    return 128 + signals[signal]
  }
  return 1
}

// Exit with the same code as the child
child.on("close", (code, signal) => {
  if (typeof code === "number") {
    process.exit(code)
  }
  if (signal) {
    process.exit(exitCodeForSignal(signal))
  }
  process.exit(1)
})

child.on("error", (err) => {
  console.error("Failed to start Jingle:", err.message)
  process.exit(1)
})
