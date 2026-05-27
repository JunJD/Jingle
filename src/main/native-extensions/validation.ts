import { existsSync } from "node:fs"
import { join } from "node:path"
import type {
  NativeExtensionMainDefinition,
  NativeExtensionPackageManifest
} from "@shared/native-extensions"
import {
  validateNativeExtensionMainDefinition,
  validateNativeExtensionPackageManifest
} from "@shared/native-extensions"
import type { NativeExtensionRuntimePackage } from "@extensions/runtime-contract"
import type { NativeExtensionRuntimePackageMetadata } from "@extensions/runtime-metadata-contract"

export interface NativeExtensionValidationInput {
  assetRoot?: string
  assetRoots?: string[]
  mainDefinitions: Map<string, NativeExtensionMainDefinition>
  manifests: NativeExtensionPackageManifest[]
  runtimeMetadataPackages: NativeExtensionRuntimePackageMetadata[]
  runtimePackages: NativeExtensionRuntimePackage[]
}

export interface NativeExtensionValidationResult {
  errors: string[]
}

function formatExtensionCommand(extensionName: string, commandName: string): string {
  return `${extensionName}:${commandName}`
}

function collectDuplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value)
    }
    seen.add(value)
  }

  return [...duplicates]
}

function validateIconAsset(input: {
  assetRoots: string[]
  errors: string[]
  extensionName: string
  icon: string | undefined
  label: string
}): void {
  if (!input.icon) {
    return
  }

  const icon = input.icon
  const assetPaths = input.assetRoots.map((assetRoot) =>
    join(assetRoot, input.extensionName, icon)
  )
  if (!assetPaths.some((assetPath) => existsSync(assetPath))) {
    input.errors.push(
      `Native extension "${input.extensionName}" ${input.label} icon asset does not exist: ${input.icon}`
    )
  }
}

function collectRuntimeCommandNames(
  runtimePackages: NativeExtensionRuntimePackage[]
): Map<string, Set<string>> {
  return new Map(
    runtimePackages.map((runtimePackage) => [
      runtimePackage.extensionName,
      new Set(Object.keys(runtimePackage.commands))
    ])
  )
}

function collectRuntimeCommands(
  runtimePackages: NativeExtensionRuntimePackage[]
): Map<string, NativeExtensionRuntimePackage["commands"]> {
  return new Map(
    runtimePackages.map((runtimePackage) => [runtimePackage.extensionName, runtimePackage.commands])
  )
}

function collectRuntimeMetadataCommandNames(
  runtimeMetadataPackages: NativeExtensionRuntimePackageMetadata[]
): Map<string, Set<string>> {
  return new Map(
    runtimeMetadataPackages.map((metadataPackage) => [
      metadataPackage.extensionName,
      new Set(metadataPackage.commands.map((command) => command.name))
    ])
  )
}

