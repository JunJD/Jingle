export const JINGLE_COMPUTER_USE_PROTOCOL_VERSION = 1

export const COMPUTER_USE_NATIVE_ACTIONS = Object.freeze([
  "activate",
  "press",
  "set_value",
  "type_text",
  "keypress",
  "scroll"
])

const AVAILABLE_SEMANTIC = Object.freeze(["verified", "unavailable"])
const REFUSED = Object.freeze(["refused"])
const UNAVAILABLE = Object.freeze(["unavailable"])

const linuxCapabilities = {
  activate: { background: UNAVAILABLE, foreground: UNAVAILABLE, route: "unavailable" },
  keypress: { background: REFUSED, foreground: UNAVAILABLE, route: "unavailable" },
  press: {
    background: AVAILABLE_SEMANTIC,
    foreground: UNAVAILABLE,
    route: "at_spi_action"
  },
  scroll: {
    background: AVAILABLE_SEMANTIC,
    foreground: UNAVAILABLE,
    route: "at_spi_action"
  },
  set_value: {
    background: AVAILABLE_SEMANTIC,
    foreground: UNAVAILABLE,
    route: "at_spi_editable_text"
  },
  type_text: {
    background: AVAILABLE_SEMANTIC,
    foreground: UNAVAILABLE,
    route: "at_spi_editable_text"
  }
}

const environmentPolicies = deepFreeze({
  "linux-wayland-gnome": { capabilities: linuxCapabilities, platform: "linux" },
  "linux-wayland-kde": { capabilities: linuxCapabilities, platform: "linux" },
  "linux-wayland-other": { capabilities: linuxCapabilities, platform: "linux" },
  "linux-x11": { capabilities: linuxCapabilities, platform: "linux" },
  "macos-quartz": {
    capabilities: {
      activate: {
        background: REFUSED,
        foreground: AVAILABLE_SEMANTIC,
        route: "ax_raise_activate"
      },
      keypress: { background: REFUSED, foreground: UNAVAILABLE, route: "unavailable" },
      press: { background: AVAILABLE_SEMANTIC, foreground: UNAVAILABLE, route: "ax_action" },
      scroll: { background: UNAVAILABLE, foreground: UNAVAILABLE, route: "unavailable" },
      set_value: { background: AVAILABLE_SEMANTIC, foreground: UNAVAILABLE, route: "ax_value" },
      type_text: { background: AVAILABLE_SEMANTIC, foreground: UNAVAILABLE, route: "ax_value" }
    },
    platform: "macos"
  },
  "windows-win32": {
    capabilities: {
      activate: { background: UNAVAILABLE, foreground: UNAVAILABLE, route: "unavailable" },
      keypress: { background: UNAVAILABLE, foreground: UNAVAILABLE, route: "uia_unavailable" },
      press: { background: UNAVAILABLE, foreground: UNAVAILABLE, route: "uia_action" },
      scroll: { background: UNAVAILABLE, foreground: UNAVAILABLE, route: "uia_unavailable" },
      set_value: { background: UNAVAILABLE, foreground: UNAVAILABLE, route: "uia_value" },
      type_text: { background: UNAVAILABLE, foreground: UNAVAILABLE, route: "uia_value" }
    },
    platform: "windows"
  }
})

export function getComputerUseNativeEnvironmentPolicy(environment) {
  const policy = environmentPolicies[environment]
  if (!policy) {
    throw new Error(`Unsupported computer-use native environment: ${environment}`)
  }
  return policy
}

export function createComputerUseNativeProbeRequest(environment, requestPermission) {
  getComputerUseNativeEnvironmentPolicy(environment)
  if (typeof requestPermission !== "boolean") {
    throw new Error("Computer-use native probe permission request must be boolean.")
  }
  return Object.freeze({
    environment,
    method: "probe",
    protocolVersion: JINGLE_COMPUTER_USE_PROTOCOL_VERSION,
    requestPermission
  })
}

export function validateComputerUseNativeCapabilityMatrix(environment, value) {
  const policy = getComputerUseNativeEnvironmentPolicy(environment)
  if (
    !hasExactKeys(value, ["capabilities", "environment", "platform", "protocolVersion"]) ||
    value.environment !== environment ||
    value.platform !== policy.platform ||
    value.protocolVersion !== JINGLE_COMPUTER_USE_PROTOCOL_VERSION
  ) {
    throw new Error(
      "Computer-use native capability probe returned another environment or protocol."
    )
  }
  if (
    !isDenseArray(value.capabilities, COMPUTER_USE_NATIVE_ACTIONS.length) ||
    value.capabilities.length !== COMPUTER_USE_NATIVE_ACTIONS.length
  ) {
    throw new Error("Computer-use native capability probe returned an invalid action set.")
  }

  const capabilities = new Map()
  for (const candidate of value.capabilities) {
    if (
      !hasExactKeys(candidate, ["action", "background", "foreground", "route"]) ||
      !isComputerUseNativeAction(candidate.action)
    ) {
      throw new Error("Computer-use native capability probe returned an invalid action set.")
    }
    const action = candidate.action
    if (capabilities.has(action)) {
      throw new Error("Computer-use native capability probe returned a duplicate action.")
    }
    const expected = policy.capabilities[action]
    if (candidate.route !== expected.route) {
      throw new Error(
        `Computer-use native capability probe returned an untrusted route for ${action}.`
      )
    }
    if (
      (candidate.background === "verified" || candidate.foreground === "verified") &&
      (candidate.route === "unavailable" || candidate.route === "global_input")
    ) {
      throw new Error(
        `Computer-use native capability probe verified an unavailable route for ${action}.`
      )
    }
    if (
      !isCapabilityStatus(candidate.background) ||
      !expected.background.includes(candidate.background) ||
      !isCapabilityStatus(candidate.foreground) ||
      !expected.foreground.includes(candidate.foreground)
    ) {
      throw new Error(
        `Computer-use native capability probe returned invalid support for ${action}.`
      )
    }
    capabilities.set(
      action,
      Object.freeze({
        action,
        background: candidate.background,
        foreground: candidate.foreground,
        route: candidate.route
      })
    )
  }

  if (capabilities.size !== COMPUTER_USE_NATIVE_ACTIONS.length) {
    throw new Error("Computer-use native capability probe omitted a required action.")
  }
  return deepFreeze({
    capabilities: COMPUTER_USE_NATIVE_ACTIONS.map((action) => capabilities.get(action)),
    environment,
    platform: policy.platform,
    protocolVersion: JINGLE_COMPUTER_USE_PROTOCOL_VERSION
  })
}

function isComputerUseNativeAction(value) {
  return typeof value === "string" && COMPUTER_USE_NATIVE_ACTIONS.includes(value)
}

function isCapabilityStatus(value) {
  return value === "verified" || value === "refused" || value === "unavailable"
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function hasExactKeys(value, required) {
  if (!isRecord(value)) return false
  const allowed = new Set(required)
  const keys = Object.keys(value)
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.has(key))
}

function isDenseArray(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum) return false
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false
  }
  return true
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}
