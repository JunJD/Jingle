import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  type Stats
} from "node:fs"
import { lstat, mkdir, open, realpath, type FileHandle } from "node:fs/promises"
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path"

const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0

function isMissingError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  )
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  )
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return (
    path === "" ||
    (!isAbsolute(path) &&
      path !== ".." &&
      !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`))
  )
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function assertPrivateDirectorySync(path: string): string {
  const absolutePath = resolve(path)
  let fd: number
  try {
    fd = openSync(absolutePath, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | NO_FOLLOW)
  } catch {
    throw new Error("Diagnostics directory is not a private regular directory.")
  }
  try {
    const opened = fstatSync(fd)
    const after = lstatSync(absolutePath)
    if (
      !opened.isDirectory() ||
      after.isSymbolicLink() ||
      !after.isDirectory() ||
      !sameFile(opened, after)
    ) {
      throw new Error("Diagnostics directory is not a private regular directory.")
    }
    fchmodSync(fd, PRIVATE_DIRECTORY_MODE)
    return realpathSync(absolutePath)
  } finally {
    closeSync(fd)
  }
}

export function ensurePrivateDirectorySync(path: string): string {
  const absolutePath = resolve(path)
  mkdirSync(absolutePath, { mode: PRIVATE_DIRECTORY_MODE, recursive: true })
  return assertPrivateDirectorySync(absolutePath)
}

export function ensurePrivateDescendantDirectorySync(root: string, path: string): string {
  const lexicalRoot = resolve(root)
  const lexicalPath = resolve(path)
  const descendant = relative(lexicalRoot, lexicalPath)
  if (
    descendant === "" ||
    isAbsolute(descendant) ||
    descendant === ".." ||
    descendant.startsWith(`..${sep}`)
  ) {
    throw new Error("Diagnostics directory must be a child of its private root.")
  }
  let current = ensurePrivateDirectorySync(lexicalRoot)
  for (const segment of descendant.split(sep)) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error("Invalid diagnostics directory segment.")
    }
    const next = resolve(current, segment)
    try {
      mkdirSync(next, { mode: PRIVATE_DIRECTORY_MODE })
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) {
        throw new Error("Diagnostics directory could not be created safely.")
      }
    }
    current = assertPrivateDirectorySync(next)
  }
  return current
}

export async function assertPrivateDirectory(path: string): Promise<string> {
  const absolutePath = resolve(path)
  let handle: FileHandle
  try {
    handle = await open(absolutePath, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | NO_FOLLOW)
  } catch {
    throw new Error("Diagnostics directory is not a private regular directory.")
  }
  try {
    const opened = await handle.stat()
    const after = await lstat(absolutePath)
    if (
      !opened.isDirectory() ||
      after.isSymbolicLink() ||
      !after.isDirectory() ||
      !sameFile(opened, after)
    ) {
      throw new Error("Diagnostics directory is not a private regular directory.")
    }
    await handle.chmod(PRIVATE_DIRECTORY_MODE)
    return realpath(absolutePath)
  } finally {
    await handle.close()
  }
}

export async function ensurePrivateChildDirectory(
  root: string,
  ...segments: string[]
): Promise<string> {
  const rootPath = await assertPrivateDirectory(root)
  let current = rootPath
  for (const segment of segments) {
    if (!/^[a-z0-9][a-z0-9.-]*$/i.test(segment) || segment === "." || segment === "..") {
      throw new Error("Invalid diagnostics directory segment.")
    }
    const next = resolve(current, segment)
    if (!isWithin(rootPath, next)) {
      throw new Error("Diagnostics directory escaped its private root.")
    }
    try {
      await mkdir(next, { mode: PRIVATE_DIRECTORY_MODE })
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        (error as { code?: unknown }).code !== "EEXIST"
      ) {
        throw new Error("Diagnostics directory could not be created safely.")
      }
    }
    const resolvedNext = await assertPrivateDirectory(next)
    if (!isWithin(rootPath, resolvedNext)) {
      throw new Error("Diagnostics directory escaped its private root.")
    }
    current = resolvedNext
  }
  return current
}

export function assertPrivateRegularFileSync(path: string): Stats | null {
  let fd: number | undefined
  try {
    fd = openSync(path, constants.O_RDONLY | NO_FOLLOW)
    const opened = fstatSync(fd)
    const after = lstatSync(path)
    if (!opened.isFile() || after.isSymbolicLink() || !after.isFile() || !sameFile(opened, after)) {
      throw new Error("Diagnostics file is not a private regular file.")
    }
    fchmodSync(fd, PRIVATE_FILE_MODE)
    return opened
  } catch (error) {
    if (isMissingError(error)) {
      return null
    }
    throw new Error("Diagnostics file is not a private regular file.")
  } finally {
    if (fd !== undefined) {
      closeSync(fd)
    }
  }
}

async function openPrivateRegularFile(
  path: string,
  flags: number,
  create: boolean
): Promise<FileHandle> {
  const parent = await assertPrivateDirectory(dirname(path))
  const absolutePath = resolve(parent, basename(path))
  if (!isWithin(parent, absolutePath)) {
    throw new Error("Diagnostics file escaped its private directory.")
  }
  let handle: FileHandle
  try {
    handle = await open(absolutePath, flags | NO_FOLLOW, PRIVATE_FILE_MODE)
  } catch (error) {
    if (hasErrorCode(error, "ENOENT") || hasErrorCode(error, "EEXIST")) {
      throw error
    }
    throw new Error("Diagnostics file is not a private regular file.")
  }
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) {
      throw new Error("Diagnostics file is not a private regular file.")
    }
    if (create || (stat.mode & 0o777) !== PRIVATE_FILE_MODE) {
      await handle.chmod(PRIVATE_FILE_MODE)
    }
    const after = await lstat(absolutePath)
    const resolvedFile = await realpath(absolutePath)
    if (
      after.isSymbolicLink() ||
      !after.isFile() ||
      !sameFile(stat, after) ||
      !isWithin(parent, resolvedFile)
    ) {
      throw new Error("Diagnostics file changed while it was being opened.")
    }
    return handle
  } catch (error) {
    await handle.close()
    throw error
  }
}

export function openPrivateFileForAppend(path: string): Promise<FileHandle> {
  return openPrivateRegularFile(
    path,
    constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY,
    true
  )
}

export function openPrivateFileForExclusiveWrite(path: string): Promise<FileHandle> {
  return openPrivateRegularFile(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    true
  )
}

export function openPrivateFileForRead(path: string): Promise<FileHandle> {
  return openPrivateRegularFile(path, constants.O_RDONLY, false)
}
