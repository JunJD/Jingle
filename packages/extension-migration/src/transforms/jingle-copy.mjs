export function rewritePublicJingleCopy(value) {
  if (typeof value === "string") {
    return value
      .replaceAll(/raycast:\/\//g, "jingle://")
      .replaceAll(/\bRaycast\b/g, "Jingle")
      .replaceAll(/\braycast\b/g, "jingle")
  }

  if (Array.isArray(value)) {
    return value.map((entry) => rewritePublicJingleCopy(entry))
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, rewritePublicJingleCopy(entry)])
    )
  }

  return value
}
