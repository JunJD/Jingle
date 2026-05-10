import { execFileSync } from "node:child_process"
import { repoRoot } from "./lib/architecture-guardrails.mjs"

const commands = [
  ["node", [".agents/skills/launcher-extension-guardrails/scripts/check-architecture-imports.mjs"]],
  ["node", [".agents/skills/launcher-extension-guardrails/scripts/check-extension-contract.mjs"]],
  ["node", [".agents/skills/launcher-extension-guardrails/scripts/check-extension-ai-contract.mjs"]],
  ["node", [".agents/skills/launcher-extension-guardrails/scripts/check-extension-registry.mjs"]],
  [
    "node",
    [".agents/skills/launcher-extension-guardrails/scripts/check-runtime-backed-renderer-imports.mjs"]
  ],
  ["node", [".agents/skills/launcher-extension-guardrails/scripts/check-no-glob-sprawl.mjs"]],
  [
    "node",
    [".agents/skills/launcher-extension-guardrails/scripts/check-no-legacy-plugin-coupling.mjs"]
  ]
]

console.log("guardrails check")
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

console.log("guardrails check finished")
