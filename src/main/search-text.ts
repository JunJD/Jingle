const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const WORD_PATTERN = /[\p{L}\p{N}_]+/gu
const MAX_SEGMENTED_SEARCH_TEXT_LENGTH = 20_000
const segmenter = new Intl.Segmenter(["zh", "ja", "ko", "en"], { granularity: "word" })

export function hasCjkText(value: string): boolean {
  return CJK_PATTERN.test(value)
}

export function buildSegmentedSearchText(value: string): string | null {
  if (value.length > MAX_SEGMENTED_SEARCH_TEXT_LENGTH) {
    return null
  }

  const segments: string[] = []
  for (const segment of segmenter.segment(value)) {
    if (!segment.isWordLike) {
      continue
    }

    const term = segment.segment.trim()
    if (term) {
      segments.push(term)
    }
  }

  if (segments.length === 0) {
    return null
  }

  return Array.from(new Set(segments)).join(" ")
}

export function buildUnicodeFtsQuery(query: string): string | null {
  const terms: string[] = []
  if (hasCjkText(query)) {
    for (const segment of segmenter.segment(query)) {
      if (!segment.isWordLike) {
        continue
      }

      const term = segment.segment.trim()
      if (term) {
        terms.push(term)
      }
    }
  } else {
    for (const match of query.matchAll(WORD_PATTERN)) {
      terms.push(match[0])
    }
  }

  const uniqueTerms = Array.from(new Set(terms))
  if (uniqueTerms.length === 0) {
    return null
  }

  return uniqueTerms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(" ")
}

export function buildTrigramFtsQuery(query: string): string | null {
  const normalized = query.replace(/\s+/g, " ").trim()
  if (!hasCjkText(normalized) || Array.from(normalized).length < 3) {
    return null
  }

  return `"${normalized.replaceAll('"', '""')}"`
}
