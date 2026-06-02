export function rewritePublicOpenworkCopy(value) {
  if (typeof value === "string") {
    return value
      .replaceAll(/raycast:\/\//g, "openwork://")
      .replaceAll(/\bRaycast\b/g, "Openwork")
      .replaceAll(/\braycast\b/g, "openwork")
  }

  if (Array.isArray(value)) {
    return value.map((entry) => rewritePublicOpenworkCopy(entry))
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, rewritePublicOpenworkCopy(entry)])
    )
  }

  return value
}
