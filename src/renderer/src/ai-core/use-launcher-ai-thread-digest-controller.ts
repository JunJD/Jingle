import { useCallback, useEffect, useEffectEvent, useReducer, useRef } from "react"
import type { ThreadDigestRecord } from "@shared/thread-digest"
import { getIpcErrorDisplayMessage } from "@/lib/ipc-errors"

export interface LauncherAiThreadDigestController {
  digest: ThreadDigestRecord | null
  error: string | null
  generate: () => Promise<void>
  isGenerating: boolean
}

interface ThreadDigestControllerState {
  digest: ThreadDigestRecord | null
  error: string | null
  generatingThreadId: string | null
  threadId: string | null
}

interface ThreadDigestControllerOperation {
  epoch: number
  threadId: string
}

type ThreadDigestControllerAction =
  | { type: "generation-failed"; error: string; threadId: string }
  | { type: "generation-finished"; threadId: string }
  | { type: "generation-started"; threadId: string }
  | { type: "load-failed"; error: string; threadId: string }
  | { type: "record-received"; digest: ThreadDigestRecord | null; threadId: string }

const INITIAL_THREAD_DIGEST_STATE: ThreadDigestControllerState = {
  digest: null,
  error: null,
  generatingThreadId: null,
  threadId: null
}

function getDigestError(digest: ThreadDigestRecord | null): string | null {
  return digest?.summary ? null : (digest?.projectionError ?? null)
}

function advanceThreadDigestControllerOperation(
  current: ThreadDigestControllerOperation,
  threadId: string
): ThreadDigestControllerOperation {
  return { epoch: current.epoch + 1, threadId }
}

function isThreadDigestControllerOperationCurrent(
  current: ThreadDigestControllerOperation,
  candidate: ThreadDigestControllerOperation
): boolean {
  return current.epoch === candidate.epoch && current.threadId === candidate.threadId
}

function threadDigestControllerReducer(
  state: ThreadDigestControllerState,
  action: ThreadDigestControllerAction
): ThreadDigestControllerState {
  switch (action.type) {
    case "generation-started":
      return {
        ...state,
        digest: state.threadId === action.threadId ? state.digest : null,
        error: null,
        generatingThreadId: action.threadId,
        threadId: action.threadId
      }
    case "generation-finished":
      return state.generatingThreadId === action.threadId
        ? { ...state, generatingThreadId: null }
        : state
    case "generation-failed":
      return {
        ...state,
        digest: state.threadId === action.threadId ? state.digest : null,
        error: action.error,
        generatingThreadId:
          state.generatingThreadId === action.threadId ? null : state.generatingThreadId,
        threadId: action.threadId
      }
    case "load-failed":
      if (state.threadId === action.threadId && state.digest) {
        return state
      }
      return { ...state, digest: null, error: action.error, threadId: action.threadId }
    case "record-received": {
      if (
        state.threadId === action.threadId &&
        state.digest &&
        (!action.digest || state.digest.updatedAt > action.digest.updatedAt)
      ) {
        return state
      }
      return {
        ...state,
        digest: action.digest,
        error: getDigestError(action.digest),
        threadId: action.threadId
      }
    }
  }
}

export const launcherAiThreadDigestControllerInternals = {
  advanceOperation: advanceThreadDigestControllerOperation,
  initialState: INITIAL_THREAD_DIGEST_STATE,
  isOperationCurrent: isThreadDigestControllerOperationCurrent,
  reducer: threadDigestControllerReducer
}

export function useLauncherAiThreadDigestController(input: {
  errorFallback: string
  threadId: string
}): LauncherAiThreadDigestController {
  const { errorFallback, threadId } = input
  const [state, dispatch] = useReducer(threadDigestControllerReducer, INITIAL_THREAD_DIGEST_STATE)
  const currentOperationRef = useRef<ThreadDigestControllerOperation>({ epoch: 0, threadId })
  const getLoadErrorDisplayMessage = useEffectEvent((caughtError: unknown): string => {
    return getIpcErrorDisplayMessage(caughtError, errorFallback)
  })

  useEffect(() => {
    const loadOperation = advanceThreadDigestControllerOperation(
      currentOperationRef.current,
      threadId
    )
    currentOperationRef.current = loadOperation
    let active = true
    const unsubscribe = window.api.threadDigest.onChanged(({ digest }) => {
      if (!active || digest.threadId !== threadId) {
        return
      }

      dispatch({ digest, threadId, type: "record-received" })
    })

    void window.api.threadDigest
      .get({ threadId })
      .then((record) => {
        if (
          !active ||
          !isThreadDigestControllerOperationCurrent(currentOperationRef.current, loadOperation)
        ) {
          return
        }

        dispatch({ digest: record, threadId, type: "record-received" })
      })
      .catch((caughtError: unknown) => {
        if (
          !active ||
          !isThreadDigestControllerOperationCurrent(currentOperationRef.current, loadOperation)
        ) {
          return
        }

        dispatch({
          error: getLoadErrorDisplayMessage(caughtError),
          threadId,
          type: "load-failed"
        })
      })

    return () => {
      active = false
      unsubscribe()
    }
  }, [threadId])

  const generate = useCallback(async (): Promise<void> => {
    const generationOperation = advanceThreadDigestControllerOperation(
      currentOperationRef.current,
      threadId
    )
    currentOperationRef.current = generationOperation
    dispatch({ threadId, type: "generation-started" })
    try {
      const digest = await window.api.threadDigest.generate({ threadId })
      if (
        !isThreadDigestControllerOperationCurrent(currentOperationRef.current, generationOperation)
      ) {
        return
      }
      dispatch({ digest, threadId, type: "record-received" })
    } catch (caughtError) {
      if (
        !isThreadDigestControllerOperationCurrent(currentOperationRef.current, generationOperation)
      ) {
        return
      }
      dispatch({
        error: getIpcErrorDisplayMessage(caughtError, errorFallback),
        threadId,
        type: "generation-failed"
      })
    } finally {
      if (
        isThreadDigestControllerOperationCurrent(currentOperationRef.current, generationOperation)
      ) {
        dispatch({ threadId, type: "generation-finished" })
      }
    }
  }, [errorFallback, threadId])

  return {
    digest: state.threadId === threadId ? state.digest : null,
    error: state.threadId === threadId ? state.error : null,
    generate,
    isGenerating: state.generatingThreadId === threadId
  }
}
