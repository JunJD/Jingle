import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type Dispatch,
  type MutableRefObject,
  type ReactElement,
  type SetStateAction
} from "react"
import {
  Action,
  ActionPanel,
  ExtensionRuntimeRequestError,
  List,
  LocalStorage,
  Toast,
  getConnectionSecret,
  openNativeExtensionSettings,
  showToast,
  type RuntimeToastOptions,
  type LocalStorageValue
} from "@jingle/extension-api"
import {
  createPromiseArgumentsIdentity,
  createPromiseCacheBinding,
  createPromiseCacheIdentity,
  type PromiseCacheFailure,
  type PromiseCacheValue
} from "./promise-cache"

export interface PaginationPage<TResult> {
  cursor?: string | null
  data: TResult
  hasMore?: boolean
}

export interface PaginationRequest {
  cursor?: string
  lastItem?: unknown
  page: number
}

export interface PaginatedResult<TResult> {
  data: TResult
  pagination: PaginationState | undefined
}

export type PaginationLoader<TResult> = (
  request: PaginationRequest
) => Promise<PaginationPage<TResult>> | PaginationPage<TResult>

type AnyPaginationLoader<TResult> = (
  request: any
) => Promise<PaginationPage<TResult>> | PaginationPage<TResult>

type MaybePaginatedAsyncFunction<TResult, TArgs extends readonly unknown[]> = (
  ...args: TArgs
) => Promise<TResult> | TResult | AnyPaginationLoader<TResult>

export interface PaginationState {
  hasMore: boolean
  isLoading: boolean
  onLoadMore: () => Promise<void>
}

export interface PromiseState<TResult> {
  data: TResult | undefined
  error: Error | undefined
  isLoading: boolean
  mutate: (nextValue?: TResult | Promise<TResult>) => Promise<void>
  pagination?: PaginationState
  revalidate: () => Promise<TResult | undefined>
}

export interface RefreshableDataOptions<TData> {
  emptyData: TData
  enabled?: boolean
  failureMessage: string
  load: () => Promise<TData>
}

export interface RefreshableData<TData> {
  data: TData
  error: string | null
  isLoading: boolean
  refresh: () => void
  setData: Dispatch<SetStateAction<TData>>
}

interface RefreshableDataState<TData> {
  data: TData
  error: string | null
  isLoading: boolean
}

type RefreshableDataAction<TData> =
  | { type: "disabled"; emptyData: TData }
  | { type: "failure"; emptyData: TData; error: string }
  | { type: "loading" }
  | { type: "set-data"; setData: SetStateAction<TData> }
  | { type: "success"; data: TData }

export type FailureToastOptions = Omit<RuntimeToastOptions, "style" | "title"> & {
  title?: string
}

export interface FetchResult<TResult> {
  cursor?: string | null
  data: TResult
  hasMore?: boolean
}

export type FetchRequestInfo = RequestInfo | ((request: PaginationRequest) => RequestInfo)

export interface UseFetchOptions<TRaw = unknown, TResult = TRaw> extends RequestInit {
  dependencies?: readonly unknown[]
  execute?: boolean
  failureToastOptions?: FailureToastOptions
  initialData?: TResult
  keepPreviousData?: boolean
  mapResult?: (result: TRaw) => FetchResult<TResult>
  onData?: (data: TResult) => void
  onError?: (error: Error) => void
  onWillExecute?: (args: [string, RequestInit]) => void
  parseResponse?: (response: Response) => Promise<TRaw>
}

export interface UseFetchMutateOptions<TResult> {
  optimisticUpdate?: (data: TResult | undefined) => TResult
  rollbackOnError?: boolean | ((data: TResult | undefined) => TResult)
  shouldRevalidateAfter?: boolean
}

export interface CachedPromiseMutate<TResult> {
  (): Promise<void>
  <TUpdate>(
    asyncUpdate: Promise<TUpdate>,
    options?: UseFetchMutateOptions<TResult>
  ): Promise<TUpdate>
  (asyncUpdate: undefined, options: UseFetchMutateOptions<TResult>): Promise<void>
}

export type UseFetchMutate<TResult> = CachedPromiseMutate<TResult>

export type UseFetchResult<TResult> = Omit<PromiseState<TResult>, "mutate"> & {
  mutate: UseFetchMutate<TResult>
}

export interface UsePromiseOptions<
  TResult = unknown,
  TArgs extends readonly unknown[] = readonly unknown[]
> {
  abortable?: AbortablePromiseRef
  execute?: boolean
  failureToastOptions?: FailureToastOptions
  keepPreviousData?: boolean
  initialData?: TResult
  onData?: (data: TResult, pagination?: PromisePageResult) => void
  onError?: (error: Error) => Promise<void> | void
  onWillExecute?: (args: TArgs) => void
}

type AbortablePromiseRef = {
  current: AbortController | null | undefined
}

type PromiseExecution = {
  abortable?: AbortablePromiseRef
  abortController: AbortController
  cacheToken: unknown
  generation: number
  identity: string
  tracksCacheToken: boolean
}

interface PromisePageResult {
  cursor: string | null
  hasMore: boolean
  page: number
}

interface PromiseMachineState<TResult> {
  cacheCommitToken: unknown
  cachePersisted: boolean
  cursor: string | null
  data: TResult | undefined
  error: Error | undefined
  hasData: boolean
  hasMore: boolean
  hasResolvedData: boolean
  identity: string
  isLoading: boolean
  isLoadingMore: boolean
  isPaginated: boolean
  page: number
}

interface PromiseMachineResult<TResult> extends PromiseState<TResult> {
  beginMutation: (expectedIdentity?: string) => PromiseMachineLease | null
  cachePagination: PromiseCacheValue<TResult>["pagination"]
  cacheCommitToken: unknown
  cachePersisted: boolean
  commitMutation: (
    lease: PromiseMachineLease,
    data: TResult | undefined,
    commit?: PromiseMachineMutationCommit
  ) => boolean
  hasData: boolean
  hasResolvedData: boolean
  identity: string
  isMutationCurrent: (lease: PromiseMachineLease) => boolean
  loadMore: () => Promise<void>
  page: number
}

interface PromiseMachineLease {
  generation: number
  identity: string
}

interface PromiseMachineMutationCommit {
  cache?: { persisted: boolean; token: unknown }
  pagination?: PromiseCacheValue<unknown>["pagination"]
}

interface PromiseMachineDriver<TResult> {
  commitPageZero?: (
    data: TResult,
    pagination: PromisePageResult | undefined
  ) => { persisted: boolean; token: unknown }
}

interface PromiseMachineInput<TResult, TArgs extends readonly unknown[]> {
  args: TArgs
  driver?: PromiseMachineDriver<TResult>
  fn: MaybePaginatedAsyncFunction<TResult, TArgs>
  identity: string
  options: UsePromiseOptions<TResult, TArgs>
  seed?: PromiseCacheValue<TResult>
  seedCommit?: { persisted: boolean; token: unknown }
}

