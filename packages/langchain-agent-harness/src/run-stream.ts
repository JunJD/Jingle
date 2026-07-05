export interface DrainRuntimeRunStreamInput<TChunk> {
  onChunk: (chunk: TChunk) => Promise<boolean> | boolean
  signal: AbortSignal
  stream: AsyncIterable<TChunk>
}

export interface DrainRuntimeRunStreamResult {
  interrupted: boolean
}

export async function drainRuntimeRunStream<TChunk>(
  input: DrainRuntimeRunStreamInput<TChunk>
): Promise<DrainRuntimeRunStreamResult> {
  let interrupted = false

  for await (const chunk of input.stream) {
    if (input.signal.aborted) {
      break
    }

    interrupted = interrupted || (await input.onChunk(chunk))
  }

  return { interrupted }
}
