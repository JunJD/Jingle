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

test("classifies cd chains with file writes as predictable mutations", () => {
  const policy = classifier.classify("cd src && touch notes.txt")

  assert.equal(policy.profile, "predictable_mutation")
  assert.equal(policy.disposition, "require_approval")
  assert.deepEqual(policy.commands, ["cd", "touch"])
})

test("keeps cd chains outside workspace-relative directories behind approval", () => {
  for (const command of ["cd /tmp && touch notes.txt", "cd .. && touch notes.txt"]) {
    const policy = classifier.classify(command)

    assert.equal(policy.profile, "unknown_command")
    assert.equal(policy.disposition, "require_approval")
  }
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

test("classifies python3 http.server module execution as a managed process", () => {
  const policy = classifier.classify("python3 -m http.server")

  assert.equal(policy.profile, "managed_process")
  assert.equal(policy.disposition, "require_approval")
})

test("classifies unrecognized python3 module execution as an unknown command", () => {
  const policy = classifier.classify("python3 -m pip install pytest")

  assert.equal(policy.profile, "unknown_command")
  assert.equal(policy.disposition, "require_approval")
})

test("classifies package dev scripts as managed processes", () => {
  const policy = classifier.classify("npm run dev")

  assert.equal(policy.profile, "managed_process")
  assert.equal(policy.disposition, "require_approval")
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

test("classifies unrecognized npm scripts as unknown commands requiring approval", () => {
  const policy = classifier.classify("npm run build")

  assert.equal(policy.profile, "unknown_command")
  assert.equal(policy.disposition, "require_approval")
  assert.match(policy.reason, /requires user approval/i)
})

test("classifies shell wrapper commands as unknown side-effect operations requiring approval", () => {
  const policy = classifier.classify(`sh -c "echo hello"`)

  assert.equal(policy.profile, "unknown_command")
  assert.equal(policy.disposition, "require_approval")
  assert.match(policy.reason, /未知副作用操作/)
})

test("classifies shell wrapper commands with redirection as unknown side-effect operations", () => {
  const policy = classifier.classify(`sh -c "echo hello" > out.txt`)

  assert.equal(policy.profile, "unknown_command")
  assert.equal(policy.disposition, "require_approval")
  assert.match(policy.reason, /未知副作用操作/)
})

test("blocks background shell execution", () => {
  const policy = classifier.classify("sleep 1 &")

  assert.equal(policy.profile, "host_unsafe")
  assert.equal(policy.disposition, "deny")
  assert.match(policy.reason, /background shell execution/i)
})
