import assert from "node:assert/strict"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { LauncherAttachmentStrip } from "../../src/renderer/src/ai-core/LauncherAttachmentStrip"
import {
  removeLauncherAiAttachmentById,
  toComposerAttachmentRefs,
  type LauncherAiAttachmentDraft
} from "../../src/renderer/src/ai-core/useAiAttachments"
import { I18nProvider } from "../../src/renderer/src/lib/i18n"

type ImageAttachmentDraft = Extract<LauncherAiAttachmentDraft, { kind: "image" }>

function createAttachments(count: number): ImageAttachmentDraft[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1
    const dataUrl = `data:image/png;base64,image-${number}`
    return {
      dataUrl,
      height: 100,
      id: `image-${number}`,
      kind: "image",
      name: `image-${number}.png`,
      previewDataUrl: dataUrl,
      source: "picker",
      width: 100
    }
  })
}

test("launcher attachment strip exposes every attachment and its remove control", () => {
  const attachments = createAttachments(4)
  const markup = renderToStaticMarkup(
    createElement(I18nProvider, {
      children: createElement(LauncherAttachmentStrip, {
        attachments,
        onRemove: () => undefined
      }),
      initialLocale: "en-US"
    })
  )

  for (const attachment of attachments) {
    assert.ok(markup.includes(`alt="${attachment.name}"`))
    assert.ok(markup.includes(`aria-label="Remove attachment: ${attachment.name}"`))
  }
  assert.match(markup, /class="flex w-max shrink-0 items-center/)
  assert.doesNotMatch(markup, />\+1<\/div>/)
})

test("removing any attachment keeps the visible drafts and submitted refs in sync", () => {
  const attachments = createAttachments(4)

  for (const removedAttachment of attachments) {
    const remaining = removeLauncherAiAttachmentById(attachments, removedAttachment.id)
    const expectedAttachments = attachments.filter(
      (attachment) => attachment.id !== removedAttachment.id
    )

    assert.deepEqual(
      remaining.map((attachment) => attachment.id),
      expectedAttachments.map((attachment) => attachment.id)
    )
    assert.deepEqual(
      toComposerAttachmentRefs(remaining),
      expectedAttachments.map((attachment) => ({
        name: attachment.name,
        type: "image",
        url: attachment.dataUrl
      }))
    )
  }
})
