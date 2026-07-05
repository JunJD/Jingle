import { knownNotionTransform } from "./notion.mjs"

export const knownExtensionTransforms = [knownNotionTransform]

export function getApplicableTransforms(context, transforms = knownExtensionTransforms) {
  const resolvedContext = resolveKnownExtensionContext(context)
  return transforms.filter(
    (transform) => !transform.appliesTo || transform.appliesTo(resolvedContext)
  )
}

export function getApplicableKnownExtensionTransforms(context) {
  return getApplicableTransforms(context)
}

function resolveKnownExtensionContext(context) {
  const preview = context.preview
  if (context.target || !preview?.source) {
    return context
  }

  return {
    ...context,
    target: {
      extensionId: preview.source.targetExtensionId,
      sourceExtensionId: preview.source.packageName
    }
  }
}

export function extendKnownExtensionGuide(guide, context) {
  const resolvedContext = resolveKnownExtensionContext(context)
  return getApplicableTransforms(resolvedContext).reduce(
    (currentGuide, transform) =>
      transform.extendGuide?.({ ...resolvedContext, guide: currentGuide }) ?? currentGuide,
    guide
  )
}

export function detectKnownExtensionBlockingAdapters(context) {
  const resolvedContext = resolveKnownExtensionContext(context)
  return getApplicableTransforms(resolvedContext)
    .flatMap((transform) => transform.detectBlockingAdapters?.(resolvedContext) ?? [])
}

export function suppressKnownExtensionBlockingAdapters(sourceFiles, target) {
  const context = resolveKnownExtensionContext({ sourceFiles, target })
  return getApplicableTransforms(context).reduce(
    (currentFiles, transform) =>
      transform.suppressBlockingAdapters?.({ sourceFiles: currentFiles, target }) ?? currentFiles,
    sourceFiles
  )
}

export function extendKnownExtensionPreferenceTypeLiteral(literal, context) {
  const resolvedContext = resolveKnownExtensionContext(context)
  return getApplicableTransforms(resolvedContext).reduce(
    (currentLiteral, transform) =>
      transform.extendPreferenceTypeLiteral?.({ ...resolvedContext, literal: currentLiteral }) ??
      currentLiteral,
    literal
  )
}
