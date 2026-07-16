import { existsSync } from "node:fs"
import { sep } from "node:path"

interface AppleRemindersNativeBinaryCandidates {
  appPath: string
  compiledPath: string
  cwdPath: string
}

interface ResolveAppleRemindersNativeBinaryPathInput {
  candidates: AppleRemindersNativeBinaryCandidates
  exists?: (path: string) => boolean
  isPackaged: boolean
}

function resolvePackagedUnpackedPath(candidatePath: string): string {
  const asarSegment = `${sep}app.asar${sep}`
  const asarIndex = candidatePath.lastIndexOf(asarSegment)
  if (asarIndex < 0) {
    return candidatePath
  }

  return `${candidatePath.slice(0, asarIndex)}${sep}app.asar.unpacked${sep}${candidatePath.slice(asarIndex + asarSegment.length)}`
}

export function resolveAppleRemindersNativeBinaryPath(
  input: ResolveAppleRemindersNativeBinaryPathInput
): string | null {
  const { candidates, isPackaged } = input
  const exists = input.exists ?? existsSync
  const trustedCandidates = isPackaged
    ? [candidates.appPath, candidates.compiledPath].map(resolvePackagedUnpackedPath)
    : [candidates.appPath, candidates.cwdPath, candidates.compiledPath]

  return trustedCandidates.find((candidate) => exists(candidate)) ?? null
}
