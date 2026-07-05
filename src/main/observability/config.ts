export type ObservabilityProvider = "local" | "langsmith"

export interface ObservabilityRuntimeConfig {
  provider: ObservabilityProvider
  tracingEnabled: boolean
}

interface ObservabilityEnv {
  [key: string]: string | undefined
}

export interface ConfigureObservabilityOptions {
  env?: ObservabilityEnv
  logger?: Pick<Console, "info" | "warn">
}

const DEFAULT_LANGSMITH_PROJECT = "jingle-dev"

function readEnvValue(env: ObservabilityEnv, key: string): string | null {
  const value = env[key]?.trim()
  return value && value.length > 0 ? value : null
}

function isEnabledEnvValue(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true"
}

function hasLangSmithTracingSignal(env: ObservabilityEnv): boolean {
  return (
    readEnvValue(env, "LANGSMITH_API_KEY") !== null ||
    isEnabledEnvValue(readEnvValue(env, "LANGSMITH_TRACING"))
  )
}

export function resolveObservabilityRuntimeConfig(
  env: ObservabilityEnv = process.env
): ObservabilityRuntimeConfig {
  const provider: ObservabilityProvider = hasLangSmithTracingSignal(env) ? "langsmith" : "local"

  return {
    provider,
    tracingEnabled: provider === "langsmith"
  }
}

export function configureObservability(
  options: ConfigureObservabilityOptions = {}
): ObservabilityRuntimeConfig {
  const env = options.env ?? process.env
  const logger = options.logger ?? console
  const config = resolveObservabilityRuntimeConfig(env)

  if (config.provider !== "langsmith") {
    return config
  }

  env.LANGSMITH_TRACING = "true"
  env.LANGSMITH_PROJECT ??= DEFAULT_LANGSMITH_PROJECT

  if (!readEnvValue(env, "LANGSMITH_API_KEY")) {
    logger.warn("[Observability] LangSmith tracing is enabled, but LANGSMITH_API_KEY is not set.")
  } else {
    logger.info(`[Observability] LangSmith tracing enabled for project "${env.LANGSMITH_PROJECT}".`)
  }

  return config
}
