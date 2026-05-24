import assert from "node:assert/strict"
import test from "node:test"
import type {
  ExecuteCommandDisposition,
  ExecuteCommandProfile
} from "../../src/shared/execute-command-policy"
import { JustBashExecuteCommandClassifier } from "../../src/main/agent/execute-command-classifier"

const classifier = new JustBashExecuteCommandClassifier()

interface BoundaryCase {
  command: string
  disposition: ExecuteCommandDisposition
  label: string
  profile: ExecuteCommandProfile
}

const boundaryCases: BoundaryCase[] = [
  {
    command: "pwd",
    disposition: "allow",
    label: "read-only shell inspection",
    profile: "read_only"
  },
  {
    command: "curl -I https://example.com",
    disposition: "allow",
    label: "public network read",
    profile: "network_read"
  },
  {
    command: "python3 --version",
    disposition: "allow",
    label: "python version inspection",
    profile: "read_only"
  },
  {
    command: `python3 -c "open('notes.txt', 'w').write('hello')"`,
    disposition: "require_approval",
    label: "python inline file mutation",
    profile: "predictable_mutation"
  },
  {
    command: "python3 scripts/update.py",
    disposition: "require_approval",
    label: "python script file mutation",
    profile: "predictable_mutation"
  },
  {
    command: `node -e "require('fs').writeFileSync('notes.txt', 'hello')"`,
    disposition: "require_approval",
    label: "node inline file mutation",
    profile: "predictable_mutation"
  },
  {
    command: "node scripts/update.js",
    disposition: "require_approval",
    label: "node script file mutation",
    profile: "predictable_mutation"
  },
  {
    command: "python3 -m http.server",
    disposition: "require_approval",
    label: "python managed local server",
    profile: "managed_process"
  },
  {
    command: "npm run dev",
    disposition: "require_approval",
    label: "package managed dev server",
    profile: "managed_process"
  },
  {
    command: "python3 -m pip install pytest",
    disposition: "deny",
    label: "unclassified python module execution",
    profile: "host_unsafe"
  },
  {
    command: "node --inspect scripts/update.js",
    disposition: "deny",
    label: "node debugging flags",
    profile: "host_unsafe"
  },
  {
    command: `js-exec -c "console.log('hello')"`,
    disposition: "deny",
    label: "js-exec host execution",
    profile: "host_unsafe"
  },
  {
    command: "/usr/bin/python3 scripts/update.py",
    disposition: "deny",
    label: "absolute executable path",
    profile: "host_unsafe"
  }
]

for (const boundaryCase of boundaryCases) {
  test(`execute boundary: ${boundaryCase.label}`, () => {
    const policy = classifier.classify(boundaryCase.command)

    assert.equal(policy.profile, boundaryCase.profile)
    assert.equal(policy.disposition, boundaryCase.disposition)
  })
}
