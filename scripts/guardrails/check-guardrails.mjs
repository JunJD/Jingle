import { execFileSync } from "node:child_process"
import { repoRoot } from "./lib/architecture-guardrails.mjs"

const commands = [
  ["node", ["scripts/guardrails/check-prisma-sqlite-fts-external-tables.mjs"]],
  ["node", ["scripts/guardrails/check-architecture-imports.mjs"]],
  ["node", ["scripts/guardrails/check-no-glob-sprawl.mjs"]],
  [
    "node",
    ["scripts/guardrails/check-no-legacy-plugin-coupling.mjs"]
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
