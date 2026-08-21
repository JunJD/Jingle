export const MAX_NATIVE_EXTENSION_IDENTIFIER_LENGTH = 256

export function assertNativeExtensionIdentifier(value, message) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_NATIVE_EXTENSION_IDENTIFIER_LENGTH
  ) {
    throw new Error(message)
  }
}
