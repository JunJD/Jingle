import { useCallback, useRef } from "react"
import { ArrowLeft, ArrowRightLeft, Check, ChevronDown, Copy } from "lucide-react"
import { FALLBACK_SHELL_CONFIG } from "../../../../../shared/launcher"
import { useI18n } from "@/lib/i18n"
import { useBuiltLauncherPluginLifecycle, useBuiltLauncherPluginNavigation } from "../sdk"
import { getTranslatePluginCopy } from "./copy"
import { useTranslatePlugin } from "./useTranslatePlugin"

function LanguageSelect(props: {
  ariaLabel: string
  className?: string
  onValueChange: (value: string) => void
  options: Array<{ id: string; label: string }>
  value: string
}): React.JSX.Element {
  const { ariaLabel, className, onValueChange, options, value } = props

  return (
    <label className={["launcher-translate-select", className].filter(Boolean).join(" ")}>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className="launcher-translate-select-control"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none size-4 text-[var(--launcher-text-muted)]" />
    </label>
  )
}

export function LauncherTranslatePage(): React.JSX.Element {
  const { locale } = useI18n()
  const navigation = useBuiltLauncherPluginNavigation()
  const translate = useTranslatePlugin()
  const copy = getTranslatePluginCopy(locale)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const focusInput = useCallback((): void => {
    const input = inputRef.current
    if (!input) {
      return
    }

    input.focus()
    const caretPosition = input.value.length
    input.setSelectionRange(caretPosition, caretPosition)
  }, [])

  useBuiltLauncherPluginLifecycle({
    onEnter: focusInput,
    onLauncherShown: focusInput
  })

  const hasFreshTranslation = !translate.isDirty && translate.translatedText.trim().length > 0
  const sourceStatus = !translate.sourceText.trim() ? copy.emptyInputHint : null
  const resultStatus = translate.isTranslating ? copy.translating : null

  return (
    <div className="flex h-full w-full flex-col">
      <div
        className="grid shrink-0 grid-cols-[40px_1fr] items-center gap-4 border-b px-5"
        style={{
          borderColor: "var(--launcher-border)",
          height: FALLBACK_SHELL_CONFIG.headerHeight
        }}
      >
        <button
          type="button"
          onClick={navigation.goHome}
          onMouseDown={(event) => event.preventDefault()}
          className="flex h-10 w-10 appearance-none items-center justify-center rounded-full border-0 bg-[var(--launcher-surface-strong)] text-muted-foreground transition hover:text-foreground"
          aria-label={copy.backLabel}
        >
          <ArrowLeft className="size-5" />
        </button>

        <div className="min-w-0">
          <div className="launcher-translate-toolbar-title">{copy.entryLabel}</div>
        </div>
      </div>

      <div className="launcher-translate-stage">
        <div className="launcher-translate-grid">
          <section className="launcher-translate-panel">
            <div className="launcher-translate-panel-header">
              <div className="launcher-translate-panel-heading">
                <span>{copy.sourceLabel}</span>
              </div>

              <LanguageSelect
                ariaLabel={copy.sourceLanguage}
                className="launcher-translate-select--panel"
                onValueChange={translate.setSourceLanguageId}
                options={translate.languageOptions}
                value={translate.sourceLanguageId}
              />
            </div>

            <textarea
              ref={inputRef}
              value={translate.sourceText}
              onChange={(event) => translate.setSourceText(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault()
                  void translate.submitTranslation()
                  return
                }

                if (event.key === "Backspace" && !translate.sourceText.trim()) {
                  event.preventDefault()
                  navigation.goHome()
                }
              }}
              placeholder={copy.inputPlaceholder}
              className="launcher-translate-textarea"
            />

            <div className="launcher-translate-panel-footer">
              <span className="launcher-translate-panel-status">{sourceStatus ?? ""}</span>

              <button
                type="button"
                onClick={() => {
                  void translate.submitTranslation()
                }}
                onMouseDown={(event) => event.preventDefault()}
                disabled={!translate.canSubmit}
                className="launcher-translate-submit"
              >
                <span>{translate.error ? copy.retryTranslation : copy.translateAction}</span>
                <span className="launcher-translate-submit-shortcut">{copy.translateShortcut}</span>
              </button>
            </div>
          </section>

          <div className="launcher-translate-center-action">
            <button
              type="button"
              onClick={translate.swapLanguages}
              onMouseDown={(event) => event.preventDefault()}
              className="launcher-translate-swap"
              aria-label={copy.swapLanguages}
            >
              <ArrowRightLeft className="size-4" />
            </button>
          </div>

          <section className="launcher-translate-panel">
            <div className="launcher-translate-panel-header">
              <div className="launcher-translate-panel-heading">
                <span>{copy.resultLabel}</span>
              </div>

              <div className="launcher-translate-panel-actions">
                <LanguageSelect
                  ariaLabel={copy.targetLanguage}
                  className="launcher-translate-select--panel"
                  onValueChange={translate.setTargetLanguageId}
                  options={translate.languageOptions.filter((option) => option.id !== "auto")}
                  value={translate.targetLanguageId}
                />

                <button
                  type="button"
                  onClick={() => {
                    void translate.copyTranslatedText()
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  disabled={!hasFreshTranslation}
                  className="launcher-translate-copy"
                  aria-label={translate.copied ? copy.copied : copy.copyResultAriaLabel}
                  title={translate.copied ? copy.copied : copy.copyResult}
                >
                  {translate.copied ? (
                    <Check className="size-3.5" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </button>
              </div>
            </div>

            <div className="launcher-translate-output">
              {translate.error ? (
                <div className="launcher-translate-placeholder text-[#f6b3b3]">
                  {translate.error}
                </div>
              ) : hasFreshTranslation ? (
                <div className="whitespace-pre-wrap">{translate.translatedText}</div>
              ) : (
                <div className="launcher-translate-placeholder">
                  <div>{translate.isTranslating ? copy.translating : copy.outputPlaceholder}</div>
                  {!translate.isTranslating && translate.sourceText.trim() ? (
                    <div className="launcher-translate-placeholder-hint">
                      {copy.updateTranslationHint}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <div className="launcher-translate-panel-footer">
              <span className="launcher-translate-panel-status">{resultStatus ?? ""}</span>
              <span />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
