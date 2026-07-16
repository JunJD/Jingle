import {
  createContentCardId,
  contentCardIdentitySchema,
  type ContentCardIdentity,
  type ContentCardKind
} from "@shared/content-card"
import type { AssistantContentPart } from "@shared/assistant-content-part"

export interface ContentCardProjection<TPayload = unknown> {
  identity: ContentCardIdentity
  payload: TPayload
}

export interface ContentCardRendererAdapter<TPayload = unknown> {
  kind: ContentCardKind
  project(source: unknown): ContentCardProjection<TPayload> | null
}

export class ContentCardProjectionRegistry {
  private readonly adapters = new Map<ContentCardKind, ContentCardRendererAdapter>()

  register(adapter: ContentCardRendererAdapter): () => void {
    if (this.adapters.has(adapter.kind)) {
      throw new Error(`[ContentCard] Renderer adapter already registered for ${adapter.kind}.`)
    }
    this.adapters.set(adapter.kind, adapter)
    return () => this.adapters.delete(adapter.kind)
  }

  get(kind: ContentCardKind): ContentCardRendererAdapter | null {
    return this.adapters.get(kind) ?? null
  }

  project(kind: ContentCardKind, source: unknown): ContentCardProjection | null {
    const projection = this.adapters.get(kind)?.project(source) ?? null
    if (!projection) return null
    const identity = contentCardIdentitySchema.parse(projection.identity)
    if (identity.kind !== kind) {
      throw new Error(`[ContentCard] ${kind} adapter returned ${identity.kind}.`)
    }
    return projection
  }
}

export interface AssistantContentPartCardSource {
  kind: "code" | "diff" | "mermaid" | "narrative" | "table"
  messageId: string
  partId: string
  revision: string
  payload: AssistantContentPart["payload"]
  threadId: string
}

function isAssistantPartSource(value: unknown): value is AssistantContentPartCardSource {
  if (!value || typeof value !== "object") return false
  const source = value as Partial<AssistantContentPartCardSource>
  return Boolean(
    source.kind &&
    source.messageId &&
    source.partId &&
    source.revision &&
    source.payload &&
    source.threadId
  )
}

export const contentCardProjectionRegistry = new ContentCardProjectionRegistry()
for (const kind of ["narrative", "code", "diff", "table", "mermaid"] as const) {
  contentCardProjectionRegistry.register({
    kind,
    project(source) {
      if (!isAssistantPartSource(source) || source.kind !== kind) return null
      const identitySource = {
        kind,
        slot: `part:${source.partId}`,
        sourceId: source.messageId,
        sourceType: "message" as const
      }
      return {
        identity: {
          ...identitySource,
          cardId: createContentCardId(identitySource),
          revision: source.revision,
          threadId: source.threadId
        },
        payload: source
      }
    }
  })
}

export function projectAssistantContentPartCard(
  source: AssistantContentPartCardSource
): ContentCardProjection<AssistantContentPartCardSource> {
  const projection = contentCardProjectionRegistry.project(source.kind, source)
  if (!projection) throw new Error(`[ContentCard] ${source.kind} source is invalid.`)
  return projection as ContentCardProjection<AssistantContentPartCardSource>
}

export function projectNarrativeContentCardIdentity(source: {
  blockId: string
  messageId: string
  revision: string
  text: string
  threadId: string
}): ContentCardIdentity {
  const projection = projectAssistantContentPartCard({
    kind: "narrative",
    messageId: source.messageId,
    partId: source.blockId,
    payload: { markdown: source.text },
    revision: source.revision,
    threadId: source.threadId
  })
  return projection.identity
}
