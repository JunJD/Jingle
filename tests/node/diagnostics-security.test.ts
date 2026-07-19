import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { DiagnosticsGraphRecorder } from "../../src/main/diagnostics/graph"
import { APPEND_DIAGNOSTIC_GRAPH_EVENT, DiagnosticsLogger } from "../../src/main/diagnostics/logger"
import { assertPrivateRegularFileSync } from "../../src/main/diagnostics/private-files"
import {
  errorFromUnhandledRejection,
  serializeProcessError
} from "../../src/main/diagnostics/process-errors"
import {
  sanitizeDiagnosticValue,
  serializeDiagnosticEvidence
} from "../../src/main/diagnostics/redaction"

const INSPECTOR = resolve(
  ".codex/skills/investigate-jingle-diagnostics/scripts/inspect-diagnostics.mjs"
)
const EMBEDDED_SECRET = "plain-json-secret"
const SENSITIVE_KEY_SECRET = "reader-sensitive-field-secret"
const SECRET_VALUES = [
  "sk-proj-abcdefghijklmnop",
  "ghp_abcdefghijklmnopqrstuvwxyz",
  "Bearer top-secret-token",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjdXN0b21lciJ9.signature123",
  "eyJhbGciOiJub25lIn0.eyJzdWIiOiJhbGljZSJ9.",
  "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----",
  "/Users/alice/customer/private.txt",
  "C:\\Users\\alice\\customer\\private.txt",
  'password="correct horse battery staple"',
  'password=\\"escaped correct horse battery staple\\"',
  "/Users/alice/My Project/private.txt",
  "C:\\Users\\alice\\My Project\\private.txt",
  "\\\\server\\private-share\\customer\\secret.txt",
  "\\\\?\\C:\\Users\\alice\\customer\\secret.txt",
  "//server/private-share/customer/secret.txt",
  "///Users/alice/customer/secret.txt"
]

function createTempDir(label: string): string {
  const dir = join(tmpdir(), `jingle-${label}-${Date.now()}-${Math.random()}`)
  mkdirSync(dir, { mode: 0o700, recursive: true })
  return dir
}

function mode(path: string): number {
  return statSync(path).mode & 0o777
}

interface WindowsAclSnapshot {
  currentSid: string
  ownerSid: string
  protected: boolean
  rules: Array<{ inherited: boolean; sid: string; type: string }>
  sddl: string
}

function readWindowsAcl(path: string): WindowsAclSnapshot {
  const systemRoot = process.env.SystemRoot
  assert.ok(systemRoot)
  const script = String.raw`
param([Parameter(Mandatory = $true)][string]$targetPath)
$ErrorActionPreference = 'Stop'
$acl = Get-Acl -LiteralPath $targetPath
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
  [PSCustomObject]@{
    inherited = $_.IsInherited
    sid = $_.IdentityReference.Value
    type = $_.AccessControlType.ToString()
  }
})
[PSCustomObject]@{
  currentSid = $identity.User.Value
  ownerSid = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  protected = $acl.AreAccessRulesProtected
  rules = $rules
  sddl = $acl.Sddl
} | ConvertTo-Json -Compress -Depth 4
`
  const result = spawnSync(
    join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `& {${script}}`, path],
    { encoding: "utf8", windowsHide: true }
  )
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout) as WindowsAclSnapshot
}

function assertWindowsPrivatePathsInFreshProcess(root: string, logFilePath: string): void {
  const script = String.raw`
const { join } = require("node:path")
const {
  assertPrivateRegularFileSync,
  ensurePrivateDescendantDirectorySync,
  ensurePrivateDirectorySync
} = require("./src/main/diagnostics/private-files.ts")
const root = process.env.JINGLE_TEST_PRIVATE_ROOT
const logFilePath = process.env.JINGLE_TEST_PRIVATE_LOG_FILE
if (!root || !logFilePath) {
  throw new Error("Missing Windows private path test environment.")
}
ensurePrivateDirectorySync(root)
ensurePrivateDescendantDirectorySync(root, join(root, "logs"))
if (!assertPrivateRegularFileSync(logFilePath)) {
  throw new Error("Diagnostics log file disappeared during cold-cache verification.")
}
`
  const result = spawnSync(process.execPath, ["--import", "tsx", "-e", script], {
    cwd: resolve("."),
    encoding: "utf8",
    env: {
      ...process.env,
      JINGLE_TEST_PRIVATE_LOG_FILE: logFilePath,
      JINGLE_TEST_PRIVATE_ROOT: root
    },
    windowsHide: true
  })
  assert.equal(result.status, 0, result.stderr)
}

