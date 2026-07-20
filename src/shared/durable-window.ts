import { z } from "zod/v4"

export const PRIMARY_MAIN_WINDOW_KIND = "main"
export const THREAD_WINDOW_KIND = "thread-window"
export const MAIN_WINDOW_THREAD_BINDING_CHANGED_CHANNEL = "durable-window:mainThreadBindingChanged"
export const MAIN_WINDOW_THREAD_BINDING_GET_CHANNEL = "durable-window:getMainThreadBinding"

export type DurableWindowKind = typeof PRIMARY_MAIN_WINDOW_KIND | typeof THREAD_WINDOW_KIND

export interface OpenPrimaryMainWindowParams {
  threadId?: string
}

export interface PinThreadWindowParams {
  threadId?: string
}

export type PinThreadWindowResult =
  | { ok: true; windowId: string }
  | { current: number; limit: number; ok: false; reason: "resource_limit" }

export interface SetDurableWindowThreadParams {
  threadId: string
}

export const mainWindowThreadBindingSnapshotSchema = z
  .object({
    revision: z.number().int().safe().positive(),
    threadId: z
      .string()
      .min(1)
      .refine((value) => value === value.trim())
      .nullable()
  })
  .strict()

export type MainWindowThreadBindingSnapshot = z.infer<typeof mainWindowThreadBindingSnapshotSchema>

export type SetDurableWindowThreadResult = MainWindowThreadBindingSnapshot | null

export interface DurableWindowThreadChangedEvent {
  threadId: string
}
