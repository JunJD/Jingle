import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { resolveJingleAgentComposerSubmissionAvailability } from "@jingle/agent-client"
import { getCanonicalAttachmentMessageError } from "../../src/main/agent/attachment-admission"
import { resolveModelAttachmentCapabilities } from "../../src/main/model-provider/attachment-capabilities"
import { toRemoteModelConfigs } from "../../src/main/model-provider/model-list"
import {
  getCustomProviderForUI,
  upsertCustomProviderForUI
} from "../../src/main/model-provider/service"
import {
  normalizeComposerMessageRefs,
  toAgentMessageContentWithRefs,
  toMessageContent
} from "../../src/shared/message-content"

const originalConfigHome = process.env.JINGLE_CONFIG_HOME
const originalDataHome = process.env.JINGLE_DATA_HOME
let testHome: string | null = null

test.beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), "jingle-model-attachments-"))
  process.env.JINGLE_CONFIG_HOME = join(testHome, "config")
  process.env.JINGLE_DATA_HOME = join(testHome, "data")
})

test.afterEach(() => {
  restoreEnv("JINGLE_CONFIG_HOME", originalConfigHome)
  restoreEnv("JINGLE_DATA_HOME", originalDataHome)
  if (testHome) {
    rmSync(testHome, { force: true, recursive: true })
    testHome = null
  }
})

test("listed model attachment capability intersects exact modality with provider transport", () => {
  assert.deepEqual(resolveModelAttachmentCapabilities("openai:gpt-4o"), {
    supportedFileSourceKinds: ["data", "file-id", "text"],
    supportedImageSourceKinds: ["data", "url"],
    supportedModalities: ["vision"]
  })
  assert.equal(resolveModelAttachmentCapabilities("deepseek:deepseek-v4-pro"), null)
  assert.equal(resolveModelAttachmentCapabilities("openai:gpt-unknown-preview"), null)
})

test("remote models inherit attachment modalities only from an exact catalog match", () => {
  const models = toRemoteModelConfigs(
    "openai",
    [{ id: "gpt-4o" }, { id: "gpt-unknown-preview" }],
    () => true
  )

  assert.deepEqual(models.find((model) => model.model === "gpt-4o")?.features, ["vision"])
  assert.equal(models.find((model) => model.model === "gpt-unknown-preview")?.features, undefined)
})

test("custom models require an exact explicit attachment modality declaration", () => {
  const providerId = upsertCustomProviderForUI({
    baseUrl: "https://attachments.example.test/v1",
    displayName: "attachment declarations",
    engine: "openai",
    models: [{ attachmentModalities: ["vision"], name: "image-model" }, { name: "plain-model" }],
    requiresAuth: false,
    supportsStreaming: true
  })

  assert.deepEqual(resolveModelAttachmentCapabilities(`${providerId}:image-model`), {
    supportedFileSourceKinds: ["data", "file-id", "text"],
    supportedImageSourceKinds: ["data", "url"],
    supportedModalities: ["vision"]
  })
  assert.equal(resolveModelAttachmentCapabilities(`${providerId}:plain-model`), null)
  assert.equal(resolveModelAttachmentCapabilities(`${providerId}:unlisted-model`), null)
  assert.deepEqual(getCustomProviderForUI(providerId)?.models[0]?.attachment_modalities, ["vision"])

  upsertCustomProviderForUI({
    baseUrl: "https://attachments.example.test/v1",
    displayName: "attachment declarations",
    engine: "openai",
    models: [{ name: "image-model" }, { name: "plain-model" }],
    providerId,
    requiresAuth: false,
    supportsStreaming: true
  })
  assert.equal(resolveModelAttachmentCapabilities(`${providerId}:image-model`), null)
})

