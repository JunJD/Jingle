export function rewritePublicJingleCopy(value) {
  if (typeof value !== "string") {
    return value
  }

  return value
    .replaceAll(/raycast:\/\//g, "jingle://")
    .replaceAll(/\bRaycast\b/g, "Jingle")
    .replaceAll(/\braycast\b/g, "jingle")
}
