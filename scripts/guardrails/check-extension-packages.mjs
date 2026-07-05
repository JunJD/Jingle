import { execFileSync } from "node:child_process"
import { repoRoot } from "./lib/architecture-guardrails.mjs"

const commands = [
  ["node", ["scripts/guardrails/check-extension-contract.mjs"]],
  ["node", ["scripts/guardrails/check-extension-ai-contract.mjs"]],
  [
    "node",
    [
      "scripts/guardrails/check-extension-runtime-capabilities.mjs"
    ]
  ],
  ["node", ["scripts/guardrails/check-extension-registry.mjs"]],
  [
    "node",
    ["scripts/guardrails/check-extension-runtime-registry.mjs"]
  ],
  [
    "node",
    ["scripts/guardrails/check-runtime-backed-renderer-imports.mjs"]
  ]
]

console.log("extension package check")
console.log("")

for (const [command, args] of commands) {
  console.log(`$ ${command} ${args.join(" ")}`)
  console.log("")
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit"
  })
  console.log("")
}

console.log("extension package check finished")