interface PromiseMachineRuntimeOwner<TResult, TArgs extends readonly unknown[]> {
  activeIdentity: string
  input: PromiseMachineInput<TResult, TArgs>
  state: PromiseMachineState<TResult>
}

type AwaitedReturn<TFn extends (...args: any[]) => unknown> = Awaited<ReturnType<TFn>>
type PromiseData<TFn extends (...args: any[]) => unknown> =
  AwaitedReturn<TFn> extends AnyPaginationLoader<infer TResult> ? TResult : AwaitedReturn<TFn>
type PromiseStateData<TFn extends (...args: any[]) => unknown> = PromiseData<TFn>
type PromiseStateFor<TFn extends (...args: any[]) => unknown> =
  AwaitedReturn<TFn> extends AnyPaginationLoader<infer TResult>
    ? PromiseState<TResult> & { pagination: PaginationState | undefined }
    : PromiseState<PromiseStateData<TFn>>

type CachedPromiseStateFor<TFn extends (...args: any[]) => unknown> = Omit<
  PromiseStateFor<TFn>,
  "mutate"
> & {
  mutate: CachedPromiseMutate<PromiseStateData<TFn>>
}

export function usePromise<TResult, TArgs extends readonly unknown[]>(
  fn: MaybePaginatedAsyncFunction<TResult, TArgs>,
  args = [] as unknown as TArgs,
  options: UsePromiseOptions<TResult, TArgs> = {}
): PromiseState<TResult> {
  const identity = createTransientPromiseArgumentsIdentity(args)
  const state = usePromiseMachine(fn, args, options, identity)

  return {
    data: state.data,
    error: state.error,
    isLoading: state.isLoading,
    mutate: state.mutate,
    pagination: state.pagination,
    revalidate: state.revalidate
  }
}

export function useCachedPromise<TFn extends (...args: any[]) => unknown>(
  fn: TFn,
  args?: Parameters<TFn>,
  options?: UsePromiseOptions<PromiseData<TFn>, Parameters<TFn>>
): CachedPromiseStateFor<TFn> {
  const resolvedArgs = (args ?? []) as Parameters<TFn>
  const resolvedOptions = options ?? {}
  const {
    identity: cacheIdentity,
    key: cacheKey,
    namespace: cacheNamespace
  } = createPromiseCacheIdentity(fn, resolvedArgs)
  const cacheBinding = useMemo(
    () =>
      createPromiseCacheBinding<PromiseData<TFn>>(
        {
          identity: cacheIdentity,
          key: cacheKey,
          namespace: cacheNamespace
        },
        {
          onFailure: reportPromiseCacheFailure
        }
      ),
    [cacheIdentity, cacheKey, cacheNamespace]
  )
  const cacheSnapshot = useSyncExternalStore(
    cacheBinding.subscribe,
    cacheBinding.getSnapshot,
    cacheBinding.getSnapshot
  )
  const cacheDriver = useMemo<PromiseMachineDriver<PromiseData<TFn>>>(
    () => ({
      commitPageZero(data, pagination) {
        const persisted = cacheBinding.write({
          data,
          pagination: pagination
            ? {
                cursor: pagination.cursor,
                hasMore: pagination.hasMore,
                kind: "page-zero"
              }
            : { kind: "none" }
        })
        return {
          persisted,
          token: cacheBinding.getSnapshot()
        }
      }
    }),
    [cacheBinding]
  )
  const state = usePromiseMachine<PromiseData<TFn>, Parameters<TFn>>(
    fn as MaybePaginatedAsyncFunction<PromiseData<TFn>, Parameters<TFn>>,
    resolvedArgs,
    resolvedOptions,
    cacheIdentity,
    cacheSnapshot.kind === "value" ? cacheSnapshot.value : undefined,
    cacheDriver,
    { persisted: cacheSnapshot.kind === "value", token: cacheSnapshot }
  )
  const hasAccumulatedPages =
    state.identity === cacheIdentity && state.page > 0 && state.cacheCommitToken === cacheSnapshot
  const hasUncachedSuccess =
    state.identity === cacheIdentity &&
    state.hasResolvedData &&
    !state.cachePersisted &&
    state.cacheCommitToken === cacheSnapshot

  let returnedData: PromiseData<TFn> | undefined
  let returnedSource: "cache" | "initial" | "machine" | "previous"
  if (hasAccumulatedPages || hasUncachedSuccess) {
    returnedData = state.data
    returnedSource = "machine"
  } else if (cacheSnapshot.kind === "value") {
    returnedData = cacheSnapshot.value.data
    returnedSource = "cache"
  } else if (resolvedOptions.keepPreviousData && state.hasData) {
    returnedData = state.data
    returnedSource = "previous"
  } else {
    returnedData = resolvedOptions.initialData
    returnedSource = "initial"
  }

  const cachedPagination =
    cacheSnapshot.kind === "value" && cacheSnapshot.value.pagination.kind === "page-zero"
      ? {
          hasMore: cacheSnapshot.value.pagination.hasMore,
          isLoading:
            state.cacheCommitToken === cacheSnapshot
              ? (state.pagination?.isLoading ?? false)
              : false,
          onLoadMore: state.loadMore
        }
      : undefined
  const returnedPagination =
    returnedSource === "machine"
      ? state.pagination
      : returnedSource === "cache"
        ? cachedPagination
        : undefined
  const cacheTimelineChanged =
    state.identity === cacheIdentity && state.cacheCommitToken !== cacheSnapshot

  const mutate = useCallback<CachedPromiseMutate<PromiseData<TFn>>>(
    async <TUpdate>(
      asyncUpdate?: Promise<TUpdate>,
      mutateOptions: UseFetchMutateOptions<PromiseData<TFn>> = {}
    ): Promise<TUpdate | void> => {
      const lease = state.beginMutation(cacheIdentity)
      if (!lease) {
        return await asyncUpdate
      }
      const liveCacheSnapshot = cacheBinding.getSnapshot()
      const page =
        liveCacheSnapshot === cacheSnapshot && returnedSource === "machine" ? state.page : 0
      const previousData =
        page === 0 && liveCacheSnapshot.kind === "value"
          ? liveCacheSnapshot.value.data
          : returnedData
      let expectedCacheToken = liveCacheSnapshot
      const mutationPagination =
        page === 0 && liveCacheSnapshot.kind === "value"
          ? liveCacheSnapshot.value.pagination
          : returnedSource === "machine"
            ? state.cachePagination
            : ({ kind: "none" } as const)

      const isCurrentMutation = () =>
        state.isMutationCurrent(lease) && cacheBinding.getSnapshot() === expectedCacheToken
      const replaceMutationData = (nextData: PromiseData<TFn> | undefined) => {
        if (!isCurrentMutation()) {
          return
        }

        if (page > 0) {
          state.commitMutation(lease, nextData)
          return
        }

        const persisted = cacheBinding.write({
          data: nextData as PromiseData<TFn>,
          pagination: mutationPagination
        })
        expectedCacheToken = cacheBinding.getSnapshot()
        state.commitMutation(lease, nextData, {
          cache: {
            persisted,
            token: expectedCacheToken
          },
          pagination: mutationPagination
        })
      }

      try {
        if (mutateOptions.optimisticUpdate) {
          replaceMutationData(mutateOptions.optimisticUpdate(previousData))
        }

        return await asyncUpdate
      } catch (error) {
        if (mutateOptions.optimisticUpdate && isCurrentMutation()) {
          if (typeof mutateOptions.rollbackOnError === "function") {
            replaceMutationData(mutateOptions.rollbackOnError(previousData))
          } else if (mutateOptions.rollbackOnError !== false) {
            replaceMutationData(previousData)
          }
        }
        throw error
      } finally {
        if (mutateOptions.shouldRevalidateAfter !== false && isCurrentMutation()) {
          await state.revalidate()
        }
      }
    },
    [
      cacheBinding,
      cacheIdentity,
      cacheSnapshot,
      returnedData,
      returnedSource,
      state.beginMutation,
      state.cachePagination,
      state.commitMutation,
      state.isMutationCurrent,
      state.page,
      state.revalidate
    ]
  )

  return {
    data: returnedData,
    error: cacheTimelineChanged ? undefined : state.error,
    isLoading:
      resolvedOptions.execute === false || cacheTimelineChanged ? false : state.isLoading,
    mutate,
    pagination: returnedPagination,
    revalidate: state.revalidate
  } as CachedPromiseStateFor<TFn>
}

