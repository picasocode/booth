'use client'

/**
 * Booth settings — ALL API configuration lives here, in the UI, on the
 * device. The OpenAI key and every model choice are stored in this browser's
 * localStorage only; nothing is sent to the Booth server. The Booth server
 * (the small Next.js deployment) never sees or stores API keys.
 */
import { useSyncExternalStore } from 'react'

export type EngineMode = 'auto' | 's2s' | 'cascade' | 'captions'

export interface BoothSettings {
  /** OpenAI API key (sk-…). Stored in localStorage only. */
  openaiKey: string
  /** auto: speech-to-speech when possible, cascade otherwise. */
  engine: EngineMode
  /** Play the translated voice (captions always run). */
  voiceOut: boolean
  /** Cascade TTS voice. */
  ttsVoice: string
  /** Cascade streaming-speech model. */
  sttModel: string
  /** Cascade translation model. */
  llmModel: string
  /** Cascade text-to-speech model. */
  ttsModel: string
}

export const DEFAULT_SETTINGS: BoothSettings = {
  openaiKey: '',
  engine: 'auto',
  voiceOut: true,
  ttsVoice: 'alloy',
  sttModel: 'gpt-4o-mini-transcribe',
  llmModel: 'gpt-4o-mini',
  ttsModel: 'gpt-4o-mini-tts',
}

export const TTS_VOICES = [
  { id: 'alloy', label: 'Alloy — balanced' },
  { id: 'ash', label: 'Ash — warm' },
  { id: 'ballad', label: 'Ballad — soft' },
  { id: 'coral', label: 'Coral — bright' },
  { id: 'echo', label: 'Echo — calm' },
  { id: 'fable', label: 'Fable — story' },
  { id: 'onyx', label: 'Onyx — deep' },
  { id: 'nova', label: 'Nova — energetic' },
  { id: 'sage', label: 'Sage — measured' },
  { id: 'shimmer', label: 'Shimmer — light' },
  { id: 'verse', label: 'Verse — versatile' },
]

export const STT_MODELS = [
  { id: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe — fastest' },
  { id: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe — most accurate' },
  { id: 'whisper-1', label: 'whisper-1 — wide language cover' },
]

export const LLM_MODELS = [
  { id: 'gpt-4o-mini', label: 'gpt-4o-mini — fastest (recommended)' },
  { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini — balanced' },
  { id: 'gpt-4o', label: 'gpt-4o — highest quality' },
]

export const TTS_MODELS = [
  { id: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts — best voice, streams fast' },
  { id: 'tts-1', label: 'tts-1 — lowest latency' },
]

const KEY = 'booth-settings'

let current: BoothSettings | undefined = undefined // undefined = not read yet
const listeners = new Set<() => void>()

function init() {
  if (current !== undefined) return
  current = { ...DEFAULT_SETTINGS }
  if (typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) current = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<BoothSettings>) }
  } catch {
    // keep defaults
  }
}

function getSnapshot(): BoothSettings {
  init()
  return current!
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useBoothSettings(): BoothSettings {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_SETTINGS)
}

export function saveBoothSettings(patch: Partial<BoothSettings>) {
  init()
  current = { ...DEFAULT_SETTINGS, ...current!, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // storage unavailable — settings stay for this page session
  }
  listeners.forEach((l) => l())
}

/** Shape-only check: classic sk- keys and new project keys. */
export function looksLikeOpenAiKey(key: string): boolean {
  return /^sk-[A-Za-z0-9_\-]{20,}$/.test(key)
}

export function hasApiKey(s: BoothSettings): boolean {
  return looksLikeOpenAiKey(s.openaiKey.trim())
}
