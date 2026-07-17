declare module "proper-lockfile" {
  export interface LockOptions {
    onCompromised?: (error: Error) => void
    realpath?: boolean
    retries?:
      | number
      | {
          factor?: number
          maxTimeout?: number
          minTimeout?: number
          randomize?: boolean
          retries?: number
        }
    stale?: number
    update?: number
  }

  export function lock(filePath: string, options?: LockOptions): Promise<() => Promise<void>>
}
