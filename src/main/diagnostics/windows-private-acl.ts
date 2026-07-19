import { execFile, execFileSync } from "node:child_process"
import { lstatSync, type Stats } from "node:fs"
import { lstat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

type PrivateWindowsPathKind = "directory" | "file"

const execFileAsync = promisify(execFile)
const WINDOWS_PRIVATE_ACL_TIMEOUT_MS = 5_000
const WINDOWS_PRIVATE_ACL_SCRIPT = String.raw`
param(
  [Parameter(Mandatory = $true)][string]$targetPath,
  [Parameter(Mandatory = $true)][ValidateSet('directory', 'file')][string]$pathKind
)
$ErrorActionPreference = 'Stop'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$allowedSidValues = @($identity.User.Value, 'S-1-5-18', 'S-1-5-32-544')
$accessType = [System.Security.AccessControl.AccessControlType]::Allow
$rights = [System.Security.AccessControl.FileSystemRights]::FullControl
$propagation = [System.Security.AccessControl.PropagationFlags]::None

if ($pathKind -eq 'directory') {
  $acl = [System.Security.AccessControl.DirectorySecurity]::new()
  $inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
} elseif ($pathKind -eq 'file') {
  $acl = [System.Security.AccessControl.FileSecurity]::new()
  $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
} else {
  throw 'Invalid diagnostics path kind.'
}

$acl.SetOwner($identity.User)
$acl.SetAccessRuleProtection($true, $false)
foreach ($sidValue in $allowedSidValues) {
  $sid = [System.Security.Principal.SecurityIdentifier]::new($sidValue)
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
    $sid,
    $rights,
    $inheritance,
    $propagation,
    $accessType
  )
  [void]$acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $targetPath -AclObject $acl

$verified = Get-Acl -LiteralPath $targetPath
if (-not $verified.AreAccessRulesProtected) {
  throw 'Diagnostics ACL inheritance is not protected.'
}
$ownerSid = $verified.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
if ($ownerSid -ne $identity.User.Value) {
  throw 'Diagnostics ACL owner is not the current user.'
}
$verifiedRules = $verified.GetAccessRules(
  $true,
  $true,
  [System.Security.Principal.SecurityIdentifier]
)
foreach ($rule in $verifiedRules) {
  if (
    $rule.AccessControlType -eq $accessType -and
    $allowedSidValues -notcontains $rule.IdentityReference.Value
  ) {
    throw 'Diagnostics ACL grants access to an unexpected principal.'
  }
}
foreach ($sidValue in $allowedSidValues) {
  $hasFullControl = @($verifiedRules | Where-Object {
    $_.AccessControlType -eq $accessType -and
    $_.IdentityReference.Value -eq $sidValue -and
    ($_.FileSystemRights -band $rights) -eq $rights
  }).Count -gt 0
  if (-not $hasFullControl) {
    throw 'Diagnostics ACL is missing a required private principal.'
  }
}
`

const securedPathIdentities = new Map<string, string>()
const securedFileIdentities = new Set<string>()
const securingPaths = new Map<string, Promise<void>>()

export class DiagnosticsPrivateWindowsAclError extends Error {
  constructor(cause: unknown) {
    super("Diagnostics path could not be secured with a private Windows ACL.", { cause })
    this.name = "DiagnosticsPrivateWindowsAclError"
  }
}

function getPowerShellPath(): string {
  const systemRoot = process.env.SystemRoot?.trim()
  if (!systemRoot) {
    throw new Error("Missing Windows SystemRoot environment variable")
  }
  return path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
}

function getPathCacheKey(targetPath: string): string {
  return path.resolve(targetPath).toLowerCase()
}

function getFileIdentity(kind: PrivateWindowsPathKind, stats: Stats): string {
  return `${kind}:${stats.dev}:${stats.ino}:${stats.birthtimeMs}`
}

function assertExpectedPathIdentity(
  kind: PrivateWindowsPathKind,
  expected: Stats,
  actual: Stats
): void {
  const hasExpectedKind = kind === "directory" ? actual.isDirectory() : actual.isFile()
  if (
    !hasExpectedKind ||
    actual.isSymbolicLink() ||
    actual.dev !== expected.dev ||
    actual.ino !== expected.ino ||
    actual.birthtimeMs !== expected.birthtimeMs ||
    actual.nlink !== expected.nlink
  ) {
    throw new Error(`Diagnostics ${kind} changed while its Windows ACL was being secured.`)
  }
}

function getPowerShellArgs(targetPath: string, kind: PrivateWindowsPathKind): string[] {
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `& {${WINDOWS_PRIVATE_ACL_SCRIPT}}`,
    targetPath,
    kind
  ]
}

export function ensurePrivateWindowsAclSync(
  targetPath: string,
  kind: PrivateWindowsPathKind,
  stats: Stats
): void {
  const cacheKey = getPathCacheKey(targetPath)
  const identity = getFileIdentity(kind, stats)
  if (securedPathIdentities.get(cacheKey) === identity) {
    return
  }
  if (securedFileIdentities.has(identity)) {
    securedPathIdentities.set(cacheKey, identity)
    return
  }

  try {
    execFileSync(getPowerShellPath(), getPowerShellArgs(targetPath, kind), {
      encoding: "utf8",
      stdio: "pipe",
      timeout: WINDOWS_PRIVATE_ACL_TIMEOUT_MS,
      windowsHide: true
    })
    assertExpectedPathIdentity(kind, stats, lstatSync(targetPath))
  } catch (error) {
    throw new DiagnosticsPrivateWindowsAclError(error)
  }
  securedPathIdentities.set(cacheKey, identity)
  securedFileIdentities.add(identity)
}

export async function ensurePrivateWindowsAcl(
  targetPath: string,
  kind: PrivateWindowsPathKind,
  stats: Stats
): Promise<void> {
  const cacheKey = getPathCacheKey(targetPath)
  const identity = getFileIdentity(kind, stats)
  if (securedPathIdentities.get(cacheKey) === identity) {
    return
  }
  if (securedFileIdentities.has(identity)) {
    securedPathIdentities.set(cacheKey, identity)
    return
  }

  const inFlight = securingPaths.get(cacheKey)
  if (inFlight) {
    await inFlight
    if (securedPathIdentities.get(cacheKey) === identity) {
      return
    }
  }

  const securing = execFileAsync(getPowerShellPath(), getPowerShellArgs(targetPath, kind), {
    encoding: "utf8",
    timeout: WINDOWS_PRIVATE_ACL_TIMEOUT_MS,
    windowsHide: true
  })
    .then(async () => {
      assertExpectedPathIdentity(kind, stats, await lstat(targetPath))
      securedPathIdentities.set(cacheKey, identity)
      securedFileIdentities.add(identity)
    })
    .catch((error: unknown) => {
      throw new DiagnosticsPrivateWindowsAclError(error)
    })
  securingPaths.set(cacheKey, securing)
  try {
    await securing
  } finally {
    if (securingPaths.get(cacheKey) === securing) {
      securingPaths.delete(cacheKey)
    }
  }
}