function usePromiseMachine<TResult, TArgs extends readonly unknown[]>(
  fn: MaybePaginatedAsyncFunction<TResult, TArgs>,
  args: TArgs,
  options: UsePromiseOptions<TResult, TArgs>,
  identity: string,
  seed?: PromiseCacheValue<TResult>,
  driver?: PromiseMachineDriver<TResult>,
  seedCommit?: { persisted: boolean; token: unknown }
): PromiseMachineResult<TResult> {
  const shouldExecute = options.execute ?? true
  const activeExecutionRef = useRef<PromiseExecution | null>(null)
  const generationRef = useRef(0)
  const mountedRef = useRef(true)
  const [state, setReactState] = useState<PromiseMachineState<TResult>>(() =>
    createInitialPromiseMachineState(identity, options, seed, seedCommit, shouldExecute)
  )
  const [runtimeOwner] = useState<PromiseMachineRuntimeOwner<TResult, TArgs>>(() => ({
    activeIdentity: identity,
    input: {
      args,
      driver,
      fn,
      identity,
      options,
      seed,
      seedCommit
    },
    state
  }))
  const commitState = useCallback(
    (update: SetStateAction<PromiseMachineState<TResult>>): void => {
      const nextState = typeof update === "function" ? update(runtimeOwner.state) : update
      runtimeOwner.state = nextState
      setReactState(nextState)
    },
    [runtimeOwner]
  )

  useLayoutEffect(() => {
    runtimeOwner.input = {
      args,
      driver,
      fn,
      identity,
      options,
      seed,
      seedCommit
    }
  })

  const invalidate = useCallback(() => {
    generationRef.current += 1
    const execution = activeExecutionRef.current
    activeExecutionRef.current = null
    if (!execution) {
      return
    }

    execution.abortController.abort()
    clearAbortController(execution)
  }, [])

  useLayoutEffect(() => {
    runtimeOwner.activeIdentity = identity
    if (!shouldExecute) {
      invalidate()
    }

    return invalidate
  }, [identity, invalidate, runtimeOwner, shouldExecute])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      invalidate()
    }
  }, [invalidate])

  const isExecutionLeaseCurrent = useCallback(
    (execution: PromiseExecution) => {
      const currentInput = runtimeOwner.input
      return (
        mountedRef.current &&
        runtimeOwner.activeIdentity === execution.identity &&
        currentInput.identity === execution.identity &&
        generationRef.current === execution.generation &&
        (!execution.tracksCacheToken || currentInput.seedCommit?.token === execution.cacheToken)
      )
    },
    [runtimeOwner]
  )

  const isCurrentExecution = useCallback(
    (execution: PromiseExecution) =>
      activeExecutionRef.current === execution && isExecutionLeaseCurrent(execution),
    [isExecutionLeaseCurrent]
  )

  const startPageZero = useCallback(
    async (input: PromiseMachineInput<TResult, TArgs>): Promise<TResult | undefined> => {
      if (
        !mountedRef.current ||
        runtimeOwner.activeIdentity !== input.identity ||
        runtimeOwner.input.identity !== input.identity
      ) {
        return undefined
      }

      const execution = beginPromiseExecution(
        input.identity,
        input.options,
        input.args,
        activeExecutionRef,
        generationRef,
        invalidate,
        input.seedCommit
      )
      const initialState = createInitialPromiseMachineState(
        input.identity,
        input.options,
        input.seed,
        input.seedCommit,
        true
      )
      commitState((current) => ({
        ...initialState,
        data:
          input.seed !== undefined
            ? input.seed.data
            : input.options.keepPreviousData
              ? current.data
              : input.options.initialData,
        hasData:
          input.seed !== undefined
            ? true
            : input.options.keepPreviousData
              ? current.hasData
              : input.options.initialData !== undefined
      }))

      try {
        const result = await resolveInitialPromiseResult(input.fn, input.args)
        if (!isCurrentExecution(execution)) {
          return result.data
        }

        const pagination = result.isPaginated
          ? {
              cursor: result.cursor,
              hasMore: result.hasMore,
              page: 0
            }
          : undefined
        const cacheCommit = input.driver?.commitPageZero?.(result.data, pagination) ?? {
          persisted: false,
          token: null
        }

        if (!isCurrentExecution(execution)) {
          return result.data
        }

        commitState({
          cacheCommitToken: cacheCommit.token,
          cachePersisted: cacheCommit.persisted,
          cursor: result.cursor,
          data: result.data,
          error: undefined,
          hasData: true,
          hasMore: result.hasMore,
          hasResolvedData: true,
          identity: input.identity,
          isLoading: false,
          isLoadingMore: false,
          isPaginated: result.isPaginated,
          page: 0
        })
        invokePromiseCallback(input.options.onData, result.data, pagination)
        return result.data
      } catch (cause) {
        if (!isCurrentExecution(execution)) {
          return undefined
        }

        if (isAbortError(cause)) {
          commitState((current) => ({ ...current, isLoading: false, isLoadingMore: false }))
          return undefined
        }

        const error = toError(cause)
        commitState((current) => ({
          ...current,
          error,
          identity: input.identity,
          isLoading: false,
          isLoadingMore: false
        }))
        handlePromiseError(error, input.options, () => {
          if (!isExecutionLeaseCurrent(execution)) {
            return Promise.resolve(undefined)
          }

          return startPageZero(runtimeOwner.input)
        })
        return undefined
      } finally {
        if (activeExecutionRef.current === execution) {
          activeExecutionRef.current = null
        }
        clearAbortController(execution)
      }
    },
    [commitState, invalidate, isCurrentExecution, isExecutionLeaseCurrent, runtimeOwner]
  )

  useEffect(() => {
    if (!shouldExecute) {
      return
    }

    let canceled = false
    const input = runtimeOwner.input
    queueMicrotask(() => {
      if (!canceled) {
        void startPageZero(input)
      }
    })

    return () => {
      canceled = true
      invalidate()
    }
  }, [identity, invalidate, runtimeOwner, shouldExecute, startPageZero])

  const revalidate = useCallback(async (): Promise<TResult | undefined> => {
    return startPageZero(runtimeOwner.input)
  }, [runtimeOwner, startPageZero])

  const loadMore = useCallback(async (): Promise<void> => {
    const input = runtimeOwner.input
    if (!mountedRef.current || runtimeOwner.activeIdentity !== input.identity) {
      return
    }

    let current = runtimeOwner.state

    if (
      input.seedCommit !== undefined &&
      (!current ||
        current.identity !== input.identity ||
        current.cacheCommitToken !== input.seedCommit.token)
    ) {
      if (input.seed === undefined) {
        return
      }

      const adoptedState = createInitialPromiseMachineState(
        input.identity,
        input.options,
        input.seed,
        input.seedCommit,
        false
      )
      commitState(adoptedState)
      current = adoptedState
    }

    if (
      input.options.execute === false ||
      !current ||
      current.identity !== input.identity ||
      !current.isPaginated ||
      !current.hasMore ||
      current.isLoadingMore
    ) {
      return
    }

    const basePage = current.page
    const execution = beginPromiseExecution(
      input.identity,
      input.options,
      input.args,
      activeExecutionRef,
      generationRef,
      invalidate,
      input.seedCommit
    )
    commitState((candidate) =>
      candidate.identity === input.identity && candidate.page === basePage
        ? { ...candidate, error: undefined, isLoading: false, isLoadingMore: true }
        : candidate
    )

    try {
      const result = await resolveNextPageResult(
        input.fn,
        input.args,
        current.cursor,
        current.page,
        current.data
      )
      if (!isCurrentExecution(execution)) {
        return
      }

      const nextData = mergePaginatedData(current.data, result.data)
      const nextPage = basePage + 1
      commitState((candidate) =>
        candidate.identity === input.identity && candidate.page === basePage
          ? {
              ...candidate,
              cursor: result.cursor,
              data: nextData,
              error: undefined,
              hasData: true,
              hasMore: result.hasMore,
              hasResolvedData: true,
              isLoading: false,
              isLoadingMore: false,
              isPaginated: true,
              page: nextPage
            }
          : candidate
      )
      invokePromiseCallback(input.options.onData, nextData, {
        cursor: result.cursor,
        hasMore: result.hasMore,
        page: nextPage
      })
    } catch (cause) {
      if (!isCurrentExecution(execution)) {
        return
      }

      if (isAbortError(cause)) {
        commitState((currentState) => ({
          ...currentState,
          isLoading: false,
          isLoadingMore: false
        }))
        return
      }

      const error = toError(cause)
      commitState((currentState) => ({
        ...currentState,
        error,
        isLoading: false,
        isLoadingMore: false
      }))
      handlePromiseError(error, input.options, () => {
        if (!isExecutionLeaseCurrent(execution)) {
          return Promise.resolve(undefined)
        }

        return loadMore()
      })
    } finally {
      if (activeExecutionRef.current === execution) {
        activeExecutionRef.current = null
      }
      clearAbortController(execution)
    }
  }, [commitState, invalidate, isCurrentExecution, isExecutionLeaseCurrent, runtimeOwner])

  const beginMutation = useCallback(
    (expectedIdentity?: string): PromiseMachineLease | null => {
      if (
        !mountedRef.current ||
        (expectedIdentity !== undefined && runtimeOwner.activeIdentity !== expectedIdentity)
      ) {
        return null
      }

      invalidate()
      const lease = {
        generation: generationRef.current,
        identity: runtimeOwner.activeIdentity
      }
      commitState((current) =>
        current.identity === lease.identity
          ? { ...current, isLoading: false, isLoadingMore: false }
          : current
      )
      return lease
    },
    [commitState, invalidate, runtimeOwner]
  )

  const isMutationCurrent = useCallback(
    (lease: PromiseMachineLease): boolean => {
      return (
        mountedRef.current &&
        runtimeOwner.activeIdentity === lease.identity &&
        generationRef.current === lease.generation
      )
    },
    [runtimeOwner]
  )

  const commitMutation = useCallback(
    (
      lease: PromiseMachineLease,
      data: TResult | undefined,
      commit: PromiseMachineMutationCommit = {}
    ): boolean => {
      if (!isMutationCurrent(lease)) {
        return false
      }

      commitState((current) => {
        const pagination = commit.pagination
        return {
          ...current,
          cacheCommitToken: commit.cache ? commit.cache.token : current.cacheCommitToken,
          cachePersisted: commit.cache ? commit.cache.persisted : current.cachePersisted,
          cursor:
            pagination === undefined
              ? current.cursor
              : pagination.kind === "page-zero"
                ? pagination.cursor
                : null,
          data,
          error: undefined,
          hasData: true,
          hasMore:
            pagination === undefined
              ? current.hasMore
              : pagination.kind === "page-zero"
                ? pagination.hasMore
                : false,
          hasResolvedData: true,
          identity: lease.identity,
          isLoading: false,
          isLoadingMore: false,
          isPaginated:
            pagination !== undefined ? pagination.kind === "page-zero" : current.isPaginated,
          page: pagination !== undefined ? 0 : current.page
        }
      })
      return true
    },
    [commitState, isMutationCurrent]
  )

  const mutate = useCallback(
    async (nextValue?: TResult | Promise<TResult>): Promise<void> => {
      if (nextValue === undefined) {
        await revalidate()
        return
      }

      const lease = beginMutation()
      if (!lease) {
        return
      }
      const data = await nextValue
      if (
        commitMutation(lease, data, {
          cache: { persisted: false, token: null },
          pagination: { kind: "none" }
        })
      ) {
        invokePromiseCallback(runtimeOwner.input.options.onData, data)
      }
    },
    [beginMutation, commitMutation, revalidate, runtimeOwner]
  )

  const stateMatchesIdentity = state.identity === identity
  const projectedData = stateMatchesIdentity
    ? state.data
    : options.keepPreviousData
      ? state.data
      : options.initialData
  const projectedHasData = stateMatchesIdentity
    ? state.hasData
    : options.keepPreviousData
      ? state.hasData
      : options.initialData !== undefined
  const projectedPagination =
    stateMatchesIdentity && state.isPaginated
      ? {
          hasMore: state.hasMore,
          isLoading: state.isLoadingMore,
          onLoadMore: loadMore
        }
      : undefined

  return {
    beginMutation,
    cacheCommitToken: stateMatchesIdentity ? state.cacheCommitToken : null,
    cachePagination:
      stateMatchesIdentity && state.isPaginated
        ? {
            cursor: state.cursor,
            hasMore: state.hasMore,
            kind: "page-zero"
          }
        : { kind: "none" },
    cachePersisted: stateMatchesIdentity && state.cachePersisted,
    commitMutation,
    data: projectedData,
    error: stateMatchesIdentity ? state.error : undefined,
    hasData: projectedHasData,
    hasResolvedData: stateMatchesIdentity && state.hasResolvedData,
    identity: state.identity,
    isMutationCurrent,
    isLoading: shouldExecute ? (stateMatchesIdentity ? state.isLoading : true) : false,
    loadMore,
    mutate,
    page: stateMatchesIdentity ? state.page : 0,
    pagination: projectedPagination,
    revalidate
  }
}

