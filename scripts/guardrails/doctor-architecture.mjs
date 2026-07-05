import { execFileSync } from "node:child_process"
import { repoRoot } from "./lib/architecture-guardrails.mjs"

const commands = [
  ["node", ["scripts/guardrails/doctor-route-language.mjs"]],
  ["node", ["scripts/guardrails/doctor-secrets-boundary.mjs"]]
]

console.log("architecture doctor")
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

console.log("doctor finished")
