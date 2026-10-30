/**
 * Cascade engine — the always-available fallback that runs entirely in the
 * browser against the OpenAI REST API with the user's own key:
 *   streaming ASR windows -> sentence assembly -> LLM interpreter -> streaming TTS
 * Ported from the relay worker; same timing constants, same interpreter prompt.
 */
import { LANG_MAP } from '../languages'
import type { BoothSettings } from '../settings-store'
import { concatPcm, pcmToWav, SAMPLE_RATE } from '../audio/pcm'

export const FIRST_WINDOW_MS = 1_500
export const WINDOW_MS = 2_300
export const FLUSH_AFTER_TURN_MS = 250
export const MAX_SENTENCE_CHARS = 600

const ASR_MIN_INTERVAL_MS = 650
const TTS_MIN_INTERVAL_MS = 250
const LLM_MIN_INTERVAL_MS = 250

const SENTENCE_END = /[.!?。！？।…]$/

export interface CascadeEvents {
  onSourceCaption: (text: string, final: boolean) => void
  onTargetCaption: (text: string, engine: string, lagMs: number) => void
  onTtsPcm: (pcm: Int16Array) => void
  onError: (message: string) => void
}

export interface Sentence {
  text: string
  spokeAt: number
  final: boolean
}

async function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

/** Minimal client-side pacing to stay under OpenAI per-minute limits. */
class Pacer {
  private next = new Map<string, number>()
  async wait(key: string, minIntervalMs: number) {
    const now = Date.now()
    const at = Math.max(this.next.get(key) ?? 0, now)
    this.next.set(key, at + minIntervalMs)
    if (at > now) await sleep(at - now)
  }
}

export class CascadeChannel {
  private pacer = new Pacer()
  private window: Int16Array[] = []
  private windowMs = 0
  private nextWindowMs = FIRST_WINDOW_MS
  private draining = false
  private sentence = ''
  private chain: Promise<void> = Promise.resolve()
  private closed = false
  private entrySeq = 0

  constructor(
    private sourceLang: string,
    private targetLang: string,
    private settings: BoothSettings,
    private events: CascadeEvents,
  ) {}

  get voiceOut(): boolean {
    return this.settings.voiceOut && this.settings.engine !== 'captions'
  }

  /** Feed one VAD-gated PCM chunk (100 ms). */
  pushAudio(pcm: Int16Array, chunkMs: number) {
    if (this.closed) return
    this.window.push(pcm)
    this.windowMs += chunkMs
    if (this.windowMs >= this.nextWindowMs && !this.draining) {
      this.draining = true
      const slice = this.window
      const sliceMs = this.windowMs
      this.window = []
      this.windowMs = 0
      this.nextWindowMs = WINDOW_MS
      const spokeAt = Date.now()
      this.chain = this.chain
        .then(() => this.recognize(slice, sliceMs, spokeAt))
        .catch((e) => this.events.onError(`asr: ${msg(e)}`))
        .finally(() => {
          this.draining = false
        })
    }
  }

  /** Flush whatever is pending shortly after a VAD turn ends. */
  endTurn() {
    if (this.closed) return
    setTimeout(() => {
      const slice = this.window
      const sliceMs = this.windowMs
      this.window = []
      this.windowMs = 0
      if (slice.length > 0 || this.sentence.trim().length > 0) {
        const spokeAt = Date.now()
        this.chain = this.chain
          .then(async () => {
            if (slice.length > 0) await this.recognize(slice, sliceMs, spokeAt, true)
            else await this.flushSentence(spokeAt, true)
          })
          .catch((e) => this.events.onError(`flush: ${msg(e)}`))
      }
    }, FLUSH_AFTER_TURN_MS)
  }

  async close() {
    this.closed = true
    try {
      await this.chain
    } catch {
      // already surfaced
    }
  }

  private async recognize(slice: Int16Array[], sliceMs: number, spokeAt: number, isFinal = false) {
    const pcm = concatPcm(slice)
    if (pcm.length < 2400) return // < 100 ms of audio
    const text = await this.transcribe(pcm)
    if (!text) {
      if (isFinal) await this.flushSentence(spokeAt, true)
      return
    }
    // source captions go out immediately
    this.events.onSourceCaption(text, isFinal)

    this.sentence = joinSentence(this.sentence, text)
    if (isFinal || this.sentence.length >= MAX_SENTENCE_CHARS || SENTENCE_END.test(this.sentence)) {
      await this.flushSentence(spokeAt, isFinal)
    }
  }

