/**
 * Single source of truth for the language catalogue and per-engine coverage.
 * Imported by BOTH the Next app and the booth-relay mini service.
 *
 * Coverage is measured, not assumed (bake-off of 2026-10-30, see scripts/probe_*.ts):
 *  - asr:   can the cascade engine transcribe a person SPEAKING this language?
 *  - voice: can the cascade engine SPEAK this language back (TTS quality)?
 *  - The LLM writes captions in every listed language.
 *  - When an OpenAI key is configured, gpt-realtime-translate covers all 70+
 *    input languages and 13 voice targets — the router upgrades automatically.
 */

export type LangCode =
  | 'en' | 'zh' | 'hi' | 'ta' | 'te' | 'ja' | 'ko'
  | 'es' | 'fr' | 'de' | 'pt' | 'ru' | 'ar' | 'id' | 'vi' | 'it'

export type AsrSupport = 'good' | 'beta' | 'no'
export type VoiceSupport = 'good' | 'no'

export interface LanguageDef {
  code: LangCode
  name: string      // English name
  native: string    // endonym, shown in the picker and chips
  dot: string       // functional colour dot used consistently for this language
  asr: AsrSupport   // cascade: speech-to-text of a live speaker
  voice: VoiceSupport // cascade: synthesized voice out
  ttsVoice: string  // cascade TTS voice id
}

export const LANGUAGES: LanguageDef[] = [
  { code: 'en', name: 'English',   native: 'English',   dot: '#0B7A5C', asr: 'good', voice: 'good', ttsVoice: 'jam' },
  { code: 'zh', name: 'Chinese',   native: '中文',      dot: '#C2382E', asr: 'good', voice: 'good', ttsVoice: 'xiaochen' },
  { code: 'hi', name: 'Hindi',     native: 'हिन्दी',     dot: '#D98E04', asr: 'beta', voice: 'no',   ttsVoice: 'tongtong' },
  { code: 'ta', name: 'Tamil',     native: 'தமிழ்',     dot: '#7A3BE0', asr: 'no',   voice: 'no',   ttsVoice: 'tongtong' },
  { code: 'te', name: 'Telugu',    native: 'తెలుగు',    dot: '#B04173', asr: 'no',   voice: 'no',   ttsVoice: 'tongtong' },
  { code: 'ja', name: 'Japanese',  native: '日本語',    dot: '#8A5A2B', asr: 'no',   voice: 'no',   ttsVoice: 'tongtong' },
  { code: 'ko', name: 'Korean',    native: '한국어',    dot: '#3B7DBF', asr: 'no',   voice: 'no',   ttsVoice: 'tongtong' },
  { code: 'es', name: 'Spanish',   native: 'Español',   dot: '#E07B2A', asr: 'no',   voice: 'no',   ttsVoice: 'tongtong' },
  { code: 'fr', name: 'French',    native: 'Français',  dot: '#4E6FB8', asr: 'no',   voice: 'no',   ttsVoice: 'tongtong' },
  { code: 'de', name: 'German',    native: 'Deutsch',   dot: '#6B6B47', asr: 'no',   voice: 'no',   ttsVoice: 'tongtong' },
  { code: 'pt', name: 'Portuguese',native: 'Português', dot: '#2E8B6E', asr: 'no',   voice: 'no',   ttsVoice: 'tongtong' },
  { code: 'ru', name: 'Russian',   native: 'Русский',   dot: '#946BAA', asr: 'no',   voice: 'no',   ttsVoice: 'tongtong' },
  { code: 'ar', name: 'Arabic',    native: 'العربية',   dot: '#57803F', asr: 'no',   voice: 'no',   ttsVoice: 'tongtong' },
  { code: 'id', name: 'Indonesian',native: 'Indonesia', dot: '#C05A8E', asr: 'no',   voice: 'no',   ttsVoice: 'tongtong' },
  { code: 'vi', name: 'Vietnamese',native: 'Tiếng Việt',dot: '#7C7C2F', asr: 'no',   voice: 'no',   ttsVoice: 'tongtong' },
  { code: 'it', name: 'Italian',   native: 'Italiano',  dot: '#A85D3B', asr: 'no',   voice: 'no',   ttsVoice: 'tongtong' },
]

export const LANG_MAP: Record<string, LanguageDef> = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l]),
)

export function langName(code: string): string {
  return LANG_MAP[code]?.name ?? code
}

export function langNative(code: string): string {
  return LANG_MAP[code]?.native ?? code
}

/** OpenAI gpt-realtime-translate voice targets (the 13 output languages from the guide). */
export const OPENAI_VOICE_TARGETS = new Set<string>([
  'en', 'es', 'pt', 'fr', 'de', 'it', 'ru', 'zh', 'ja', 'ko', 'hi', 'id', 'vi',
])

/** OpenAI accepts 70+ input languages; every language we offer is inside that set. */
export const OPENAI_ASR = true

export const MAX_ROOM_LANGUAGES = 4
