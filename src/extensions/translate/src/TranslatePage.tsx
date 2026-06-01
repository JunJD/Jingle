import { useMemo } from "react"
import { ArrowLeft, ArrowRightLeft, Check, Copy } from "lucide-react"
import {
  Action,
  ActionPanel,
  Form,
  useNativeExtensionNavigation,
  useRuntimeAppLocale
} from "@openwork/extension-api"
import { getTranslatePluginCopy } from "./copy"
import { useTranslate } from "./use-translate"

export function TranslatePage(): React.JSX.Element {
  const locale = useRuntimeAppLocale()
  const navigation = useNativeExtensionNavigation()
  const translate = useTranslate()
  const copy = getTranslatePluginCopy(locale)
  const hasFreshTranslation = !translate.isDirty && translate.translatedText.trim().length > 0
  const sourceStatus = !translate.sourceText.trim() ? copy.emptyInputHint : null
  const resultStatus = translate.isTranslating ? copy.translating : null
  const detailText = useMemo(() => {
    if (translate.error) {
      return translate.error
    }

    if (hasFreshTranslation) {
      return translate.translatedText
    }

    if (translate.isTranslating) {
      return copy.translating
    }

    if (translate.sourceText.trim()) {
      return copy.updateTranslationHint
    }

    return copy.outputPlaceholder
  }, [
    copy.outputPlaceholder,
    copy.translating,
    copy.updateTranslationHint,
    hasFreshTranslation,
    translate.error,
    translate.isTranslating,
    translate.sourceText,
    translate.translatedText
  ])

  return (
    <Form
      actions={
        <ActionPanel>
          <Action
            disabled={!translate.canSubmit}
            icon={<ArrowRightLeft />}
            title={translate.error ? copy.retryTranslation : copy.translateAction}
            onAction={() => translate.submitTranslation()}
          />
          <Action
            disabled={!hasFreshTranslation}
            icon={translate.copied ? <Check /> : <Copy />}
            title={translate.copied ? copy.copied : copy.copyResult}
            onAction={() => translate.copyTranslatedText()}
          />
          <Action
            icon={<ArrowRightLeft />}
            title={copy.swapLanguages}
            onAction={translate.swapLanguages}
          />
          <Action icon={<ArrowLeft />} title={copy.backLabel} onAction={navigation.goHome} />
        </ActionPanel>
      }
      navigationTitle={copy.entryLabel}
    >
      <Form.Dropdown
        id="source-language"
        title={copy.sourceLanguage}
        value={translate.sourceLanguageId}
        onChange={translate.setSourceLanguageId}
      >
        {translate.languageOptions.map((option) => (
          <Form.Dropdown.Item key={option.id} title={option.label} value={option.id} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown
        id="target-language"
        title={copy.targetLanguage}
        value={translate.targetLanguageId}
        onChange={translate.setTargetLanguageId}
      >
        {translate.languageOptions
          .filter((option) => option.id !== "auto")
          .map((option) => (
            <Form.Dropdown.Item key={option.id} title={option.label} value={option.id} />
          ))}
      </Form.Dropdown>
      <Form.TextArea
        id="source-text"
        description={sourceStatus ?? copy.updateTranslationHint}
        placeholder={copy.inputPlaceholder}
        title={copy.sourceLabel}
        value={translate.sourceText}
        onChange={translate.setSourceText}
      />
      <Form.Message
        id="translation-result"
        text={`${copy.resultLabel}: ${detailText}${resultStatus ? ` (${resultStatus})` : ""}`}
        tone={translate.error ? "critical" : "info"}
      />
    </Form>
  )
}
