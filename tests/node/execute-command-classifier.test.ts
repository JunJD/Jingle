import assert from "node:assert/strict"
import test from "node:test"
import { JustBashExecuteCommandClassifier } from "../../src/main/agent/execute-command-classifier"

const classifier = new JustBashExecuteCommandClassifier()

test("classifies allowlisted read-only command chains without approval", () => {
  const policy = classifier.classify("pwd && ls -la")

  assert.equal(policy.profile, "read_only")
  assert.equal(policy.disposition, "allow")
  assert.deepEqual(policy.commands, ["pwd", "ls"])
})

test("classifies env-wrapped read-only commands without approval", () => {
  const policy = classifier.classify("env FOO=bar rg mutation src")

  assert.equal(policy.profile, "read_only")
  assert.equal(policy.disposition, "allow")
  assert.deepEqual(policy.commands, ["env"])
})

test("classifies git status as an allowlisted read-only command", () => {
  const policy = classifier.classify("git -C /tmp/repo status -sb")

  assert.equal(policy.profile, "read_only")
  assert.equal(policy.disposition, "allow")
})

test("classifies explicit file writes as predictable mutations", () => {
  const policy = classifier.classify("echo hello > notes.txt")

  assert.equal(policy.profile, "predictable_mutation")
  assert.equal(policy.disposition, "require_approval")
})

test("classifies in-place sed edits as predictable mutations", () => {
  const policy = classifier.classify("sed -i 's/old/new/' src/app.ts")

  assert.equal(policy.profile, "predictable_mutation")
  assert.equal(policy.disposition, "require_approval")
})

test("classifies python3 version inspection as read-only", () => {
  const policy = classifier.classify("python3 --version")

  assert.equal(policy.profile, "read_only")
  assert.equal(policy.disposition, "allow")
})

test("classifies python3 inline code as a predictable mutation", () => {
  const policy = classifier.classify(`python3 -c "open('notes.txt', 'w').write('hello')"`)

  assert.equal(policy.profile, "predictable_mutation")
  assert.equal(policy.disposition, "require_approval")
})

test("classifies python3 script execution as a predictable mutation", () => {
  const policy = classifier.classify("python3 scripts/update.py")

  assert.equal(policy.profile, "predictable_mutation")
  assert.equal(policy.disposition, "require_approval")
})

test("blocks python3 module execution outside the controlled shell profile", () => {
  const policy = classifier.classify("python3 -m http.server")

  assert.equal(policy.profile, "host_unsafe")
  assert.equal(policy.disposition, "deny")
})

test("classifies node version inspection as read-only", () => {
  const policy = classifier.classify("node --version")

  assert.equal(policy.profile, "read_only")
  assert.equal(policy.disposition, "allow")
})

test("classifies node inline code as a predictable mutation", () => {
  const policy = classifier.classify(`node -e "require('fs').writeFileSync('notes.txt', 'hello')"`)

  assert.equal(policy.profile, "predictable_mutation")
  assert.equal(policy.disposition, "require_approval")
})

test("classifies node script execution as a predictable mutation", () => {
  const policy = classifier.classify("node scripts/update.js")

  assert.equal(policy.profile, "predictable_mutation")
  assert.equal(policy.disposition, "require_approval")
})

test("blocks js-exec because it is not a host command", () => {
  const policy = classifier.classify(`js-exec -c "console.log('hello')"`)

  assert.equal(policy.profile, "host_unsafe")
  assert.equal(policy.disposition, "deny")
})

test("classifies safe curl GET requests as network reads", () => {
  const policy = classifier.classify("curl -I https://example.com")

  assert.equal(policy.profile, "network_read")
  assert.equal(policy.disposition, "allow")
})

test("blocks npm run because it is outside the controlled shell profile", () => {
  const policy = classifier.classify("npm run dev")

  assert.equal(policy.profile, "host_unsafe")
  assert.equal(policy.disposition, "deny")
  assert.match(policy.reason, /outside the controlled shell profile/i)
})

test("blocks background shell execution", () => {
  const policy = classifier.classify("sleep 1 &")

  assert.equal(policy.profile, "host_unsafe")
  assert.equal(policy.disposition, "deny")
  assert.match(policy.reason, /background shell execution/i)
})