function assertSecretsAbsent(value: string): void {
  for (const secret of SECRET_VALUES) {
    assert.equal(value.includes(secret), false, `leaked secret: ${secret}`)
  }
  assert.equal(value.includes("customer/private.txt"), false)
  assert.equal(value.includes("customer\\private.txt"), false)
  assert.equal(value.includes("customer\\secret.txt"), false)
  assert.equal(value.includes("customer/secret.txt"), false)
  assert.equal(value.includes("eyJhbGciOiJub25lIn0"), false)
  assert.equal(value.includes("private-material"), false)
  assert.equal(value.includes(EMBEDDED_SECRET), false)
  assert.equal(value.includes("horse battery staple"), false)
  assert.equal(value.includes("My Project"), false)
  assert.equal(value.includes("private-share"), false)
  assert.equal(value.includes(SENSITIVE_KEY_SECRET), false)
}

test(
  "diagnostics writer rejects symlink roots and forces private journal and blob permissions",
  { skip: process.platform === "win32" },
  async () => {
    const root = createTempDir("private-paths")
    const external = createTempDir("external-paths")
    try {
      const linkedLogs = join(root, "linked-logs")
      symlinkSync(external, linkedLogs, "dir")
      assert.throws(
        () => new DiagnosticsLogger({ logDir: linkedLogs, rootDir: root }),
        /private regular directory/
      )
      const intermediateLink = join(root, "intermediate-link")
      symlinkSync(external, intermediateLink, "dir")
      assert.throws(
        () =>
          new DiagnosticsLogger({
            logDir: join(intermediateLink, "logs"),
            rootDir: root
          }),
        /private regular directory/
      )

      const logDir = join(root, "logs")
      mkdirSync(logDir, { mode: 0o755 })
      chmodSync(logDir, 0o755)
      writeFileSync(join(logDir, "jingle.log"), "", { mode: 0o644 })
      chmodSync(join(logDir, "jingle.log"), 0o644)
      mkdirSync(join(logDir, "blobs", "sha256"), { mode: 0o755, recursive: true })
      chmodSync(join(logDir, "blobs"), 0o755)
      chmodSync(join(logDir, "blobs", "sha256"), 0o755)
      const logger = new DiagnosticsLogger({ logDir, rootDir: root })
      const graph = new DiagnosticsGraphRecorder({ logger, sessionId: "security" })
      graph.capture({
        component: "diagnostics",
        eventCode: "diagnostics.security_test",
        evidence: [{ kind: "error", value: { message: "bounded" } }],
        level: "error",
        operation: "test",
        recoverable: true,
        stateImpact: "none",
        summary: "Security test"
      })
      await graph.flush()

      const event = JSON.parse(readFileSync(logger.getLogFilePath(), "utf8")) as {
        evidenceRefs: Array<{ sha256: string }>
      }
      const sha256 = event.evidenceRefs[0].sha256
      const blobDir = join(logDir, "blobs")
      const hashDir = join(blobDir, "sha256")
      const prefixDir = join(hashDir, sha256.slice(0, 2))
      const blobPath = join(prefixDir, `${sha256}.json`)

      assert.equal(mode(logDir), 0o700)
      assert.equal(mode(root), 0o700)
      assert.equal(mode(blobDir), 0o700)
      assert.equal(mode(hashDir), 0o700)
      assert.equal(mode(prefixDir), 0o700)
      assert.equal(mode(logger.getLogFilePath()), 0o600)
      assert.equal(mode(blobPath), 0o600)

      const escapedJournal = join(external, "escaped-journal.log")
      writeFileSync(escapedJournal, "outside", { mode: 0o600 })
      const unsafeJournalDir = join(root, "unsafe-journal")
      mkdirSync(unsafeJournalDir, { mode: 0o700 })
      symlinkSync(escapedJournal, join(unsafeJournalDir, "jingle.log"))
      const unsafeJournalLogger = new DiagnosticsLogger({
        logDir: unsafeJournalDir,
        rootDir: root
      })
      unsafeJournalLogger.error("must-not-escape")
      await assert.rejects(unsafeJournalLogger.flush(), /private regular file/)
      assert.equal(readFileSync(escapedJournal, "utf8"), "outside")

      const unsafeBlobDir = join(root, "unsafe-blob")
      const unsafeBlobLogger = new DiagnosticsLogger({
        logDir: unsafeBlobDir,
        rootDir: root
      })
      const unsafeEvidence = serializeDiagnosticEvidence({ message: "must-not-escape" })
      const unsafeSha256 = createHash("sha256").update(unsafeEvidence.serialized).digest("hex")
      mkdirSync(join(unsafeBlobDir, "blobs", "sha256"), {
        mode: 0o700,
        recursive: true
      })
      symlinkSync(external, join(unsafeBlobDir, "blobs", "sha256", unsafeSha256.slice(0, 2)))
      const unsafeGraph = new DiagnosticsGraphRecorder({
        logger: unsafeBlobLogger,
        onWriteError: () => undefined,
        sessionId: "unsafe-blob"
      })
      unsafeGraph.capture({
        component: "diagnostics",
        eventCode: "diagnostics.unsafe_blob_test",
        evidence: [{ kind: "error", value: { message: "must-not-escape" } }],
        level: "error",
        operation: "test",
        recoverable: true,
        stateImpact: "none",
        summary: "Unsafe blob test"
      })
      await unsafeGraph.flush()
      const unsafeEvent = JSON.parse(readFileSync(unsafeBlobLogger.getLogFilePath(), "utf8")) as {
        evidenceRefs: Array<{ capture: string }>
      }
      assert.equal(unsafeEvent.evidenceRefs[0].capture, "failed")
      assert.equal(
        readFileSync(escapedJournal, "utf8"),
        "outside",
        "external files must remain unchanged"
      )
      assert.equal(
        existsSync(join(external, `${unsafeSha256}.json`)),
        false,
        "the CAS writer must not follow the prefix symlink"
      )
    } finally {
      rmSync(root, { force: true, recursive: true })
      rmSync(external, { force: true, recursive: true })
    }
  }
)

