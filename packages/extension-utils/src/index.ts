import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
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

export type UseFetchMutate<TResult> = (
  asyncUpdate?: Promise<unknown>,
  options?: UseFetchMutateOptions<TResult>
) => Promise<unknown>

export type UseFetchResult<TResult> = Omit<PromiseState<TResult>, "mutate"> & {
  mutate: UseFetchMutate<TResult>
}

export interface UsePromiseOptions<
  TResult = unknown,
  TArgs extends readonly unknown[] = readonly unknown[]
> {
  abortable?: AbortablePromiseRef
  execute?: boolean
  keepPreviousData?: boolean
  initialData?: TResult
  onData?: (data: TResult) => void
  onError?: (error: Error) => void
  onWillExecute?: (args: TArgs) => void
}

type AbortablePromiseRef = {
  current: AbortController | null | undefined
}

type PromiseExecution = {
  abortable?: AbortablePromiseRef
  abortController: AbortController
}

type AwaitedReturn<TFn extends (...args: any[]) => unknown> = Awaited<ReturnType<TFn>>
type PromiseData<TFn extends (...args: any[]) => unknown> =
  AwaitedReturn<TFn> extends AnyPaginationLoader<infer TResult> ? TResult : AwaitedReturn<TFn>
type PromiseStateData<TFn extends (...args: any[]) => unknown> =
  PromiseData<TFn> extends PaginatedResult<infer TResult> ? TResult : PromiseData<TFn>
type PromiseStateFor<TFn extends (...args: any[]) => unknown> =
  AwaitedReturn<TFn> extends AnyPaginationLoader<infer TResult>
    ? PromiseState<TResult> & { pagination: PaginationState | undefined }
    : PromiseState<PromiseStateData<TFn>>