function refreshableDataReducer<TData>(
  state: RefreshableDataState<TData>,
  action: RefreshableDataAction<TData>
): RefreshableDataState<TData> {
  switch (action.type) {
    case "disabled":
      return { data: action.emptyData, error: null, isLoading: false }
    case "failure":
      return { data: action.emptyData, error: action.error, isLoading: false }
    case "loading":
      return { ...state, error: null, isLoading: true }
    case "set-data":
      return {
        ...state,
        data:
          typeof action.setData === "function"
            ? (action.setData as (currentData: TData) => TData)(state.data)
            : action.setData
      }
    case "success":
      return { data: action.data, error: null, isLoading: false }
  }
}

export function useRefreshableData<TData>(
  options: RefreshableDataOptions<TData>
): RefreshableData<TData> {
  const { emptyData, enabled = true, failureMessage, load } = options
  const [state, dispatch] = useReducer(refreshableDataReducer<TData>, {
    data: emptyData,
    error: null,
    isLoading: false
  })
  const { data, error, isLoading } = state
  const mountedRef = useRef(true)
  const requestIdRef = useRef(0)

  useEffect(
    () => () => {
      mountedRef.current = false
      requestIdRef.current += 1
    },
    []
  )

  const refresh = useCallback(() => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    if (!enabled) {
      dispatch({ type: "disabled", emptyData })
      return
    }

    dispatch({ type: "loading" })

    void load()
      .then((nextData) => {
        if (!mountedRef.current || requestIdRef.current !== requestId) {
          return
        }

        dispatch({ type: "success", data: nextData })
      })
      .catch((nextError) => {
        if (!mountedRef.current || requestIdRef.current !== requestId) {
          return
        }

        dispatch({
          type: "failure",
          emptyData,
          error: nextError instanceof Error ? nextError.message : failureMessage
        })
      })
  }, [emptyData, enabled, failureMessage, load])

  useEffect(() => {
    const timeoutId = globalThis.setTimeout(refresh, 0)

    return () => {
      globalThis.clearTimeout(timeoutId)
    }
  }, [emptyData, enabled, failureMessage, load, refresh])

  return {
    data,
    error,
    isLoading,
    refresh,
    setData: (setData) => dispatch({ type: "set-data", setData })
  }
}

