import type {
  ExtensionQuicklinkRecord,
  RegisterExtensionQuicklinkInput,
  UpdateExtensionQuicklinkInput
} from "@shared/extension-quicklinks"
import { ExtensionQuicklinkRepository } from "./repository"

export class ExtensionQuicklinkService {
  constructor(private readonly repository: ExtensionQuicklinkRepository) {}

  listQuicklinks(): ExtensionQuicklinkRecord[] {
    return this.repository.list()
  }

  registerQuicklink(input: RegisterExtensionQuicklinkInput): ExtensionQuicklinkRecord {
    return this.repository.register(input)
  }

  removeQuicklink(quicklinkId: string): void {
    this.repository.remove(quicklinkId)
  }

  updateQuicklink(
    quicklinkId: string,
    input: UpdateExtensionQuicklinkInput
  ): ExtensionQuicklinkRecord {
    return this.repository.update(quicklinkId, input)
  }
}