export function usePromise<TResult, TArgs extends readonly unknown[]>(
  fn: MaybePaginatedAsyncFunction<TResult, TArgs>,
  args = [] as unknown as TArgs,
  options: UsePromiseOptions<TResult, TArgs> = {}
): PromiseState<TResult> {
  const shouldExecute = options.execute ?? true
  const argsKey = JSON.stringify(args)
  const initialResult = options.initialData
  const fnRef = useRef(fn)
  const argsRef = useRef(args)
  const optionsRef = useRef(options)
  const requestIdRef = useRef(0)
  const [state, setState] = useState<{
    cursor: string | null
    data: TResult | undefined
    error: Error | undefined
    hasMore: boolean
    isLoadingMore: boolean
    isPaginated: boolean
    isLoading: boolean
    page: number
  }>({
    cursor: null,
    data: initialResult,
    error: undefined,
    hasMore: false,
    isLoadingMore: false,
    isPaginated: false,
    isLoading: shouldExecute,
    page: 0
  })

  useEffect(() => {
    fnRef.current = fn
    argsRef.current = args
    optionsRef.current = options
  }, [args, fn, options])

  const run = useCallback(async (): Promise<TResult | undefined> => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const execution = beginPromiseExecution(optionsRef.current, argsRef.current)
    setState((current) => ({
      ...current,
      data: optionsRef.current.keepPreviousData ? current.data : optionsRef.current.initialData,
      error: undefined,
      isLoading: true,
      isLoadingMore: false
    }))

    try {
      const result = await resolveInitialPromiseResult(fnRef.current, argsRef.current)
      if (requestIdRef.current === requestId) {
        setState({
          cursor: result.cursor,
          data: result.data,
          error: undefined,
          hasMore: result.hasMore,
          isLoading: false,
          isLoadingMore: false,
          isPaginated: result.isPaginated,
          page: 0
        })
        optionsRef.current.onData?.(result.data)
      }
      return result.data
    } catch (cause) {
      const nextError = cause instanceof Error ? cause : new Error(String(cause))
      if (requestIdRef.current === requestId) {
        setState((current) => ({
          ...current,
          error: nextError,
          isLoading: false
        }))
        optionsRef.current.onError?.(nextError)
      }
      return undefined
    } finally {
      clearAbortController(execution)
    }
  }, [])

  useEffect(() => {
    if (!shouldExecute) {
      return
    }

    void Promise.resolve().then(() => run())
  }, [argsKey, run, shouldExecute])

  const loadMore = useCallback(async (): Promise<void> => {
    if (!state.isPaginated || !state.hasMore || state.isLoadingMore) {
      return
    }

    setState((current) => ({
      ...current,
      error: undefined,
      isLoadingMore: true
    }))

    const execution = beginPromiseExecution(optionsRef.current, argsRef.current)
    try {
      const result = await resolveNextPageResult(
        fnRef.current,
        argsRef.current,
        state.cursor,
        state.page,
        state.data
      )
      const nextData = mergePaginatedData(state.data, result.data)
      setState((current) => ({
        ...current,
        cursor: result.cursor,
        data: nextData,
        error: undefined,
        hasMore: result.hasMore,
        isLoading: false,
        isLoadingMore: false,
        isPaginated: true,
        page: current.page + 1
      }))
      optionsRef.current.onData?.(nextData)
    } catch (cause) {
      const nextError = cause instanceof Error ? cause : new Error(String(cause))
      setState((current) => ({
        ...current,
        error: nextError,
        isLoadingMore: false
      }))
      optionsRef.current.onError?.(nextError)
    } finally {
      clearAbortController(execution)
    }
  }, [state.cursor, state.data, state.hasMore, state.isLoadingMore, state.isPaginated, state.page])

  const mutate = useCallback(
    async (nextValue?: TResult | Promise<TResult>): Promise<void> => {
      if (nextValue === undefined) {
        await run()
        return
      }

      const resolvedValue = await nextValue
      setState((current) => ({
        ...current,
        cursor: null,
        data: resolvedValue,
        error: undefined,
        hasMore: false,
        isLoading: false,
        isLoadingMore: false,
        isPaginated: false,
        page: 0
      }))
      optionsRef.current.onData?.(resolvedValue)
    },
    [run]
  )

  return {
    data: state.data,
    error: state.error,
    isLoading: state.isLoading,
    mutate,
    pagination: state.isPaginated
      ? {
          hasMore: state.hasMore,
          isLoading: state.isLoadingMore,
          onLoadMore: loadMore
        }
      : undefined,
    revalidate: run
  }
}

