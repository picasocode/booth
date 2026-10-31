/**
 * Speech-to-speech translation over WebRTC to OpenAI's
 * gpt-realtime-translate — the lowest-latency interpretation path
 * (first translated voice in roughly 0.7–1.8 s).
 *
 * No per-device key: the client exchanges its WebRTC offer for a short-lived
 * client secret through the Booth server, which injects the ONE shared key
 * saved by the host. Audio itself still streams browser→OpenAI directly
 * over WebRTC (the server never touches audio packets).
 */
import { OPENAI_VOICE_TARGETS } from '../languages'

const TRANSLATIONS_CALLS_URL = 'https://api.openai.com/v1/realtime/translations/calls'
export const S2S_MODEL = 'gpt-realtime-translate'

export function s2sSupportsTarget(lang: string): boolean {
  return OPENAI_VOICE_TARGETS.has(lang)
}

export async function fetchClientSecret(targetLang: string): Promise<string> {
  const r = await fetch('/api/realtime-token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ language: targetLang }),
  })
  const data = await r.json().catch(() => null)
  if (!r.ok) {
    const detail =
      (data && ((data as Record<string, unknown>).error as unknown)) ||
      `client secret failed (${r.status})`
    throw new Error(String(detail).slice(0, 200))
  }
  const secret = extractSecret(data)
  if (!secret) throw new Error('No client secret in response')
  return secret
}

function extractSecret(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const cs = d.client_secret
  if (typeof cs === 'string' && cs.length > 10) return cs
  if (cs && typeof cs === 'object') {
    const v = (cs as Record<string, unknown>).value
    if (typeof v === 'string' && v.length > 10) return v
  }
  if (typeof d.value === 'string' && d.value.length > 10) return d.value
  return null
}

export interface S2sEvents {
  onSourceDelta: (text: string) => void
  onTargetDelta: (text: string) => void
  /** A complete source utterance (used for extra caption languages). */
  onSourceDone?: (text: string) => void
  onConnected: () => void
  onClosed: () => void
  onError: (message: string) => void
}

const TARGET_DELTA_TYPES = new Set([
  'session.output_transcript.delta',
  'output_transcript.delta',
  'response.output_transcript.delta',
  'response.audio_transcript.delta',
])

const SOURCE_DELTA_TYPES = new Set([
  'session.input_transcript.delta',
  'input_transcript.delta',
  'conversation.item.input_audio_transcription.delta',
])

const SOURCE_DONE_TYPES = new Set([
  'session.input_transcript.done',
  'input_transcript.done',
  'conversation.item.input_audio_transcription.completed',
])

type RealtimeEvent = {
  type?: string
  delta?: string
  transcript?: string
  text?: string
  error?: { message?: string }
  message?: string
}

export class S2sSession {
  readonly remoteStream: MediaStream
  /** Audible playback element for the translated voice track. */
  readonly audio: HTMLAudioElement
  private pc: RTCPeerConnection
  private dc: RTCDataChannel
  private track: MediaStreamTrack
  private events: S2sEvents
  private closed = false

  private constructor(
    pc: RTCPeerConnection,
    dc: RTCDataChannel,
    remoteStream: MediaStream,
    track: MediaStreamTrack,
    events: S2sEvents,
  ) {
    this.pc = pc
    this.dc = dc
    this.remoteStream = remoteStream
    this.track = track
    this.events = events

    // The audible sink: playing the remote track through an element is the
    // most reliable path for WebRTC audio (and keeps the analyser fed).
    this.audio = document.createElement('audio')
    this.audio.srcObject = remoteStream
    this.audio.autoplay = true
    void this.audio.play().catch(() => {})

    dc.onmessage = (ev) => this.handleEvent(ev.data)
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState
      if (st === 'connected') this.events.onConnected()
      if ((st === 'failed' || st === 'disconnected') && !this.closed) {
        this.events.onError('realtime connection dropped')
        this.events.onClosed()
      }
    }
  }

  /** Full handshake: client secret -> offer/answer with the Realtime API. */
  static async connect(opts: {
    track: MediaStreamTrack
    sourceStream: MediaStream
    targetLang: string
    events: S2sEvents
  }): Promise<S2sSession> {
    const secret = await fetchClientSecret(opts.targetLang)

    const pc = new RTCPeerConnection()
    const dc = pc.createDataChannel('oai-events')
    const remote = new MediaStream()
    const session = new S2sSession(pc, dc, remote, opts.track, opts.events)

    pc.ontrack = (ev) => {
      for (const s of ev.streams) for (const t of s.getAudioTracks()) remote.addTrack(t)
    }

    pc.addTrack(opts.track, opts.sourceStream)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    // wait briefly for ICE so the SDP carries usable candidates
    await waitForIce(pc, 2000)

    const res = await fetch(TRANSLATIONS_CALLS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'content-type': 'application/sdp' },
      body: pc.localDescription?.sdp ?? offer.sdp,
    })
    if (!res.ok) {
      pc.close()
      throw new Error(
        `realtime connect failed (${res.status}): ${(await res.text()).slice(0, 160)}`,
      )
    }
    const answerSdp = await res.text()
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
    return session
  }

  private handleEvent(raw: unknown) {
    let evt: RealtimeEvent
    try {
      evt = JSON.parse(typeof raw === 'string' ? raw : String(raw)) as RealtimeEvent
    } catch {
      return
    }
    const type = evt.type ?? ''
    if (TARGET_DELTA_TYPES.has(type)) {
      const text = evt.delta ?? evt.transcript ?? evt.text ?? ''
      if (text) this.events.onTargetDelta(text)
    } else if (SOURCE_DELTA_TYPES.has(type)) {
      const text = evt.delta ?? evt.transcript ?? evt.text ?? ''
      if (text) this.events.onSourceDelta(text)
    } else if (SOURCE_DONE_TYPES.has(type)) {
      const text = evt.transcript ?? evt.text ?? ''
      if (text) {
        this.events.onSourceDelta(` ${text}`)
        this.events.onSourceDone?.(text)
      }
    } else if (type === 'session.error' || type === 'error' || type === 'response.error') {
      const msg = evt.error?.message ?? evt.message ?? 'realtime session error'
      this.events.onError(`gpt-realtime-translate: ${String(msg).slice(0, 180)}`)
    }
  }

  setTrackEnabled(enabled: boolean) {
    try {
      this.track.enabled = enabled
    } catch {
      // track may already be stopped
    }
  }

  setMuted(muted: boolean) {
    this.audio.muted = muted
  }

  close() {
    if (this.closed) return
    this.closed = true
    try {
      this.dc.close()
    } catch {
      // already closed
    }
    try {
      this.pc.close()
    } catch {
      // already closed
    }
    this.audio.srcObject = null
    this.events.onClosed()
  }
}

function waitForIce(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check)
      clearTimeout(t)
      resolve()
    }
    const check = () => {
      if (pc.iceGatheringState === 'complete') done()
    }
    pc.addEventListener('icegatheringstatechange', check)
    const t = setTimeout(done, timeoutMs)
  })
}