export function useFetch<TRaw = unknown, TResult = TRaw>(
  url: (request: PaginationRequest) => RequestInfo,
  options: UseFetchOptions<TRaw, TResult> & { dependencies: readonly unknown[] }
): UseFetchResult<TResult>
export function useFetch<TRaw = unknown, TResult = TRaw>(
  url: RequestInfo,
  options?: UseFetchOptions<TRaw, TResult>
): UseFetchResult<TResult>
export function useFetch<TRaw = unknown, TResult = TRaw>(
  url: FetchRequestInfo,
  options: UseFetchOptions<TRaw, TResult> = {}
): UseFetchResult<TResult> {
  const {
    dependencies = [],
    execute,
    failureToastOptions,
    initialData,
    keepPreviousData,
    mapResult,
    onData,
    onError,
    onWillExecute,
    parseResponse,
    ...requestInit
  } = options
  const pageZeroRequestInfo = typeof url === "function" ? undefined : url
  const cacheIdentity = createPromiseArgumentsIdentity([
    pageZeroRequestInfo === undefined ? undefined : getFetchRequestIdentity(pageZeroRequestInfo),
    getFetchRequestInitIdentity(requestInit),
    typeof url === "function" ? url : undefined,
    mapResult,
    parseResponse,
    dependencies
  ])
  const abortable = useRef<AbortController | null>(null)
  const fetcher = (_cacheIdentity: string) => {
    if (typeof url === "function") {
      return async (request: PaginationRequest): Promise<PaginationPage<TResult>> => {
        const requestInfo = url(request)
        const result = await fetchAndMapResult(requestInfo, requestInit, {
          abortable,
          mapResult,
          onWillExecute,
          parseResponse
        })

        return {
          cursor: result.cursor,
          data: result.data,
          hasMore: result.hasMore
        }
      }
    }

    return fetchAndMapResult(url, requestInit, {
      abortable,
      mapResult,
      onWillExecute,
      parseResponse
    }).then((result) => result.data)
  }
  // The shared machine detects the pagination loader at runtime; useFetch still exposes TResult.
  const cachedFetcher = fetcher as (_cacheIdentity: string) => Promise<unknown>
  const state = useCachedPromise(cachedFetcher, [cacheIdentity], {
    abortable,
    execute,
    failureToastOptions,
    initialData,
    keepPreviousData,
    onData: onData as ((data: unknown) => void) | undefined,
    onError
  }) as unknown as UseFetchResult<TResult>

  return state
}

export async function showFailureToast(
  error: unknown,
  options: FailureToastOptions = {}
): Promise<void> {
  await showToast({
    ...options,
    message: options.message ?? getFailureToastMessage(error),
    style: Toast.Style.Failure,
    title: options.title ?? "Something went wrong"
  })
}

async function resolveInitialPromiseResult<TResult, TArgs extends readonly unknown[]>(
  fn: MaybePaginatedAsyncFunction<TResult, TArgs>,
  args: TArgs
): Promise<{
  cursor: string | null
  data: TResult
  hasMore: boolean
  isPaginated: boolean
}> {
  const result = await fn(...args)
  if (!isPaginationLoader<TResult>(result)) {
    return {
      cursor: null,
      data: result,
      hasMore: false,
      isPaginated: false
    }
  }

  const page = await result({ page: 0 })
  return {
    cursor: page.cursor ?? null,
    data: page.data,
    hasMore: page.hasMore === true,
    isPaginated: true
  }
}

async function resolveNextPageResult<TResult, TArgs extends readonly unknown[]>(
  fn: MaybePaginatedAsyncFunction<TResult, TArgs>,
  args: TArgs,
  cursor: string | null,
  page: number,
  currentData: TResult | undefined
): Promise<{
  cursor: string | null
  data: TResult
  hasMore: boolean
}> {
  const result = await fn(...args)
  if (!isPaginationLoader<TResult>(result)) {
    return {
      cursor: null,
      data: result,
      hasMore: false
    }
  }

  const pageResult = await result({
    cursor: cursor ?? undefined,
    lastItem: getLastPaginatedItem(currentData),
    page: page + 1
  })
  return {
    cursor: pageResult.cursor ?? null,
    data: pageResult.data,
    hasMore: pageResult.hasMore === true
  }
}