test("custom attachment declarations reject empty and duplicate modalities", () => {
  const createInput = (attachmentModalities: Array<"vision">) => ({
    baseUrl: "https://invalid-attachments.example.test/v1",
    displayName: "invalid attachment declarations",
    engine: "openai" as const,
    models: [{ attachmentModalities, name: "image-model" }],
    requiresAuth: false,
    supportsStreaming: true
  })

  assert.throws(
    () => upsertCustomProviderForUI(createInput([])),
    /attachment_modalities must be a non-empty array/
  )
  assert.throws(
    () => upsertCustomProviderForUI(createInput(["vision", "vision"])),
    /attachment_modalities must not contain duplicates/
  )
})

test("composer admission enforces image modality and transport source kind", () => {
  const imageInput = {
    refs: [{ name: "diagram.png", type: "image" as const, url: "data:image/png;base64,cG5n" }],
    text: "Review"
  }
  assert.deepEqual(
    resolveJingleAgentComposerSubmissionAvailability({
      attachmentCapabilities: null,
      messageInput: imageInput
    }),
    { reason: "provider_attachment_capability_unavailable", type: "unavailable" }
  )
  assert.deepEqual(
    resolveJingleAgentComposerSubmissionAvailability({
      attachmentCapabilities: {
        supportedFileSourceKinds: ["data"],
        supportedImageSourceKinds: ["data"],
        supportedModalities: ["vision"]
      },
      messageInput: imageInput
    }),
    { type: "ready" }
  )
  assert.deepEqual(
    resolveJingleAgentComposerSubmissionAvailability({
      attachmentCapabilities: {
        supportedFileSourceKinds: ["url"],
        supportedImageSourceKinds: ["url"],
        supportedModalities: ["vision"]
      },
      messageInput: imageInput
    }),
    { reason: "provider_file_data_unsupported", type: "unavailable" }
  )
  assert.deepEqual(
    resolveJingleAgentComposerSubmissionAvailability({
      attachmentCapabilities: {
        supportedFileSourceKinds: ["data"],
        supportedImageSourceKinds: ["data"],
        supportedModalities: ["document"]
      },
      messageInput: imageInput
    }),
    { reason: "model_attachment_modality_unsupported", type: "unavailable" }
  )
  assert.deepEqual(
    resolveJingleAgentComposerSubmissionAvailability({
      attachmentCapabilities: null,
      messageInput: { refs: [], text: "Text-only request" }
    }),
    { type: "ready" }
  )
  assert.deepEqual(
    resolveJingleAgentComposerSubmissionAvailability({
      attachmentCapabilities: {
        supportedFileSourceKinds: ["url"],
        supportedImageSourceKinds: ["url"],
        supportedModalities: ["document"]
      },
      messageInput: {
        refs: [
          {
            name: "unknown",
            source: { kind: "url", url: "https://example.test/attachment" },
            type: "file-attachment"
          }
        ],
        text: "Review"
      }
    }),
    { reason: "model_attachment_modality_unsupported", type: "unavailable" }
  )
})

test("main attachment admission rejects content-only and mismatched images", () => {
  const refs = [{ name: "diagram.png", type: "image" as const, url: "data:image/png;base64,cG5n" }]
  const normalizedRefs = normalizeComposerMessageRefs(refs)
  const canonicalContent = toAgentMessageContentWithRefs(
    toMessageContent({ refs: normalizedRefs, text: "Review" }),
    normalizedRefs
  )

  assert.equal(
    getCanonicalAttachmentMessageError({
      composerText: "Review",
      content: canonicalContent,
      id: "message-valid",
      refs
    }),
    null
  )
  assert.equal(
    getCanonicalAttachmentMessageError({
      composerText: "Review",
      content: canonicalContent,
      id: "message-content-only"
    }),
    "Attachment content does not match canonical composer references."
  )
  assert.equal(
    getCanonicalAttachmentMessageError({
      composerText: "Review",
      content: canonicalContent,
      id: "message-mismatch",
      refs: [{ ...refs[0], url: "data:image/png;base64,b3RoZXI=" }]
    }),
    "Attachment content does not match canonical composer references."
  )
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}
