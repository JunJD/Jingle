import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile, readdir, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { CustomCommand } from "just-bash"

const SUPPORTED_JS_EXEC_PATCH_VERSION = "2.14.0"
const requireFromCompat = createRequire(import.meta.url)

interface JsExecCommandModule {
  jsExecCommand?: CustomCommand
  nodeStubCommand?: CustomCommand
}

interface JavaScriptRuntimeCommands {
  customCommands: CustomCommand[]
  useBuiltInRuntime: boolean
}

function commandMayUseJavaScriptRuntime(command: string): boolean {
  return /(^|[\s;&|()])(?:js-exec|node)(?=$|[\s;&|()])/.test(command)
}

function chunkFileUrl(chunksDir: string, specifier: string): string {
  return pathToFileURL(path.join(chunksDir, specifier)).href
}

async function readJustBashPackageVersion(entryPath: string): Promise<string> {
  const packageJsonPath = path.resolve(path.dirname(entryPath), "../..", "package.json")
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: unknown }
  return typeof packageJson.version === "string" ? packageJson.version : ""
}

async function loadPatchedJsExecCommands(): Promise<CustomCommand[]> {
  const justBashEntryPath = requireFromCompat.resolve("just-bash")
  const justBashVersion = await readJustBashPackageVersion(justBashEntryPath)
  if (justBashVersion !== SUPPORTED_JS_EXEC_PATCH_VERSION) {
    throw new Error(
      `Unsupported just-bash ${justBashVersion || "unknown"} js-exec patch target; expected ${SUPPORTED_JS_EXEC_PATCH_VERSION}.`
    )
  }

  const chunksDir = path.join(path.dirname(justBashEntryPath), "chunks")
  const entries = await readdir(chunksDir)
  const jsExecChunk = entries.find((entry) => /^js-exec-.*\.js$/.test(entry))
  if (!jsExecChunk) {
    return []
  }

  const sourcePath = path.join(chunksDir, jsExecChunk)
  let source = await readFile(sourcePath, "utf8")
  const workerUrl = chunkFileUrl(chunksDir, "js-exec-worker.js")

  source = source
    .replace(/from(["'])\.\/([^"']+)\1/g, (_, quote: string, specifier: string) => {
      return `from${quote}${chunkFileUrl(chunksDir, specifier)}${quote}`
    })
    .replace(/import(["'])\.\/([^"']+)\1/g, (_, quote: string, specifier: string) => {
      return `import${quote}${chunkFileUrl(chunksDir, specifier)}${quote}`
    })
    .replace(/new URL\((["'])\.\/worker\.js\1,\s*import\.meta\.url\)/g, `new URL("${workerUrl}")`)

  const sourceHash = createHash("sha1").update(source).digest("hex")
  const patchedPath = path.join(tmpdir(), `openwork-just-bash-js-exec-${sourceHash}.mjs`)
  if (!existsSync(patchedPath)) {
    await writeFile(patchedPath, source)
  }

  const module = (await import(pathToFileURL(patchedPath).href)) as JsExecCommandModule
  return [module.jsExecCommand, module.nodeStubCommand].filter(
    (command): command is CustomCommand => Boolean(command)
  )
}

export async function loadJustBashJavaScriptRuntimeCommands(
  command: string
): Promise<JavaScriptRuntimeCommands> {
  if (!commandMayUseJavaScriptRuntime(command)) {
    return {
      customCommands: [],
      useBuiltInRuntime: true
    }
  }

  const customCommands = await loadPatchedJsExecCommands()
  return {
    customCommands,
    useBuiltInRuntime: customCommands.length === 0
  }
}