function createInitialPromiseMachineState<TResult, TArgs extends readonly unknown[]>(
  identity: string,
  options: UsePromiseOptions<TResult, TArgs>,
  seed: PromiseCacheValue<TResult> | undefined,
  seedCommit: { persisted: boolean; token: unknown } | undefined,
  isLoading: boolean
): PromiseMachineState<TResult> {
  const pagination = seed?.pagination
  const isPaginated = pagination?.kind === "page-zero"
  return {
    cacheCommitToken: seedCommit?.token ?? null,
    cachePersisted: seedCommit?.persisted ?? false,
    cursor: isPaginated ? pagination.cursor : null,
    data: seed !== undefined ? seed.data : options.initialData,
    error: undefined,
    hasData: seed !== undefined || options.initialData !== undefined,
    hasMore: isPaginated ? pagination.hasMore : false,
    hasResolvedData: false,
    identity,
    isLoading,
    isLoadingMore: false,
    isPaginated,
    page: 0
  }
}

function createTransientPromiseArgumentsIdentity(args: readonly unknown[]): string {
  return JSON.stringify(args) ?? "transient:undefined"
}

function beginPromiseExecution<TResult, TArgs extends readonly unknown[]>(
  identity: string,
  options: UsePromiseOptions<TResult, TArgs>,
  args: TArgs,
  activeExecutionRef: MutableRefObject<PromiseExecution | null>,
  generationRef: MutableRefObject<number>,
  invalidate: () => void,
  seedCommit: { persisted: boolean; token: unknown } | undefined
): PromiseExecution {
  invalidate()
  options.abortable?.current?.abort()
  const abortController = new AbortController()
  if (options.abortable) {
    options.abortable.current = abortController
  }

  invokePromiseLifecycleCallback(options.onWillExecute, args)
  const execution: PromiseExecution = {
    abortable: options.abortable,
    abortController,
    cacheToken: seedCommit?.token,
    generation: generationRef.current,
    identity,
    tracksCacheToken: seedCommit !== undefined
  }
  activeExecutionRef.current = execution
  return execution
}

function clearAbortController(execution: PromiseExecution): void {
  if (execution.abortable?.current === execution.abortController) {
    execution.abortable.current = null
  }
}

function handlePromiseError<TResult, TArgs extends readonly unknown[]>(
  error: Error,
  options: UsePromiseOptions<TResult, TArgs>,
  retry: () => Promise<unknown>
): void {
  if (options.onError) {
    invokePromiseLifecycleCallback(options.onError, error)
    return
  }

  console.error("[jingle:extension-utils] Promise execution failed", error)
  void showFailureToast(error, {
    primaryAction: {
      onAction: () => {
        void retry()
      },
      title: "Retry"
    },
    title: "Failed to fetch latest data",
    ...options.failureToastOptions
  }).catch((toastError) => {
    console.error("[jingle:extension-utils] Failure toast could not be shown", toastError)
  })
}

function reportPromiseCacheFailure(failure: PromiseCacheFailure): void {
  console.error(`[jingle:extension-utils] ${failure.code}`, failure.cause)
  void showFailureToast(failure, {
    message: failure.message,
    title: "Latest data could not be cached"
  }).catch((toastError) => {
    console.error("[jingle:extension-utils] Cache failure toast could not be shown", toastError)
  })
}

function invokePromiseCallback<TResult>(
  callback: ((data: TResult, pagination?: PromisePageResult) => void) | undefined,
  data: TResult,
  pagination?: PromisePageResult
): void {
  invokePromiseLifecycleCallback(callback, data, pagination)
}

function invokePromiseLifecycleCallback(
  callback: ((...args: any[]) => unknown) | undefined,
  ...args: unknown[]
): void {
  if (!callback) {
    return
  }

  try {
    const result = callback(...args)
    if (result instanceof Promise) {
      void result.catch((error) => {
        console.error("[jingle:extension-utils] Promise lifecycle callback failed", error)
      })
    }
  } catch (error) {
    console.error("[jingle:extension-utils] Promise lifecycle callback failed", error)
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  )
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function getFailureToastMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  return undefined
}

async function fetchAndMapResult<TRaw, TResult>(
  requestInfo: RequestInfo,
  requestInit: RequestInit,
  options: {
    abortable: MutableRefObject<AbortController | null>
    mapResult: UseFetchOptions<TRaw, TResult>["mapResult"] | undefined
    onWillExecute: UseFetchOptions<TRaw, TResult>["onWillExecute"] | undefined
    parseResponse: UseFetchOptions<TRaw, TResult>["parseResponse"] | undefined
  }
): Promise<FetchResult<TResult>> {
  const nextRequestInit = {
    ...requestInit,
    signal: requestInit.signal ?? options.abortable.current?.signal
  }
  invokePromiseLifecycleCallback(options.onWillExecute, [
    getRequestInfoKey(requestInfo),
    nextRequestInit
  ])
  const response = await fetch(requestInfo, nextRequestInit)
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  const parsedResult = options.parseResponse
    ? await options.parseResponse(response)
    : await parseFetchResponse<TRaw>(response)

  return options.mapResult
    ? options.mapResult(parsedResult)
    : {
        data: parsedResult as unknown as TResult
      }
}

async function parseFetchResponse<TResult>(response: Response): Promise<TResult> {
  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("json")) {
    return (await response.json()) as TResult
  }

  return (await response.text()) as TResult
}

function getRequestInfoKey(requestInfo: RequestInfo): string {
  if (typeof requestInfo === "string") {
    return requestInfo
  }

  if (requestInfo instanceof Request) {
    return requestInfo.url
  }

  return String(requestInfo)
}

function getFetchRequestIdentity(requestInfo: RequestInfo): unknown {
  if (typeof requestInfo === "string") {
    return { kind: "url", url: requestInfo }
  }

  if (requestInfo.body !== null) {
    throw new TypeError(
      "useFetch cannot create a durable cache identity for a Request object with a body"
    )
  }

  return {
    cache: requestInfo.cache,
    credentials: requestInfo.credentials,
    headers: normalizeFetchHeaders(requestInfo.headers),
    integrity: requestInfo.integrity,
    keepalive: requestInfo.keepalive,
    kind: "request",
    method: requestInfo.method,
    mode: requestInfo.mode,
    redirect: requestInfo.redirect,
    referrer: requestInfo.referrer,
    referrerPolicy: requestInfo.referrerPolicy,
    url: requestInfo.url
  }
}

function getFetchRequestInitIdentity(requestInit: RequestInit): unknown {
  const { headers, signal: _signal, ...identity } = requestInit
  return {
    ...identity,
    body: normalizeFetchBodyForIdentity(requestInit.body),
    headers: normalizeFetchHeaders(headers)
  }
}

function normalizeFetchHeaders(headers: HeadersInit | undefined): readonly (readonly string[])[] {
  if (!headers) {
    return []
  }

  return Array.from(new Headers(headers).entries())
}

function normalizeFetchBodyForIdentity(body: BodyInit | null | undefined): unknown {
  if (body === undefined || body === null || typeof body === "string") {
    return body
  }

  if (body instanceof URLSearchParams) {
    return { kind: "url-search-params", value: body.toString() }
  }

  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return body
  }

  throw new TypeError(
    `useFetch cannot create a durable cache identity for ${body.constructor.name || "this body type"}`
  )
}

