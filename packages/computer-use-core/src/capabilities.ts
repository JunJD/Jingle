import type { ComputerUseBackendEnvironment, ComputerUseCapabilityMatrix } from "./contract"
import { JINGLE_COMPUTER_USE_PROTOCOL_VERSION } from "./contract"

const matrices: Record<ComputerUseBackendEnvironment, ComputerUseCapabilityMatrix> = {
  "macos-quartz": {
    environment: "macos-quartz",
    platform: "macos",
    protocolVersion: JINGLE_COMPUTER_USE_PROTOCOL_VERSION,
    capabilities: [
      { action: "press", background: "unavailable", foreground: "unavailable", route: "ax_action" },
      { action: "set_value", background: "unavailable", foreground: "unavailable", route: "ax_value" },
      { action: "type_text", background: "refused", foreground: "unavailable", route: "keyboard" },
      { action: "keypress", background: "refused", foreground: "unavailable", route: "keyboard" },
      { action: "scroll", background: "refused", foreground: "unavailable", route: "ax_or_scroll_event" }
    ]
  },
  "windows-win32": {
    environment: "windows-win32",
    platform: "windows",
    protocolVersion: JINGLE_COMPUTER_USE_PROTOCOL_VERSION,
    capabilities: [
      { action: "press", background: "unavailable", foreground: "unavailable", route: "uia_invoke" },
      { action: "set_value", background: "unavailable", foreground: "unavailable", route: "uia_value" },
      { action: "type_text", background: "refused", foreground: "unavailable", route: "send_input" },
      { action: "keypress", background: "refused", foreground: "unavailable", route: "send_input" },
      { action: "scroll", background: "refused", foreground: "unavailable", route: "uia_or_send_input" }
    ]
  },
  "linux-x11": {
    environment: "linux-x11",
    platform: "linux",
    protocolVersion: JINGLE_COMPUTER_USE_PROTOCOL_VERSION,
    capabilities: [
      { action: "press", background: "unavailable", foreground: "unavailable", route: "at_spi_action" },
      { action: "set_value", background: "unavailable", foreground: "unavailable", route: "at_spi_value" },
      { action: "type_text", background: "refused", foreground: "unavailable", route: "xtest" },
      { action: "keypress", background: "refused", foreground: "unavailable", route: "xtest" },
      { action: "scroll", background: "refused", foreground: "unavailable", route: "at_spi_or_xtest" }
    ]
  },
  "linux-wayland-gnome": {
    environment: "linux-wayland-gnome",
    platform: "linux",
    protocolVersion: JINGLE_COMPUTER_USE_PROTOCOL_VERSION,
    capabilities: [
      { action: "press", background: "unavailable", foreground: "unavailable", route: "at_spi_action" },
      { action: "set_value", background: "unavailable", foreground: "unavailable", route: "at_spi_value" },
      { action: "type_text", background: "refused", foreground: "unavailable", route: "portal_libei" },
      { action: "keypress", background: "refused", foreground: "unavailable", route: "portal_libei" },
      { action: "scroll", background: "refused", foreground: "unavailable", route: "at_spi_or_portal_libei" }
    ]
  },
  "linux-wayland-kde": {
    environment: "linux-wayland-kde",
    platform: "linux",
    protocolVersion: JINGLE_COMPUTER_USE_PROTOCOL_VERSION,
    capabilities: [
      { action: "press", background: "unavailable", foreground: "unavailable", route: "at_spi_action" },
      { action: "set_value", background: "unavailable", foreground: "unavailable", route: "at_spi_value" },
      { action: "type_text", background: "refused", foreground: "unavailable", route: "portal_libei" },
      { action: "keypress", background: "refused", foreground: "unavailable", route: "portal_libei" },
      { action: "scroll", background: "refused", foreground: "unavailable", route: "portal_libei" }
    ]
  },
  "linux-wayland-other": {
    environment: "linux-wayland-other",
    platform: "linux",
    protocolVersion: JINGLE_COMPUTER_USE_PROTOCOL_VERSION,
    capabilities: [
      { action: "press", background: "unavailable", foreground: "unavailable", route: "unproven" },
      { action: "set_value", background: "unavailable", foreground: "unavailable", route: "unproven" },
      { action: "type_text", background: "refused", foreground: "unavailable", route: "unproven" },
      { action: "keypress", background: "refused", foreground: "unavailable", route: "unproven" },
      { action: "scroll", background: "refused", foreground: "unavailable", route: "unproven" }
    ]
  }
}

export function computerUseCapabilityMatrix(
  environment: ComputerUseBackendEnvironment
): ComputerUseCapabilityMatrix {
  return freeze(structuredClone(matrices[environment]))
}

function freeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  for (const nested of Object.values(value as Record<string, unknown>)) freeze(nested)
  return Object.freeze(value)
}
