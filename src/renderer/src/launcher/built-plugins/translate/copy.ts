import type { AppLocale } from "../../../../../shared/i18n"

export interface TranslatePluginCopy {
  backLabel: string
  copied: string
  copyResult: string
  copyResultAriaLabel: string
  emptyInputHint: string
  entryLabel: string
  footerHint: string
  inputPlaceholder: string
  readyToTranslate: string
  retryTranslation: string
  outputPlaceholder: string
  resultLabel: string
  searchItemSubtitle: (sourceText: string) => string
  sourceLabel: string
  sourceLanguage: string
  swapLanguages: string
  targetLanguage: string
  translateAction: string
  translateShortcut: string
  translationUpToDate: string
  updateTranslationHint: string
  translating: string
}

const translatePluginCopy: Record<AppLocale, TranslatePluginCopy> = {
  "en-US": {
    backLabel: "Back to Search",
    copied: "Copied",
    copyResult: "Copy Result",
    copyResultAriaLabel: "Copy translation result",
    emptyInputHint: "Enter text first",
    entryLabel: "Translate",
    footerHint: "Built plugin",
    inputPlaceholder: "Paste or type text to translate...",
    readyToTranslate: "Ready to translate",
    retryTranslation: "Retry",
    outputPlaceholder: "The translation will appear here.",
    resultLabel: "Translation",
    searchItemSubtitle: (sourceText) => `Translate "${sourceText}"`,
    sourceLabel: "Source",
    sourceLanguage: "Source language",
    swapLanguages: "Swap languages",
    targetLanguage: "Target language",
    translateAction: "Translate",
    translateShortcut: "⌘↵ / Ctrl↵",
    translationUpToDate: "Up to date",
    updateTranslationHint: "Press Translate to update the result.",
    translating: "Translating..."
  },
  "zh-CN": {
    backLabel: "返回搜索",
    copied: "已复制",
    copyResult: "复制结果",
    copyResultAriaLabel: "复制译文结果",
    emptyInputHint: "先输入内容",
    entryLabel: "翻译",
    footerHint: "独立 built-plugin",
    inputPlaceholder: "输入或粘贴要翻译的内容...",
    readyToTranslate: "准备翻译",
    retryTranslation: "重试",
    outputPlaceholder: "译文会在这里出现。",
    resultLabel: "译文",
    searchItemSubtitle: (sourceText) => `翻译这个“${sourceText}”`,
    sourceLabel: "原文",
    sourceLanguage: "源语言",
    swapLanguages: "切换语言方向",
    targetLanguage: "目标语言",
    translateAction: "翻译",
    translateShortcut: "⌘↵ / Ctrl↵",
    translationUpToDate: "已更新",
    updateTranslationHint: "点击翻译，或按 ⌘↵ / Ctrl↵ 更新结果。",
    translating: "正在翻译..."
  }
}

export function getTranslatePluginCopy(locale: AppLocale): TranslatePluginCopy {
  return translatePluginCopy[locale]
}