export function validateNativeExtensionRegistry(
  input: NativeExtensionValidationInput
): NativeExtensionValidationResult {
  const errors: string[] = []
  const assetRoots = input.assetRoots ?? (input.assetRoot ? [input.assetRoot] : [])
  const manifestNames = input.manifests.map((manifest) => manifest.name)
  const manifestNamesSet = new Set(manifestNames)
  const runtimeExtensionNames = input.runtimePackages.map(
    (runtimePackage) => runtimePackage.extensionName
  )
  const runtimeMetadataExtensionNames = input.runtimeMetadataPackages.map(
    (metadataPackage) => metadataPackage.extensionName
  )
  const runtimeCommandsByExtension = collectRuntimeCommandNames(input.runtimePackages)
  const runtimeCommandDefinitionsByExtension = collectRuntimeCommands(input.runtimePackages)
  const runtimeMetadataCommandsByExtension = collectRuntimeMetadataCommandNames(
    input.runtimeMetadataPackages
  )

  for (const duplicateName of collectDuplicateValues(manifestNames)) {
    errors.push(`Native extension registry declares duplicate manifest "${duplicateName}"`)
  }

  for (const extensionName of runtimeExtensionNames) {
    if (!manifestNamesSet.has(extensionName)) {
      errors.push(`Native extension runtime package "${extensionName}" has no manifest`)
    }
  }

  for (const extensionName of runtimeMetadataExtensionNames) {
    if (!manifestNamesSet.has(extensionName)) {
      errors.push(`Native extension runtime metadata "${extensionName}" has no manifest`)
    }
  }

  for (const manifest of input.manifests) {
    try {
      validateNativeExtensionPackageManifest(manifest)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }

    const mainDefinition = input.mainDefinitions.get(manifest.name)
    if (!mainDefinition) {
      errors.push(`Native extension "${manifest.name}" has no main definition`)
    } else {
      try {
        validateNativeExtensionMainDefinition(manifest, mainDefinition)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }

    validateIconAsset({
      assetRoots,
      errors,
      extensionName: manifest.name,
      icon: manifest.icon,
      label: "package"
    })

    const commandNames = new Set(manifest.commands.map((command) => command.name))
    const runtimeCommandNames = runtimeCommandsByExtension.get(manifest.name) ?? new Set()
    const runtimeCommandDefinitions = runtimeCommandDefinitionsByExtension.get(manifest.name) ?? {}
    const runtimeMetadataCommandNames =
      runtimeMetadataCommandsByExtension.get(manifest.name) ?? new Set()

    for (const command of manifest.commands) {
      validateIconAsset({
        assetRoots,
        errors,
        extensionName: manifest.name,
        icon: command.icon,
        label: `command "${command.name}"`
      })

      if (command.runtime && !runtimeCommandNames.has(command.name)) {
        errors.push(
          `Native extension runtime command "${formatExtensionCommand(
            manifest.name,
            command.name
          )}" is declared in manifest but missing from runtime package`
        )
      }

      const runtimeCommand = runtimeCommandDefinitions[command.name]
      if (runtimeCommand && runtimeCommand.mode !== command.mode) {
        errors.push(
          `Native extension runtime command "${formatExtensionCommand(
            manifest.name,
            command.name
          )}" mode "${runtimeCommand.mode}" does not match manifest mode "${command.mode}"`
        )
      }
    }

    for (const commandName of runtimeCommandNames) {
      if (!commandNames.has(commandName)) {
        errors.push(
          `Native extension runtime command "${formatExtensionCommand(
            manifest.name,
            commandName
          )}" is not declared in manifest`
        )
      }
    }

    for (const commandName of runtimeMetadataCommandNames) {
      if (!commandNames.has(commandName)) {
        errors.push(
          `Native extension runtime metadata command "${formatExtensionCommand(
            manifest.name,
            commandName
          )}" is not declared in manifest`
        )
      }
    }

    const service = mainDefinition?.service
    if (service) {
      const declaredRpcMethods = new Set(manifest.rpcMethods ?? [])
      for (const method of service.methods) {
        if (!declaredRpcMethods.has(method)) {
          errors.push(
            `Native extension "${manifest.name}" service implements undeclared RPC method "${method}"`
          )
        }
      }
      for (const method of declaredRpcMethods) {
        if (!service.methods.includes(method)) {
          errors.push(
            `Native extension "${manifest.name}" manifest declares RPC method "${method}" but service does not implement it`
          )
        }
      }
    } else if ((manifest.rpcMethods ?? []).length > 0) {
      errors.push(`Native extension "${manifest.name}" declares RPC methods but has no service`)
    }

    const tools = mainDefinition?.tools ?? []
    for (const duplicateToolName of collectDuplicateValues(tools.map((tool) => tool.name))) {
      errors.push(
        `Native extension "${manifest.name}" main definition declares duplicate tool "${duplicateToolName}"`
      )
    }

    const toolNames = new Set(tools.map((tool) => tool.name))
    const aiToolNames = manifest.aiCapability?.toolNames ?? []
    for (const toolName of aiToolNames) {
      if (!toolNames.has(toolName)) {
        errors.push(
          `Native extension "${manifest.name}" aiCapability declares unavailable tool "${toolName}"`
        )
      }
    }
  }

  return {
    errors
  }
}
