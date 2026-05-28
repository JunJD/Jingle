import type {
  ExtensionQuicklinkRecord,
  RegisterExtensionQuicklinkInput
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
}
