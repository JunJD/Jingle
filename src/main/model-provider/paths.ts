import { existsSync, mkdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { getOpenworkDir } from "../storage"
import type { ModelProviderPaths } from "./types"

function resolveConfigDir(): string {
  const override = process.env["JINGLE_CONFIG_HOME"]?.trim()
  if (override) {
    return override
  }

  const testHome = process.env["OPENWORK_HOME"]?.trim()
  if (testHome) {
    return join(getOpenworkDir(), "jingle-config")
  }

  return join(homedir(), ".config", "jingle")
}

function resolveDataDir(): string {
  const override = process.env["JINGLE_DATA_HOME"]?.trim()
  if (override) {
    return override
  }

  const testHome = process.env["OPENWORK_HOME"]?.trim()
  if (testHome) {
    return join(getOpenworkDir(), "jingle-data")
  }

  return join(homedir(), ".local", "share", "jingle")
}

function ensureDir(path: string): string {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }

  return path
}

export function getJingleConfigDir(): string {
  return ensureDir(resolveConfigDir())
}

export function getJingleDataDir(): string {
  return ensureDir(resolveDataDir())
}

export function getJingleModelConfigPath(): string {
  return join(getJingleConfigDir(), "config.yaml")
}

export function getJingleAuthPath(): string {
  return join(getJingleConfigDir(), "auth.json")
}

export function getJingleCustomProvidersDir(): string {
  return ensureDir(join(getJingleConfigDir(), "custom_providers"))
}

export function getJingleModelRegistryPath(): string {
  const modelsDir = ensureDir(join(getJingleDataDir(), "models"))
  return join(modelsDir, "registry.json")
}

export function getModelProviderPaths(): ModelProviderPaths {
  return {
    authPath: getJingleAuthPath(),
    configPath: getJingleModelConfigPath(),
    customProvidersDir: getJingleCustomProvidersDir(),
    modelRegistryPath: getJingleModelRegistryPath()
  }
}
