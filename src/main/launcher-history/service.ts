import type {
  LauncherHistoryItem,
  RecordLauncherHistoryItemInput
} from "@shared/launcher-history"
import { LauncherHistoryRepository } from "./repository"

export class LauncherHistoryService {
  constructor(private readonly repository: LauncherHistoryRepository) {}

  listItems(): Promise<LauncherHistoryItem[]> {
    return this.repository.list()
  }

  recordItem(input: RecordLauncherHistoryItemInput): LauncherHistoryItem {
    return this.repository.record(input)
  }

  removeItem(itemId: string): void {
    this.repository.remove(itemId)
  }

  setItemPinned(itemId: string, pin: boolean): LauncherHistoryItem {
    return this.repository.setPinned(itemId, pin)
  }
}
