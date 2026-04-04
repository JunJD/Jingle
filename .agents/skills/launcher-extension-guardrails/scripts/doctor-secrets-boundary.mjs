import { listNativeExtensionDirectories, loadNativeExtensionManifest, readSourceText } from "./lib/architecture-guardrails.mjs"

const passwordPreferences = []

for (const extensionDirectory of listNativeExtensionDirectories()) {
  const manifest = loadNativeExtensionManifest(extensionDirectory)

  for (const preference of manifest.preferences ?? []) {
    if (preference.type === "password") {
      passwordPreferences.push({
        extension: manifest.name,
        name: preference.name,
        scope: "extension"
      })
    }
  }

  for (const command of manifest.commands) {
    for (const preference of command.preferences ?? []) {
      if (preference.type === "password") {
        passwordPreferences.push({
          command: command.name,
          extension: manifest.name,
          name: preference.name,
          scope: "command"
        })
      }
    }
  }
}

const preferencesSource = readSourceText("src/main/preferences.ts")
const usesSafeStorage = preferencesSource.includes("safeStorage")
const usesKeytar = preferencesSource.includes("keytar")
const hasSecretModule =
  preferencesSource.includes("getSecret") ||
  preferencesSource.includes("setSecret") ||
  preferencesSource.includes("secret")

console.log("secrets boundary doctor")
console.log("")
console.log(`password preferences found: ${passwordPreferences.length}`)

if (passwordPreferences.length > 0) {
  console.log("")
  for (const preference of passwordPreferences) {
    const scope =
      preference.scope === "extension"
        ? `${preference.extension}`
        : `${preference.extension}/${preference.command}`
    console.log(`${scope}`)
    console.log(`  password preference: ${preference.name}`)
  }
}

console.log("")
console.log(`preferences.ts uses safeStorage: ${usesSafeStorage ? "yes" : "no"}`)
console.log(`preferences.ts uses keytar: ${usesKeytar ? "yes" : "no"}`)
console.log(`preferences.ts hints at dedicated secret helpers: ${hasSecretModule ? "yes" : "no"}`)

if (passwordPreferences.length > 0 && !usesSafeStorage && !usesKeytar && !hasSecretModule) {
  console.log("")
  console.log("warning: password preferences are declared, but main preference storage still looks like generic settings storage")
}
