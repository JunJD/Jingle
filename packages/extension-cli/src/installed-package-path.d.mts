export interface InstalledExtensionPackageIdentity {
  id: string
  version: string
}

export interface InstalledExtensionPackagePath extends InstalledExtensionPackageIdentity {
  packageRoot: string
}

export function isInstalledExtensionId(value: unknown): value is string
export function isInstalledExtensionVersion(value: unknown): value is string
export function parseInstalledExtensionId(value: unknown): string
export function parseInstalledExtensionVersion(value: unknown): string
export function resolveInstalledExtensionPackageRoot(
  outputRoot: string,
  identity: InstalledExtensionPackageIdentity
): string
export function resolveCanonicalInstalledExtensionPackageRoot(
  outputRoot: string,
  identity: InstalledExtensionPackageIdentity
): Promise<string>
export function parseInstalledExtensionPackageRoot(
  outputRoot: string,
  packageRoot: string
): InstalledExtensionPackagePath
