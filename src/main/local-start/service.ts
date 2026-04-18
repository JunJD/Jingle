import type { CreateLocalStartItemInput, LocalStartItem } from "../../shared/local-start"
import { LocalStartRepository } from "./repository"

export class LocalStartService {
  constructor(private readonly repository: LocalStartRepository) {}

  listItems(): LocalStartItem[] {
    return this.repository.list()
  }

  getItem(itemId: string): LocalStartItem | null {
    return this.repository.getById(itemId)
  }

  upsertItem(input: CreateLocalStartItemInput): LocalStartItem {
    return this.repository.upsert(input)
  }

  removeItem(itemId: string): void {
    this.repository.remove(itemId)
  }

  recordItemUse(itemId: string): LocalStartItem {
    return this.repository.recordUse(itemId)
  }
}