  private async transcribe(pcm: Int16Array): Promise<string> {
    const key = this.settings.openaiKey.trim()
    await this.pacer.wait('asr', ASR_MIN_INTERVAL_MS)
    const wav = pcmToWav(pcm, SAMPLE_RATE)
    const form = new FormData()
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav')
    form.append('model', this.settings.sttModel)
    if (this.sourceLang && this.sourceLang !== 'auto') form.append('language', this.sourceLang)
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    })
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200)
      throw new Error(`transcribe ${res.status}: ${detail}`)
    }
    const data = (await res.json()) as { text?: string }
    return (data.text ?? '').trim()
  }

  private async flushSentence(spokeAt: number, final: boolean) {
    const text = this.sentence.trim()
    if (!text) return
    this.sentence = ''
    await this.interpret({ text, spokeAt, final })
  }

  private context: Array<{ src: string; tgt: string }> = []

  private async interpret(sentence: Sentence) {
    const tgtName = LANG_MAP[this.targetLang]?.name ?? this.targetLang
    const srcName = LANG_MAP[this.sourceLang]?.name ?? this.sourceLang

    const context = this.context.slice(-2).flatMap((p) => [
      { role: 'user' as const, content: p.src },
      { role: 'assistant' as const, content: p.tgt },
    ])

    await this.pacer.wait('llm', LLM_MIN_INTERVAL_MS)
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.settings.openaiKey.trim()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.settings.llmModel,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              `You are a simultaneous interpreter in a live meeting, working from ${srcName} into ${tgtName}. ` +
              `Translate the user's message into ${tgtName}. Output ONLY the translation, in natural spoken register, ` +
              `matching the speaker's style. Keep numbers, names and technical terms exact. Never answer, never explain, never add notes.`,
          },
          ...context,
          { role: 'user', content: sentence.text },
        ],
      }),
    })
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200)
      throw new Error(`translate ${res.status}: ${detail}`)
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    let translated = (data.choices?.[0]?.message?.content ?? '').trim()
    translated = stripQuotes(translated)
    if (!translated) return

    this.context.push({ src: sentence.text, tgt: translated })
    if (this.context.length > 4) this.context = this.context.slice(-4)

    const lagMs = Math.max(0, Date.now() - sentence.spokeAt)
    this.events.onTargetCaption(translated, 'cascade', lagMs)

    if (this.voiceOut) {
      await this.speak(translated)
    }
  }

  private async speak(text: string) {
    await this.pacer.wait('tts', TTS_MIN_INTERVAL_MS)
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.settings.openaiKey.trim()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.settings.ttsModel,
        input: text.slice(0, 1000),
        voice: this.settings.ttsVoice,
        speed: 1.0,
        response_format: 'pcm', // raw PCM16 mono @ 24 kHz, streams as it renders
      }),
    })
    if (!res.ok || !res.body) {
      const detail = res.body ? (await res.text()).slice(0, 160) : `status ${res.status}`
      throw new Error(`tts ${res.status}: ${detail}`)
    }
    const reader = res.body.getReader()
    let carry = new Uint8Array(0)
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      const merged = new Uint8Array(carry.length + value.length)
      merged.set(carry)
      merged.set(value, carry.length)
      carry = merged
      const frames = Math.floor(carry.length / 2) * 2 // whole PCM16 frames only
      if (frames > 0) {
        this.events.onTtsPcm(new Int16Array(carry.buffer.slice(0, frames)))
        carry = carry.slice(frames)
      }
    }
    if (carry.length >= 2) {
      const frames = Math.floor(carry.length / 2) * 2
      this.events.onTtsPcm(new Int16Array(carry.buffer.slice(0, frames)))
    }
  }
}

export function joinSentence(a: string, b: string): string {
  if (!a) return b
  const needsSpace = /[a-zA-Z0-9,;:]$/.test(a) && /^[a-zA-Z0-9(]/.test(b)
  return a + (needsSpace ? ' ' : '') + b
}

function stripQuotes(s: string): string {
  const t = s.trim()
  if (/^["“”'«」『].*["“”'»」』]$/.test(t)) return t.slice(1, -1).trim()
  return t
}

function msg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.slice(0, 160)
}