function isPaginationLoader<TResult>(
  value: unknown
): value is (
  request: PaginationRequest
) => Promise<PaginationPage<TResult>> | PaginationPage<TResult> {
  return typeof value === "function"
}

function mergePaginatedData<TResult>(current: TResult | undefined, nextPage: TResult): TResult {
  if (Array.isArray(current) && Array.isArray(nextPage)) {
    return [...current, ...nextPage] as TResult
  }

  if (hasResultsArray(current) && hasResultsArray(nextPage)) {
    return {
      ...nextPage,
      results: [...current.results, ...nextPage.results]
    } as TResult
  }

  return nextPage
}

function getLastPaginatedItem(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.at(-1)
  }

  if (hasResultsArray(data)) {
    return data.results.at(-1)
  }

  return undefined
}

function hasResultsArray(value: unknown): value is { results: unknown[] } {
  return (
    value !== null &&
    typeof value === "object" &&
    Array.isArray((value as { results?: unknown }).results)
  )
}

export type FormValues = object

export type FormValidationRule<TValue, TValues extends FormValues> = (
  value: TValue,
  values: TValues
) => string | undefined

export type FormValidationRules<TValues extends FormValues> = {
  [K in keyof TValues]?: FormValidationRule<TValues[K], TValues>
}

export const FormValidation = {
  Required<TValue, TValues extends FormValues>(
    value: TValue,
    _values: TValues
  ): string | undefined {
    if (value === null || value === undefined || value === "") {
      return "Required"
    }

    if (Array.isArray(value) && value.length === 0) {
      return "Required"
    }

    return undefined
  }
}

export interface UseFormOptions<TValues extends FormValues = Record<string, unknown>> {
  initialValues?: Partial<TValues>
  onSubmit?: (values: TValues) => Promise<void> | void
  validation?: FormValidationRules<TValues>
}

export interface UseFormResult<TValues extends FormValues = Record<string, unknown>> {
  errors: Partial<Record<keyof TValues, string>>
  focus: (key: keyof TValues) => void
  handleSubmit: (nextValues?: Partial<TValues>) => Promise<void>
  itemProps: UseFormItemProps<TValues>
  reset: (nextValues?: Partial<TValues>) => void
  setValue: <TKey extends keyof TValues>(key: TKey, value: TValues[TKey]) => void
  setValues: Dispatch<SetStateAction<TValues>>
  values: TValues
}

export type UseFormItemProp<TValue = unknown> = {
  error: string | undefined
  id: string
  onChange: Dispatch<SetStateAction<TValue>>
  value: TValue
}

// focus() 是一次性命令，不应该改写作者声明的 autoFocus props。
// 这个字段只给 runtime snapshot 识别重复 focus 请求，不作为公开 itemProps 契约。
type InternalUseFormItemProp<TValue = unknown> = UseFormItemProp<TValue> & {
  focusRequestId?: number
}

export type UseFormItemProps<TValues extends FormValues> = (<TKey extends keyof TValues>(
  key: TKey
) => UseFormItemProp<NoInfer<TValues[TKey]>>) & {
  [K in keyof TValues]: UseFormItemProp<NoInfer<TValues[K]>>
} & {
  [key: string]: UseFormItemProp
}

export function useForm<TValues extends FormValues = Record<string, unknown>>(
  options: UseFormOptions<TValues>
): UseFormResult<TValues> {
  const initialValues = useMemo(() => (options.initialValues ?? {}) as TValues, [options.initialValues])
  const [values, setValues] = useState<TValues>(initialValues)
  const [errors, setErrors] = useState<Partial<Record<keyof TValues, string>>>({})
  const [focusState, setFocusState] = useState<{
    key: keyof TValues
    requestId: number
  } | null>(null)

  const validate = useCallback(
    (nextValues: TValues): Partial<Record<keyof TValues, string>> => {
      const nextErrors: Partial<Record<keyof TValues, string>> = {}

      for (const key of Object.keys(options.validation ?? {}) as Array<keyof TValues>) {
        const rule = options.validation?.[key]
        const message = rule?.(nextValues[key], nextValues)
        if (message) {
          nextErrors[key] = message
        }
      }

      return nextErrors
    },
    [options.validation]
  )

  const setValue = useCallback(<TKey extends keyof TValues>(key: TKey, value: TValues[TKey]) => {
    setValues((currentValues) => ({
      ...currentValues,
      [key]: value
    }))
  }, [])

  const createItemProp = useCallback(
    <TKey extends keyof TValues>(key: TKey): InternalUseFormItemProp<TValues[TKey]> => ({
      error: errors[key],
      focusRequestId: focusState?.key === key ? focusState.requestId : undefined,
      id: String(key),
      onChange: (value: SetStateAction<TValues[TKey]>) => {
        setValues((currentValues) => {
          const nextValue =
            typeof value === "function"
              ? (value as (currentValue: TValues[TKey]) => TValues[TKey])(currentValues[key])
              : value

          return {
            ...currentValues,
            [key]: nextValue
          }
        })
      },
      value: values[key]
    }),
    [errors, focusState, values]
  )

  const itemProps = useMemo(() => {
    const itemPropsForKey = (<TKey extends keyof TValues>(key: TKey) =>
      createItemProp(key)) as UseFormItemProps<TValues>
    const itemPropsRecord = itemPropsForKey as unknown as Record<
      keyof TValues,
      InternalUseFormItemProp
    >

    for (const key of Object.keys(values) as Array<keyof TValues>) {
      itemPropsRecord[key] = createItemProp(key) as InternalUseFormItemProp
    }

    return new Proxy(itemPropsForKey, {
      get(target, property, receiver) {
        if (typeof property === "string" && !(property in target)) {
          return createItemProp(property as keyof TValues)
        }

        return Reflect.get(target, property, receiver)
      }
    }) as UseFormItemProps<TValues>
  }, [createItemProp, values])

  const reset = useCallback(
    (nextValues?: Partial<TValues>) => {
      setValues({
        ...initialValues,
        ...nextValues
      } as TValues)
      setErrors({})
    },
    [initialValues]
  )

  const focus = useCallback((key: keyof TValues) => {
    setFocusState((currentState) => ({
      key,
      requestId: (currentState?.requestId ?? 0) + 1
    }))
  }, [])

  const handleSubmit = useCallback(
    async (nextValues?: Partial<TValues>) => {
      const submittedValues = nextValues ? ({ ...values, ...nextValues } as TValues) : values
      const nextErrors = validate(submittedValues)
      setErrors(nextErrors)

      if (Object.keys(nextErrors).length > 0) {
        return
      }

      await options.onSubmit?.(submittedValues)
    },
    [options, validate, values]
  )

  return useMemo(
    () => ({
      errors,
      focus,
      handleSubmit,
      itemProps,
      reset,
      setValue,
      setValues,
      values
    }),
    [errors, focus, handleSubmit, itemProps, reset, setValue, values]
  )
}