export function useCachedPromise<TFn extends (...args: any[]) => unknown>(
  fn: TFn,
  args?: Parameters<TFn>,
  options?: UsePromiseOptions<PromiseData<TFn>, Parameters<TFn>>
): PromiseStateFor<TFn> {
  const resolvedArgs = (args ?? []) as Parameters<TFn>

  const state = usePromise<PromiseData<TFn>, Parameters<TFn>>(
    fn as MaybePaginatedAsyncFunction<PromiseData<TFn>, Parameters<TFn>>,
    resolvedArgs,
    options
  )

  if (isPaginatedResult(state.data)) {
    return {
      ...state,
      data: state.data.data,
      pagination: state.data.pagination
    } as PromiseStateFor<TFn>
  }

  return state as PromiseStateFor<TFn>
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
  const optionsRef = useRef({ emptyData, enabled, failureMessage, load })
  const requestIdRef = useRef(0)

  optionsRef.current = { emptyData, enabled, failureMessage, load }

  useEffect(
    () => () => {
      mountedRef.current = false
      requestIdRef.current += 1
    },
    []
  )

  const refresh = useCallback(() => {
    const {
      emptyData: currentEmptyData,
      enabled: currentEnabled,
      failureMessage: currentFailureMessage,
      load: currentLoad
    } = optionsRef.current
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    if (!currentEnabled) {
      dispatch({ type: "disabled", emptyData: currentEmptyData })
      return
    }

    dispatch({ type: "loading" })

    void currentLoad()
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
          emptyData: currentEmptyData,
          error: nextError instanceof Error ? nextError.message : currentFailureMessage
        })
      })
  }, [])

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
  url: FetchRequestInfo,
  options: UseFetchOptions<TRaw, TResult> = {}
): UseFetchResult<TResult> {
  const {
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
  const requestKey = getFetchRequestKey(url, requestInit)
  const requestInitKey = stableStringifyRequestInit(requestInit)
  const abortable = useRef<AbortController | null>(null)
  const fetcher = useCallback(
    (_requestKey: string, _requestInitKey: string) => {
      if (typeof url === "function") {
        return async (request: PaginationRequest): Promise<PaginationPage<TResult>> => {
          const result = await fetchAndMapResult(url(request), requestInit, {
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
    },
    [mapResult, onWillExecute, parseResponse, requestInit, url]
  )
  const handleError = useCallback(
    (error: Error) => {
      if (onError) {
        onError(error)
        return
      }

      void showFailureToast(error, failureToastOptions)
    },
    [failureToastOptions, onError]
  )
  const state = usePromise<TResult, [string, string]>(fetcher, [requestKey, requestInitKey], {
    abortable,
    execute,
    initialData,
    keepPreviousData,
    onData,
    onError: handleError
  })
  const mutate = useCallback<UseFetchMutate<TResult>>(
    async (asyncUpdate, mutateOptions = {}) => {
      if (!asyncUpdate) {
        return state.revalidate()
      }

      const previousData = state.data
      if (mutateOptions.optimisticUpdate) {
        await state.mutate(mutateOptions.optimisticUpdate(previousData))
      }

      try {
        const result = await asyncUpdate
        if (mutateOptions.shouldRevalidateAfter !== false) {
          await state.revalidate()
        }
        return result
      } catch (error) {
        if (mutateOptions.optimisticUpdate && mutateOptions.rollbackOnError !== false) {
          const rollbackData =
            typeof mutateOptions.rollbackOnError === "function"
              ? mutateOptions.rollbackOnError(previousData)
              : previousData
          if (rollbackData !== undefined) {
            await state.mutate(rollbackData)
          }
        }
        throw error
      }
    },
    [state]
  )

  return {
    data: state.data,
    error: state.error,
    isLoading: state.isLoading,
    mutate,
    pagination: state.pagination,
    revalidate: state.revalidate
  }
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

function beginPromiseExecution<TResult, TArgs extends readonly unknown[]>(
  options: UsePromiseOptions<TResult, TArgs>,
  args: TArgs
): PromiseExecution {
  options.abortable?.current?.abort()
  const abortController = new AbortController()
  if (options.abortable) {
    options.abortable.current = abortController
  }
  options.onWillExecute?.(args)
  return {
    abortable: options.abortable,
    abortController
  }
}

function clearAbortController(execution: PromiseExecution): void {
  if (execution.abortable?.current === execution.abortController) {
    execution.abortable.current = null
  }
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
  options.onWillExecute?.([getRequestInfoKey(requestInfo), nextRequestInit])
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

function getFetchRequestKey(url: FetchRequestInfo, requestInit: RequestInit): string {
  const requestInfoKey = typeof url === "function" ? String(url) : getRequestInfoKey(url)
  return `${requestInfoKey}:${stableStringifyRequestInit(requestInit)}`
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

function stableStringifyRequestInit(requestInit: RequestInit): string {
  return JSON.stringify(
    {
      ...requestInit,
      headers: normalizeFetchHeaders(requestInit.headers)
    },
    (_key, value) => (typeof value === "function" ? String(value) : value)
  )
}

function normalizeFetchHeaders(headers: HeadersInit | undefined): unknown {
  if (!headers) {
    return undefined
  }

  if (headers instanceof Headers) {
    return Array.from(headers.entries())
  }

  return headers
}

function isPaginationLoader<TResult>(
  value: unknown
): value is (
  request: PaginationRequest
) => Promise<PaginationPage<TResult>> | PaginationPage<TResult> {
  return typeof value === "function"
}

function isPaginatedResult<TResult>(value: unknown): value is PaginatedResult<TResult> {
  return value !== null && typeof value === "object" && "data" in value && "pagination" in value
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