test(
  "Windows diagnostics replace inherited access with a private ACL",
  { skip: process.platform !== "win32" },
  async () => {
    const root = createTempDir("windows-private-acl")
    try {
      const grant = spawnSync("icacls.exe", [root, "/grant", "*S-1-1-0:(OI)(CI)F", "/Q"], {
        encoding: "utf8",
        windowsHide: true
      })
      assert.equal(grant.status, 0, grant.stderr)

      const logger = new DiagnosticsLogger({ logDir: join(root, "logs"), rootDir: root })
      logger.info("private Windows ACL")
      await logger.flush()

      const securedPaths = [root, join(root, "logs"), logger.getLogFilePath()]
      const initialAcls = new Map(
        securedPaths.map((securedPath) => [securedPath, readWindowsAcl(securedPath)])
      )
      assertWindowsPrivatePathsInFreshProcess(root, logger.getLogFilePath())
      assertWindowsPrivatePathsInFreshProcess(root, logger.getLogFilePath())

      for (const securedPath of securedPaths) {
        const acl = readWindowsAcl(securedPath)
        const initialAcl = initialAcls.get(securedPath)
        assert.ok(initialAcl)
        const allowedSids = new Set([acl.currentSid, "S-1-5-18", "S-1-5-32-544"])
        assert.equal(acl.protected, true)
        assert.equal(acl.ownerSid, acl.currentSid)
        assert.equal(acl.sddl, initialAcl.sddl)
        assert.equal(
          acl.rules.some((rule) => rule.type === "Allow" && !allowedSids.has(rule.sid)),
          false
        )
        assert.equal(
          acl.rules.some((rule) => rule.inherited),
          false
        )
      }
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  }
)

test(
  "Windows diagnostics reject junction directories and multiply linked files",
  { skip: process.platform !== "win32" },
  () => {
    const root = createTempDir("windows-private-links")
    const external = createTempDir("windows-private-links-external")
    try {
      const linkedLogs = join(root, "linked-logs")
      symlinkSync(external, linkedLogs, "junction")
      assert.throws(
        () => new DiagnosticsLogger({ logDir: linkedLogs, rootDir: root }),
        /private regular directory/
      )

      const logDir = join(root, "logs")
      mkdirSync(logDir)
      const externalFile = join(external, "external.log")
      const linkedFile = join(logDir, "jingle.log")
      writeFileSync(externalFile, "external")
      linkSync(externalFile, linkedFile)
      assert.throws(() => assertPrivateRegularFileSync(linkedFile), /private regular file/)
      assert.equal(readFileSync(externalFile, "utf8"), "external")
    } finally {
      rmSync(root, { force: true, recursive: true })
      rmSync(external, { force: true, recursive: true })
    }
  }
)

test("diagnostics redaction does not execute getters or proxies and applies global bounds", () => {
  let getterCalls = 0
  const accessorArray: unknown[] = []
  Object.defineProperty(accessorArray, "0", {
    configurable: true,
    get() {
      getterCalls += 1
      throw new Error("getter executed")
    },
    enumerable: true
  })
  const cycle: unknown[] = []
  cycle.push(cycle)
  const deep: unknown[] = []
  let deepCursor = deep
  for (let index = 0; index < 32; index += 1) {
    const next: unknown[] = []
    deepCursor.push(next)
    deepCursor = next
  }
  const proxy = new Proxy(
    {},
    {
      ownKeys: () => {
        throw new Error("proxy executed")
      }
    }
  )
  let prototypeTrapCalls = 0
  const inheritedProxy = Object.create(
    new Proxy(
      {},
      {
        getPrototypeOf() {
          prototypeTrapCalls += 1
          throw new Error("prototype proxy executed")
        }
      }
    )
  )
  const broad = Object.fromEntries(
    Array.from({ length: 2_000 }, (_, index) => [`field${index}`, `value${index}`])
  )
  const value = [
    accessorArray,
    proxy,
    inheritedProxy,
    cycle,
    deep,
    broad,
    `{"password":"${EMBEDDED_SECRET}"}`,
    ...SECRET_VALUES
  ]

  const evidence = serializeDiagnosticEvidence(value)
  assert.equal(getterCalls, 0)
  assert.equal(prototypeTrapCalls, 0)
  assert.equal(evidence.sizeBytes <= 64 * 1024, true)
  assert.match(evidence.serialized, /\[accessor\]/)
  assert.match(evidence.serialized, /\[proxy\]/)
  assert.match(evidence.serialized, /\[object-omitted\]/)
  assert.match(evidence.serialized, /\[circular\]/)
  assert.match(evidence.serialized, /\[max-depth\]/)
  assertSecretsAbsent(evidence.serialized)
  const strictlyBounded = JSON.stringify(sanitizeDiagnosticValue(value, 128))
  assert.equal(Buffer.byteLength(strictlyBounded, "utf8") <= 128, true)
})

test("fatal error serialization rejects untrusted accessors and proxies", () => {
  const nativeStackDescriptor = Object.getOwnPropertyDescriptor(
    new Error("native stack descriptor"),
    "stack"
  )
  const nativeStackUsesAccessor = Boolean(
    nativeStackDescriptor && !("value" in nativeStackDescriptor)
  )

  let trapCalls = 0
  const proxy = new Proxy(
    {},
    {
      getPrototypeOf() {
        trapCalls += 1
        throw new Error("proxy trap executed")
      }
    }
  )
  assert.deepEqual(serializeProcessError(proxy), { message: "[proxy]" })
  assert.equal(errorFromUnhandledRejection(proxy).message, "Unhandled promise rejection: [proxy]")
  assert.equal(trapCalls, 0)

  let inheritedProxyTrapCalls = 0
  const inheritedProxyReason = Object.create(
    new Proxy(
      {},
      {
        getPrototypeOf() {
          inheritedProxyTrapCalls += 1
          throw new Error("inherited proxy trap executed")
        }
      }
    )
  )
  assert.equal(
    errorFromUnhandledRejection(inheritedProxyReason).message,
    "Unhandled promise rejection: [object-omitted]"
  )
  assert.equal(inheritedProxyTrapCalls, 0)

  let stackAccessorCalls = 0
  const customStackError = new Error("custom stack")
  Object.defineProperty(customStackError, "stack", {
    configurable: true,
    get() {
      stackAccessorCalls += 1
      return "unsafe stack"
    }
  })
  assert.equal(serializeProcessError(customStackError).stack, undefined)
  assert.equal(stackAccessorCalls, 0)

  let nameAccessorCalls = 0
  const customNameError = new Error("custom name")
  Object.defineProperty(customNameError, "name", {
    configurable: true,
    get() {
      nameAccessorCalls += 1
      return "UnsafeError"
    }
  })
  const serializedCustomName = serializeProcessError(customNameError)
  if (nativeStackUsesAccessor) {
    assert.equal(serializedCustomName.stack, undefined)
  }
  assert.equal(nameAccessorCalls, 0)

  let messageAccessorCalls = 0
  const customMessageError = new Error("custom message")
  Object.defineProperty(customMessageError, "message", {
    configurable: true,
    get() {
      messageAccessorCalls += 1
      return "unsafe message"
    }
  })
  const serializedCustomMessage = serializeProcessError(customMessageError)
  if (nativeStackUsesAccessor) {
    assert.equal(serializedCustomMessage.stack, undefined)
  }
  assert.equal(messageAccessorCalls, 0)

  let prototypeTrapCalls = 0
  const proxyPrototypeError = new Error("proxy prototype")
  Object.setPrototypeOf(
    proxyPrototypeError,
    new Proxy(Error.prototype, {
      getPrototypeOf() {
        prototypeTrapCalls += 1
        throw new Error("error prototype trap executed")
      }
    })
  )
  const serializedProxyPrototype = serializeProcessError(proxyPrototypeError)
  if (nativeStackUsesAccessor) {
    assert.equal(serializedProxyPrototype.stack, undefined)
  }
  assert.equal(prototypeTrapCalls, 0)

  const lazyStackError = new Error("prepare stack trace")
  const originalPrepareStackTrace = Object.getOwnPropertyDescriptor(Error, "prepareStackTrace")
  let prepareStackTraceCalls = 0
  Object.defineProperty(Error, "prepareStackTrace", {
    configurable: true,
    value() {
      prepareStackTraceCalls += 1
      return "unsafe prepared stack"
    },
    writable: true
  })
  try {
    assert.equal(serializeProcessError(lazyStackError).stack, undefined)
    assert.equal(prepareStackTraceCalls, 0)
  } finally {
    if (originalPrepareStackTrace) {
      Object.defineProperty(Error, "prepareStackTrace", originalPrepareStackTrace)
    } else {
      Reflect.deleteProperty(Error, "prepareStackTrace")
    }
  }
})

test("diagnostic graph redacts metadata and evidence before persistence", async () => {
  const rootDir = createTempDir("producer-redaction")
  const logDir = join(rootDir, "logs")
  try {
    const logger = new DiagnosticsLogger({ logDir, rootDir })
    assert.equal("appendRecord" in logger, false)
    let directAppendGetterCalls = 0
    const directAppend = {}
    Object.defineProperty(directAppend, "recordType", {
      get() {
        directAppendGetterCalls += 1
        throw new Error("direct append getter executed")
      }
    })
    Object.freeze(directAppend)
    await assert.rejects(
      logger[APPEND_DIAGNOSTIC_GRAPH_EVENT](directAppend as never),
      /untrusted graph event/
    )
    assert.equal(directAppendGetterCalls, 0)
    logger.error(SECRET_VALUES[0], { payload: SECRET_VALUES })
    await logger.flush()
    const graph = new DiagnosticsGraphRecorder({
      logger,
      onWriteError: () => undefined,
      sessionId: SECRET_VALUES[0]
    })
    let graphGetterCalls = 0
    const hostileInput: Record<string, unknown> = {
      component: "diagnostics",
      level: "error",
      operation: "redact",
      recoverable: true,
      stateImpact: "none",
      summary: "Hostile input"
    }
    Object.defineProperty(hostileInput, "eventCode", {
      get() {
        graphGetterCalls += 1
        throw new Error("graph getter executed")
      }
    })
    graph.capture(hostileInput as never)
    graph.capture({
      component: SECRET_VALUES[0],
      dimensionEntries: [
        { key: "detail", value: SECRET_VALUES.join(" ") },
        { key: "embedded", value: `{"password":"${EMBEDDED_SECRET}"}` },
        { key: "stdout", value: SENSITIVE_KEY_SECRET },
        { key: SECRET_VALUES[0], value: "safe" }
      ],
      eventCode: SECRET_VALUES[0],
      evidence: [{ kind: "error", value: [...SECRET_VALUES] }],
      fingerprint: SECRET_VALUES[0],
      level: "error",
      operation: SECRET_VALUES[0],
      recoverable: true,
      refs: [{ id: SECRET_VALUES[1], kind: SECRET_VALUES[0] }],
      stateImpact: SECRET_VALUES[0],
      summary: SECRET_VALUES[2]
    })
    await graph.flush()
    assert.equal(graphGetterCalls, 0)

    const journal = readFileSync(logger.getLogFilePath(), "utf8")
    assertSecretsAbsent(journal)
    const records = journal
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as { eventCode?: string; evidenceRefs?: Array<{ sha256: string }> }
      )
    assert.equal(
      records.some((record) => record.eventCode === "diagnostics.capture_failed"),
      true
    )
    const event = records.at(-1) as {
      evidenceRefs: Array<{ sha256: string }>
    }
    const sha256 = event.evidenceRefs[0].sha256
    const blob = readFileSync(
      join(logDir, "blobs", "sha256", sha256.slice(0, 2), `${sha256}.json`),
      "utf8"
    )
    assertSecretsAbsent(blob)
  } finally {
    rmSync(rootDir, { force: true, recursive: true })
  }
})