export interface WithAccessTokenService {
  authorize?: () => Promise<string>
  getAccessToken?: () => Promise<string>
  onAuthorize?: (tokenSet: { token: string }) => Promise<void> | void
  personalAccessToken?: string
}

export interface OAuthServiceOptions extends WithAccessTokenService {
  authorizeUrl?: string
  client?: unknown
  clientId?: string
  extraParameters?: Record<string, string>
  scope?: string
  tokenUrl?: string
}

export class OAuthService implements WithAccessTokenService {
  readonly authorizeUrl?: string
  readonly client?: unknown
  readonly clientId?: string
  readonly extraParameters?: Record<string, string>
  readonly onAuthorize?: OAuthServiceOptions["onAuthorize"]
  readonly personalAccessToken?: string
  readonly scope?: string
  readonly tokenUrl?: string

  constructor(options: OAuthServiceOptions) {
    this.authorizeUrl = options.authorizeUrl
    this.client = options.client
    this.clientId = options.clientId
    this.extraParameters = options.extraParameters
    this.onAuthorize = options.onAuthorize
    this.personalAccessToken = options.personalAccessToken
    this.scope = options.scope
    this.tokenUrl = options.tokenUrl
  }

  async authorize(): Promise<string> {
    return this.getAccessToken()
  }

  async getAccessToken(): Promise<string> {
    const token = resolveJingleAccessToken(this)
    if (!token) {
      throw new Error("Missing accessToken preference for this extension.")
    }

    await this.onAuthorize?.({ token })
    return token
  }
}

export type WithAccessTokenWrapped<TFunction extends (...args: never[]) => unknown> = (
  ...args: Parameters<TFunction>
) => ReturnType<TFunction>

const COMPONENT_NAME_PATTERN = /^[A-Z]/

export function withAccessToken(service: WithAccessTokenService) {
  return function wrapWithAccessToken<TFunction extends (...args: never[]) => unknown>(
    fn: TFunction
  ): WithAccessTokenWrapped<TFunction> {
    if (isReactComponentLike(fn)) {
      const Component = fn as unknown as ComponentType<Record<string, unknown>>
      const WrappedComponent = ((props: Record<string, unknown>): ReactElement => {
        const token = resolveJingleAccessToken(service, {
          includeServiceToken: false
        })
        if (!token) {
          return createElement(ConnectExtensionEmptyView)
        }

        void service.onAuthorize?.({ token })
        return createElement(Component, props)
      }) as unknown as TFunction

      return WrappedComponent as WithAccessTokenWrapped<TFunction>
    }

    return ((...args: Parameters<TFunction>): ReturnType<TFunction> => {
      const token = resolveJingleAccessToken(service)
      if (!token) {
        throw new Error("Missing accessToken preference for this extension.")
      }

      void service.onAuthorize?.({ token })
      return fn(...args) as ReturnType<TFunction>
    }) as WithAccessTokenWrapped<TFunction>
  }
}

export async function getAccessToken(service: WithAccessTokenService): Promise<string> {
  if (service.getAccessToken) {
    return service.getAccessToken()
  }

  const token = resolveJingleAccessToken(service)
  if (!token) {
    throw new Error("Missing accessToken preference for this extension.")
  }

  await service.onAuthorize?.({ token })
  return token
}

function ConnectExtensionEmptyView(): ReactElement {
  return createElement(
    List,
    { navigationTitle: "Connection Required" },
    createElement(List.EmptyView, {
      actions: createElement(
        ActionPanel,
        null,
        createElement(Action, {
          onAction: () => {
            void openNativeExtensionSettings({})
          },
          title: "Open Extension Settings"
        })
      ),
      description: "Connect this extension in Settings before using this command.",
      title: "Connection Required"
    })
  )
}

function isReactComponentLike(value: unknown): boolean {
  if (typeof value !== "function") {
    return false
  }

  const name = readReactComponentName(value as { displayName?: string; name?: string })
  return COMPONENT_NAME_PATTERN.test(name)
}

function readReactComponentName(component: { displayName?: string; name?: string }): string {
  if (component.displayName !== undefined) {
    return component.displayName
  }

  if (component.name !== undefined) {
    return component.name
  }

  return ""
}

function resolveJingleAccessToken(
  service: WithAccessTokenService,
  options: { includeServiceToken?: boolean } = {}
): string {
  const accessToken = getConnectionSecret("accessToken")
  if (accessToken) {
    return accessToken
  }

  if (options.includeServiceToken === false) {
    return ""
  }

  if (service.personalAccessToken === undefined) {
    return ""
  }

  return String(service.personalAccessToken).trim()
}

export type LocalStorageStateValue = Exclude<LocalStorageValue, null>

export interface UseLocalStorageResult<TValue extends LocalStorageStateValue> {
  isLoading: boolean
  removeValue: () => Promise<void>
  setValue: (nextValue: SetStateAction<TValue>) => Promise<void>
  value: TValue | undefined
}

export function useLocalStorage<TValue extends LocalStorageStateValue>(
  key: string,
  initialValue?: TValue
): UseLocalStorageResult<TValue> {
  const [fatalError, setFatalError] = useState<Error | null>(null)
  const [value, setLocalValue] = useState<TValue | undefined>(initialValue)
  const [isLoading, setIsLoading] = useState(true)
  const valueRef = useRef<TValue | undefined>(initialValue)
  const initialValueRef = useRef<TValue | undefined>(initialValue)

  if (fatalError) {
    throw fatalError
  }

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    let cancelled = false

    async function loadValue() {
      setIsLoading(true)
      let storedValue: TValue | undefined
      try {
        storedValue = await LocalStorage.getItem<TValue>(key)
      } catch (cause) {
        if (
          cause instanceof ExtensionRuntimeRequestError &&
          cause.code === "storage_legacy_unowned"
        ) {
          if (!cancelled) {
            valueRef.current = initialValueRef.current
            setLocalValue(initialValueRef.current)
            setIsLoading(false)
          }
          return
        }
        if (!cancelled) {
          setFatalError(cause instanceof Error ? cause : new Error(String(cause)))
        }
        return
      }
      if (cancelled) {
        return
      }

      const nextValue = storedValue === undefined ? initialValueRef.current : storedValue
      valueRef.current = nextValue
      setLocalValue(nextValue)
      setIsLoading(false)
    }

    void loadValue()

    return () => {
      cancelled = true
    }
  }, [key])

  const setValue = useCallback(
    async (nextValue: SetStateAction<TValue>) => {
      const resolvedValue =
        typeof nextValue === "function"
          ? (nextValue as (currentValue: TValue | undefined) => TValue)(valueRef.current)
          : nextValue

      valueRef.current = resolvedValue
      setLocalValue(resolvedValue)
      await LocalStorage.setItem(key, resolvedValue)
    },
    [key]
  )

  const removeValue = useCallback(async () => {
    valueRef.current = initialValueRef.current
    setLocalValue(initialValueRef.current)
    await LocalStorage.removeItem(key)
  }, [key])

  return {
    isLoading,
    removeValue,
    setValue,
    value
  }
}
