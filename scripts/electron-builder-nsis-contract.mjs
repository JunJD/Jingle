import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const REQUIRED_ELECTRON_BUILDER_VERSION = "26.9.1"

function readPackageVersion(root, packageName) {
  const packagePath = join(root, "node_modules", ...packageName.split("/"), "package.json")
  return JSON.parse(readFileSync(packagePath, "utf8")).version
}

export function assertElectronBuilderNsisContract(root = process.cwd()) {
  const resolvedRoot = resolve(root)
  const versions = Object.fromEntries(
    ["electron-builder", "app-builder-lib", "electron-builder-squirrel-windows"].map(
      (packageName) => [packageName, readPackageVersion(resolvedRoot, packageName)]
    )
  )
  for (const [packageName, version] of Object.entries(versions)) {
    if (version !== REQUIRED_ELECTRON_BUILDER_VERSION) {
      throw new Error(
        `Resolved ${packageName} ${String(version)} does not match required ${REQUIRED_ELECTRON_BUILDER_VERSION}.`
      )
    }
  }

  const templatePath = join(
    resolvedRoot,
    "node_modules",
    "app-builder-lib",
    "templates",
    "nsis",
    "multiUser.nsh"
  )
  const template = readFileSync(templatePath, "utf8")
  const compatibilityStart = template.indexOf("${IfNot} ${AtLeastWin8}")
  const compatibilityEnd = template.indexOf("${EndIf}", compatibilityStart)
  const stores = [...template.matchAll(/System::Store [SL]/g)].map((match) => match.index)
  if (
    !template.includes("!include WinVer.nsh") ||
    compatibilityStart < 0 ||
    compatibilityEnd < 0 ||
    stores.length !== 2 ||
    stores.some((index) => index < compatibilityStart || index > compatibilityEnd)
  ) {
    throw new Error(
      "Resolved electron-builder NSIS template does not guard the Windows 7 System::Store compatibility path."
    )
  }
  return { templatePath, versions }
}