test("oversize fatal records preserve severity and ordered state impact", async () => {
  const rootDir = createTempDir("fatal-order")
  const logDir = join(rootDir, "logs")
  try {
    const logger = new DiagnosticsLogger({ logDir, maxRecordBytes: 1024, rootDir })
    logger.info("queued-before-fatal")
    await logger.errorAndFlush("fatal-write", {
      payload: Object.fromEntries(
        Array.from({ length: 64 }, (_, index) => [`field${index}`, "x".repeat(128)])
      ),
      recoverable: false,
      stack: "x".repeat(4_096),
      stateImpact: "process_terminating"
    })
    const records = readFileSync(logger.getLogFilePath(), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    assert.equal(records[0]["message"], "queued-before-fatal")
    assert.equal(records[1]["recordType"], "diagnostic.oversize")
    assert.equal(records[1]["level"], "error")
    assert.equal(records[1]["recoverable"], false)
    assert.equal(records[1]["stateImpact"], "process_terminating")
    assert.equal(records[1]["sourceMessage"], "fatal-write")
  } finally {
    rmSync(rootDir, { force: true, recursive: true })
  }
})

test("diagnostics inspector gates coverage and redacts every emitted surface", () => {
  const home = createTempDir("inspector")
  try {
    const logDir = join(home, "logs")
    const prefixRoot = join(logDir, "blobs", "sha256")
    mkdirSync(prefixRoot, { mode: 0o700, recursive: true })
    chmodSync(logDir, 0o700)
    chmodSync(join(logDir, "blobs"), 0o700)
    chmodSync(prefixRoot, 0o700)

    const rawBlob = JSON.stringify({ detail: SECRET_VALUES })
    const sha256 = createHash("sha256").update(rawBlob).digest("hex")
    const prefixDir = join(prefixRoot, sha256.slice(0, 2))
    mkdirSync(prefixDir, { mode: 0o700 })
    const blobPath = join(prefixDir, `${sha256}.json`)
    writeFileSync(blobPath, rawBlob, { mode: 0o600 })

    const event = {
      component: "diagnostics",
      dimensions: {
        detail: SECRET_VALUES.join(" "),
        embedded: `{"password":"${EMBEDDED_SECRET}"}`,
        messageContent: SENSITIVE_KEY_SECRET,
        stderr: SENSITIVE_KEY_SECRET,
        stdout: SENSITIVE_KEY_SECRET
      },
      eventCode: "diagnostics.fixture",
      eventId: "diag:fixture:1",
      evidenceRefs: [
        {
          blobId: `sha256:${sha256}`,
          capture: "stored",
          contentType: "application/json",
          kind: "error",
          originalSizeBytes: Buffer.byteLength(rawBlob),
          redactionVersion: 2,
          sha256,
          sizeBytes: Buffer.byteLength(rawBlob),
          truncated: false
        }
      ],
      fingerprint: SECRET_VALUES[0],
      level: "error",
      message: SECRET_VALUES[2],
      operation: "inspect",
      parentEventIds: [],
      processKind: "main",
      recordType: "diagnostic.event",
      recoverable: true,
      redactionVersion: 2,
      refs: [{ id: SECRET_VALUES[1], kind: "thread" }],
      schemaVersion: 1,
      sequence: 1,
      sessionId: "fixture",
      stateImpact: "none",
      timestamp: "2026-07-16T00:00:00.000Z"
    }
    const journalPath = join(logDir, "jingle.log")
    writeFileSync(journalPath, `${JSON.stringify(event)}\n`, { mode: 0o600 })

    for (const command of [
      ["health"],
      ["search", "--limit", "1"],
      ["show", event.eventId],
      ["graph", event.eventId],
      ["blob", `sha256:${sha256}`]
    ]) {
      const result = spawnSync(process.execPath, [INSPECTOR, "--home", home, ...command], {
        encoding: "utf8"
      })
      assert.equal(result.status, 0, result.stderr)
      assertSecretsAbsent(`${result.stdout}${result.stderr}`)
    }

    const health = spawnSync(process.execPath, [INSPECTOR, "--home", home, "health"], {
      encoding: "utf8"
    })
    const graphCoverage = JSON.parse(health.stdout)
    assert.equal(graphCoverage.coverage, "causal-events-observed")
    assert.equal(graphCoverage.failureEventCount, 1)
    assert.equal(graphCoverage.informationalEventCount, 0)

    if (process.platform !== "win32") {
      chmodSync(journalPath, 0o644)
      const insecure = spawnSync(process.execPath, [INSPECTOR, "--home", home, "health"], {
        encoding: "utf8"
      })
      const insecureHealth = JSON.parse(insecure.stdout)
      assert.equal(insecureHealth.coverage, "empty")
      assert.equal(insecureHealth.insecureJournalPermissions > 0, true)
      const insecureSearch = spawnSync(process.execPath, [INSPECTOR, "--home", home, "search"], {
        encoding: "utf8"
      })
      assert.notEqual(insecureSearch.status, 0)
      chmodSync(journalPath, 0o600)

      chmodSync(logDir, 0o755)
      const insecureDirectory = spawnSync(process.execPath, [INSPECTOR, "--home", home, "health"], {
        encoding: "utf8"
      })
      const insecureDirectoryHealth = JSON.parse(insecureDirectory.stdout)
      assert.equal(insecureDirectoryHealth.coverage, "empty")
      assert.equal(insecureDirectoryHealth.insecureJournalPermissions > 0, true)
      chmodSync(logDir, 0o700)
    }

    const missingId = `sha256:${"f".repeat(64)}`
    event.evidenceRefs.push({
      blobId: missingId,
      capture: "stored",
      contentType: "application/json",
      kind: "error",
      originalSizeBytes: 1,
      redactionVersion: 2,
      sha256: "f".repeat(64),
      sizeBytes: 1,
      truncated: false
    })
    writeFileSync(journalPath, `${JSON.stringify(event)}\n`, { mode: 0o600 })
    const missing = spawnSync(process.execPath, [INSPECTOR, "--home", home, "blob", missingId], {
      encoding: "utf8"
    })
    assert.notEqual(missing.status, 0)
    assert.equal(missing.stderr.includes(home), false)

    if (process.platform !== "win32") {
      const escapedBlob = join(home, "escaped-blob.json")
      writeFileSync(escapedBlob, SECRET_VALUES.join("\n"), { mode: 0o600 })
      rmSync(blobPath)
      symlinkSync(escapedBlob, blobPath)
      const unsafeBlob = spawnSync(
        process.execPath,
        [INSPECTOR, "--home", home, "blob", `sha256:${sha256}`],
        { encoding: "utf8" }
      )
      assert.notEqual(unsafeBlob.status, 0)
      assert.equal(`${unsafeBlob.stdout}${unsafeBlob.stderr}`.includes(home), false)
      assertSecretsAbsent(`${unsafeBlob.stdout}${unsafeBlob.stderr}`)
    }

    const help = spawnSync(process.execPath, [INSPECTOR, "--help"], {
      encoding: "utf8",
      env: { ...process.env, JINGLE_HOME: "" }
    })
    assert.equal(help.status, 0)
    assert.match(help.stdout, /Usage:/)
    assert.equal(help.stderr, "")
  } finally {
    rmSync(home, { force: true, recursive: true })
  }
})

test("diagnostics inspector rejects legacy-only and informational-only coverage", () => {
  const home = createTempDir("legacy-coverage")
  try {
    const logDir = join(home, "logs")
    mkdirSync(logDir, { mode: 0o700 })
    const forgedBase = {
      component: "diagnostics",
      dimensions: {},
      eventCode: "diagnostics.forged",
      eventId: "diag:forged:1",
      evidenceRefs: [
        {
          blobId: `sha256:${"a".repeat(64)}`,
          capture: "stored",
          kind: "error",
          sizeBytes: 1
        }
      ],
      fingerprint: "diagnostics.forged",
      level: "warn",
      message: "Forged event",
      operation: "inspect",
      parentEventIds: [],
      processKind: "main",
      recordType: "diagnostic.event",
      recoverable: true,
      redactionVersion: 2,
      refs: [],
      schemaVersion: 1,
      sequence: 1,
      sessionId: "forged",
      stateImpact: "none",
      timestamp: "2026-07-16T00:00:00.000Z"
    }
    const forgedDimensions = {
      ...forgedBase,
      dimensions: { nested: { value: "not-scalar" } },
      eventId: "diag:forged:2",
      evidenceRefs: [],
      sequence: 2
    }
    const journalPath = join(logDir, "jingle.log")
    writeFileSync(
      journalPath,
      [
        '{"level":"warn","message":"legacy"}',
        JSON.stringify(forgedBase),
        JSON.stringify(forgedDimensions)
      ].join("\n") + "\n",
      { mode: 0o600 }
    )
    const result = spawnSync(process.execPath, [INSPECTOR, "--home", home, "health"], {
      encoding: "utf8"
    })
    assert.equal(result.status, 0, result.stderr)
    const health = JSON.parse(result.stdout)
    assert.equal(health.coverage, "legacy-only")
    assert.equal(health.incompatibleGraphLines, 2)
    const search = spawnSync(process.execPath, [INSPECTOR, "--home", home, "search"], {
      encoding: "utf8"
    })
    assert.notEqual(search.status, 0)

    const sessionEvent = {
      component: "diagnostics",
      dimensions: { isPackaged: true },
      eventCode: "diagnostics.session_started",
      eventId: "diag:session-only:1",
      evidenceRefs: [],
      fingerprint: "diagnostics.session_started",
      level: "info",
      message: "Jingle diagnostics session started",
      operation: "start-session",
      parentEventIds: [],
      processKind: "main",
      recordType: "diagnostic.event",
      recoverable: true,
      redactionVersion: 2,
      refs: [],
      schemaVersion: 1,
      sequence: 1,
      sessionId: "session-only",
      stateImpact: "none",
      timestamp: "2026-07-16T00:00:00.000Z"
    }
    writeFileSync(
      journalPath,
      [
        JSON.stringify(sessionEvent),
        JSON.stringify({
          eventCode: "process.fatal_error",
          level: "error",
          message: "fatal legacy"
        })
      ].join("\n") + "\n",
      { mode: 0o600 }
    )
    const sessionHealthResult = spawnSync(process.execPath, [INSPECTOR, "--home", home, "health"], {
      encoding: "utf8"
    })
    assert.equal(sessionHealthResult.status, 0, sessionHealthResult.stderr)
    const sessionHealth = JSON.parse(sessionHealthResult.stdout)
    assert.equal(sessionHealth.coverage, "no-failure-events-observed")
    assert.equal(sessionHealth.eventCount, 1)
    assert.equal(sessionHealth.failureEventCount, 0)
    assert.equal(sessionHealth.informationalEventCount, 1)
    assert.equal(sessionHealth.legacyLines, 1)
    const sessionSearch = spawnSync(process.execPath, [INSPECTOR, "--home", home, "search"], {
      encoding: "utf8"
    })
    assert.notEqual(sessionSearch.status, 0)

    const selfParentEvent = {
      ...sessionEvent,
      eventCode: "diagnostics.tampered_self_parent",
      eventId: "diag:tampered:1",
      level: "error",
      parentEventIds: ["diag:tampered:1"],
      sessionId: "tampered"
    }
    const crossSessionEvent = {
      ...selfParentEvent,
      eventCode: "diagnostics.tampered_cross_session",
      eventId: "diag:tampered-other:1",
      parentEventIds: [selfParentEvent.eventId],
      sessionId: "tampered-other"
    }
    writeFileSync(
      journalPath,
      `${JSON.stringify(selfParentEvent)}\n${JSON.stringify(crossSessionEvent)}\n`,
      { mode: 0o600 }
    )
    const tamperedHealthResult = spawnSync(
      process.execPath,
      [INSPECTOR, "--home", home, "health"],
      { encoding: "utf8" }
    )
    assert.equal(tamperedHealthResult.status, 0, tamperedHealthResult.stderr)
    const tamperedHealth = JSON.parse(tamperedHealthResult.stdout)
    assert.equal(tamperedHealth.coverage, "causal-events-observed")
    assert.equal(tamperedHealth.crossSessionParents, 1)
    assert.equal(tamperedHealth.nonPastParents, 1)
    assert.equal(tamperedHealth.cycleEdges, 1)

    const tamperedGraphResult = spawnSync(
      process.execPath,
      [INSPECTOR, "--home", home, "graph", crossSessionEvent.eventId],
      { encoding: "utf8" }
    )
    assert.equal(tamperedGraphResult.status, 0, tamperedGraphResult.stderr)
    const tamperedGraph = JSON.parse(tamperedGraphResult.stdout)
    assert.deepEqual(tamperedGraph.edges, [])
    assert.deepEqual(
      tamperedGraph.nodes.map((event: { eventId: string; parentEventIds: string[] }) => ({
        eventId: event.eventId,
        parentEventIds: event.parentEventIds
      })),
      [{ eventId: crossSessionEvent.eventId, parentEventIds: [] }]
    )

    const tamperedShowResult = spawnSync(
      process.execPath,
      [INSPECTOR, "--home", home, "show", selfParentEvent.eventId],
      { encoding: "utf8" }
    )
    assert.equal(tamperedShowResult.status, 0, tamperedShowResult.stderr)
    assert.deepEqual(JSON.parse(tamperedShowResult.stdout).event.parentEventIds, [])

    const duplicateEvent = { ...selfParentEvent, parentEventIds: [] }
    writeFileSync(
      journalPath,
      `${JSON.stringify(duplicateEvent)}\n${JSON.stringify(duplicateEvent)}\n`,
      { mode: 0o600 }
    )
    const duplicateHealthResult = spawnSync(
      process.execPath,
      [INSPECTOR, "--home", home, "health"],
      { encoding: "utf8" }
    )
    assert.equal(duplicateHealthResult.status, 0, duplicateHealthResult.stderr)
    assert.equal(JSON.parse(duplicateHealthResult.stdout).duplicateEventIds, 1)
    const duplicateSearch = spawnSync(process.execPath, [INSPECTOR, "--home", home, "search"], {
      encoding: "utf8"
    })
    assert.notEqual(duplicateSearch.status, 0)
    assert.match(duplicateSearch.stderr, /Duplicate diagnostic event IDs/)
    assert.equal(duplicateSearch.stderr.includes(home), false)
  } finally {
    rmSync(home, { force: true, recursive: true })
  }
})

test(
  "diagnostics inspector rejects a symlinked logs directory without reading its target",
  { skip: process.platform === "win32" },
  () => {
    const home = createTempDir("inspector-symlink")
    const outside = createTempDir("inspector-outside")
    try {
      writeFileSync(
        join(outside, "jingle.log"),
        `${JSON.stringify({ message: SECRET_VALUES.join(" ") })}\n`,
        { mode: 0o600 }
      )
      symlinkSync(outside, join(home, "logs"), "dir")
      const result = spawnSync(process.execPath, [INSPECTOR, "--home", home, "health"], {
        encoding: "utf8"
      })
      assert.notEqual(result.status, 0)
      assert.equal(`${result.stdout}${result.stderr}`.includes(home), false)
      assertSecretsAbsent(`${result.stdout}${result.stderr}`)
    } finally {
      rmSync(home, { force: true, recursive: true })
      rmSync(outside, { force: true, recursive: true })
    }
  }
)
