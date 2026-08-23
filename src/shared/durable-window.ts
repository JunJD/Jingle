import { z } from "zod/v4"

export const PRIMARY_MAIN_WINDOW_KIND = "main"
export const PRIMARY_MAIN_WINDOW_ID = "primary-main"
export const THREAD_WINDOW_KIND = "thread-window"
export const DURABLE_WINDOW_THREAD_BINDING_CHANGED_CHANNEL = "durable-window:threadBindingChanged"
export const DURABLE_WINDOW_THREAD_BINDING_GET_CHANNEL = "durable-window:getThreadBinding"

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

export const durableWindowThreadBindingSnapshotSchema = z
  .object({
    revision: z.number().int().safe().positive(),
    threadId: z
      .string()
      .min(1)
      .refine((value) => value === value.trim())
      .nullable()
  })
  .strict()

export type DurableWindowThreadBindingSnapshot = z.infer<
  typeof durableWindowThreadBindingSnapshotSchema
>

export type SetDurableWindowThreadResult = DurableWindowThreadBindingSnapshot
