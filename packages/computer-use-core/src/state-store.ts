import { randomUUID } from "node:crypto"
import type { ComputerUseObservation } from "./contract"

export class ComputerUseObservationStore {
  private readonly records = new Map<string, ComputerUseObservation>()

  constructor(private readonly limit = 128) {}

  create(input: Omit<ComputerUseObservation, "stateId">): ComputerUseObservation {
    const refs = new Set<string>()
    for (const element of input.elements) {
      if (!element.ref || refs.has(element.ref)) {
        throw new Error("Computer-use observation contains an empty or duplicate semantic ref.")
      }
      refs.add(element.ref)
    }
    const observation = deepFreeze({ ...structuredClone(input), stateId: randomUUID() })
    this.records.set(observation.stateId, observation)
    while (this.records.size > this.limit) {
      const oldest = this.records.keys().next().value as string | undefined
      if (!oldest) break
      this.records.delete(oldest)
    }
    return observation
  }

  get(stateId: string): ComputerUseObservation | undefined {
    return this.records.get(stateId)
  }

  clear(): void {
    this.records.clear()
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  return Object.freeze(value)
}
