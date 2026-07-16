import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { shell } from "electron"
import type { ClipboardContext } from "@shared/clipboard"
import {
  createLauncherHistoryKey,
  type RecordLauncherHistoryItemInput
} from "@shared/launcher-history"
import {
  createLauncherSelectionContext,
  type LauncherSelectionCapturePayload,
  type LauncherSelectionContextSnapshot
} from "@shared/launcher-selection"
import type {
  LauncherActionExecutor,
  LauncherOpenPathTarget,
  LauncherSearchAction,
  LauncherSearchRequest,
  LauncherSearchResponse
} from "@shared/launcher-search"
import type { LauncherHistoryService } from "../launcher-history/service"
import type { LocalStartService } from "../local-start/service"
import { readClipboardContext } from "../services/clipboard"
import { searchLauncher } from "../services/launcher-search"
import {
  getApplicationDisplayName,
  getApplicationIconDataUrl
} from "../services/launcher-search/providers/applications"
import { getLauncherOpenPathHistoryTitle } from "./history-title"

const EMPTY_CLIPBOARD_CONTEXT: ClipboardContext = { kind: "none" }

export interface LauncherRuntime {
  openPinnedSessionWindow: (threadId: string) => void
}

async function openLauncherPath(
  path: string,
  kind: "application" | "file" | "directory"
): Promise<void> {
  if (process.env.JINGLE_BDD === "1") {
    return
  }

  if (kind === "application" && process.platform === "darwin") {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("/usr/bin/open", [path], {
        detached: true,
        stdio: "ignore"
      })

      child.once("error", reject)
      child.once("spawn", () => resolve())
      child.unref()
    })
    return
  }

  const openPathError = await shell.openPath(path)
  if (openPathError) {
    throw new Error(openPathError)
  }
}

async function openLauncherUrl(url: string): Promise<void> {
  await shell.openExternal(url)
}

function getLauncherPathHistoryKey(target: LauncherOpenPathTarget): string {
  if (target.kind === "application") {
    return createLauncherHistoryKey({
      path: target.path,
      type: "application"
    })
  }

  if (target.kind === "file") {
    return createLauncherHistoryKey({
      path: target.path,
      type: "file"
    })
  }

  return createLauncherHistoryKey({
    path: target.path,
    type: "directory"
  })
}

async function buildLauncherHistoryRecord(
  action: LauncherSearchAction,
  localStartService: LocalStartService
): Promise<RecordLauncherHistoryItemInput | null> {
  switch (action.type) {
    case "open-path":
      if (!action.localStartItemId) {
        return {
          action,
          historyKey: getLauncherPathHistoryKey(action.target),
          iconDataUrl:
            action.target.kind === "application"
              ? await getApplicationIconDataUrl(action.target.path)
              : undefined,
          kind: action.target.kind,
          subtitle: action.target.path,
          title: await getLauncherOpenPathHistoryTitle(action.target, getApplicationDisplayName)
        }
      }

      {
        const item = localStartService.getItem(action.localStartItemId)
        const itemKind = item?.kind ?? action.target.kind
        const itemPath = item?.path ?? action.target.path
        const title =
          item?.title ??
          (await getLauncherOpenPathHistoryTitle(
            {
              kind: action.target.kind,
              path: action.target.path
            },
            getApplicationDisplayName
          ))

        return {
          action,
          historyKey: createLauncherHistoryKey({
            itemId: action.localStartItemId,
            type: "local-start"
          }),
          iconDataUrl:
            itemKind === "application" ? await getApplicationIconDataUrl(itemPath) : undefined,
          kind: itemKind,
          subtitle: itemPath,
          title
        }
      }
    case "open-url":
    case "open-history-thread":
    case "open-extension-command":
    case "none":
      return null
    default: {
      const exhaustiveAction: never = action
      throw new Error(`Unsupported launcher history action: ${JSON.stringify(exhaustiveAction)}`)
    }
  }
}

type LauncherActionExecutorHandler = (action: LauncherSearchAction) => Promise<void>
type InternalLauncherActionExecutorHandler = (
  action: LauncherSearchAction,
  runtime: LauncherRuntime
) => Promise<void>

const internalLauncherActionExecutor: InternalLauncherActionExecutorHandler = async (
  action,
  runtime
) => {
  switch (action.type) {
    case "none":
      return
    case "open-history-thread":
      runtime.openPinnedSessionWindow(action.target.threadId)
      return
    case "open-extension-command":
      return
    default: {
      throw new Error(`Unsupported internal launcher action: ${JSON.stringify(action)}`)
    }
  }
}

const launcherActionExecutors: Record<
  Exclude<LauncherActionExecutor, "internal">,
  LauncherActionExecutorHandler
> = {
  shell: async (action) => {
    switch (action.type) {
      case "open-path":
        await openLauncherPath(action.target.path, action.target.kind)
        return
      case "open-url":
        await openLauncherUrl(action.target.url)
        return
      default:
        throw new Error(`Unsupported shell launcher action: ${JSON.stringify(action)}`)
    }
  }
}

async function applyLauncherActionSideEffects(
  action: LauncherSearchAction,
  launcherHistoryService: LauncherHistoryService,
  localStartService: LocalStartService
): Promise<void> {
  switch (action.type) {
    case "open-path": {
      if (action.localStartItemId) {
        localStartService.recordItemUse(action.localStartItemId)
      }

      const historyRecord = await buildLauncherHistoryRecord(action, localStartService)
      if (historyRecord) {
        launcherHistoryService.recordItem(historyRecord)
      }
      return
    }
    case "open-url":
    case "open-history-thread":
    case "open-extension-command":
    case "none":
      return
    default: {
      const exhaustiveAction: never = action
      throw new Error(
        `Unsupported launcher side effects action: ${JSON.stringify(exhaustiveAction)}`
      )
    }
  }
}

export class LauncherService {
  private selectionContext: LauncherSelectionContextSnapshot = null

  constructor(
    private readonly launcherHistoryService: LauncherHistoryService,
    private readonly localStartService: LocalStartService,
    private readonly runtime: LauncherRuntime
  ) {}

  getClipboardContext(): ClipboardContext {
    if (process.env.JINGLE_BDD === "1") {
      return EMPTY_CLIPBOARD_CONTEXT
    }

    return readClipboardContext()
  }

  getSelectionContext(): LauncherSelectionContextSnapshot {
    return this.selectionContext
  }

  setSelectionContext(payload: LauncherSelectionCapturePayload): LauncherSelectionContextSnapshot {
    this.selectionContext = createLauncherSelectionContext({
      ...payload,
      capturedAt: new Date().toISOString(),
      id: `selection:${randomUUID()}`
    })
    return this.selectionContext
  }

  clearSelectionContext(id?: string): void {
    if (id && this.selectionContext?.id !== id) {
      return
    }

    this.selectionContext = null
  }

  search(request: LauncherSearchRequest): Promise<LauncherSearchResponse> {
    return searchLauncher(request)
  }

  async executeAction(action: LauncherSearchAction): Promise<void> {
    if (action.executor === "internal") {
      await internalLauncherActionExecutor(action, this.runtime)
    } else {
      await launcherActionExecutors[action.executor](action)
    }
    await applyLauncherActionSideEffects(
      action,
      this.launcherHistoryService,
      this.localStartService
    )
  }
}
