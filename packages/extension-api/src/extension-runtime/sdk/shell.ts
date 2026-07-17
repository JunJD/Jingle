import { getActiveExtensionRuntimeSdk, throwExtensionRuntimeRequestError } from "./runtime-context"

export interface RuntimeOpenApplication {
  bundleId?: string
  name?: string
  path?: string
}

function resolveDesktopUrlScheme(url: string): string | undefined {
  try {
    const protocol = new URL(url).protocol
    return protocol.endsWith(":") ? protocol.slice(0, -1).toLowerCase() : undefined
  } catch {
    return undefined
  }
}

export async function openExternal(
  url: string,
  options: { allowedUrlSchemes?: string[]; application?: RuntimeOpenApplication } = {}
): Promise<void> {
  const response = await getActiveExtensionRuntimeSdk().requestHost({
    capability: "shell",
    method: "open-external",
    payload: {
      ...(options.allowedUrlSchemes ? { allowedUrlSchemes: options.allowedUrlSchemes } : {}),
      ...(options.application ? { application: options.application } : {}),
      url
    }
  })

  if (!response.ok) {
    throwExtensionRuntimeRequestError(response.error)
  }
}

export async function open(target: string, application?: RuntimeOpenApplication): Promise<void> {
  const desktopUrlScheme = application ? resolveDesktopUrlScheme(target) : undefined
  await openExternal(target, {
    ...(application ? { application } : {}),
    ...(desktopUrlScheme ? { allowedUrlSchemes: [desktopUrlScheme] } : {})
  })
}
