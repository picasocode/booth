'use client'

/**
 * BoothInterpreter — the whole live pipeline on one browser device:
 *
 *   source (mic or meeting-tab audio)
 *     ├── speech-to-speech: mic/room track -> WebRTC -> gpt-realtime-translate
 *     │     translated voice arrives as a remote audio track
 *     └── cascade: capture worklet -> VAD -> ASR windows -> LLM -> streaming TTS
 *
 * Engine choice, key and models all come from the on-device settings store.
 */
import { SpeakerVad } from '../audio/vad'
import { rmsOf } from '../audio/pcm'
import { VoiceMeter } from '../audio/player'
import type { PcmPlayer } from '../audio/player'
import { CascadeChannel } from './cascade'
import { S2sSession, s2sSupportsTarget } from './s2s'
import { hasApiKey, type BoothSettings } from '../settings-store'

export type InterpStatus = 'idle' | 'connecting' | 'live' | 'error'
export type EngineUsed = 's2s' | 'cascade'

export interface InterpreterEvents {
  onStatus: (status: InterpStatus, detail?: string) => void
  onSourceCaption: (id: string, text: string) => void
  onTargetCaption: (id: string, text: string, engine: string, lagMs?: number, mode?: 'delta' | 'full') => void
  onSelfLevel: (rms: number) => void
  onOutLevel: (rms: number) => void
  onError: (message: string) => void
  onUsage: (engine: EngineUsed, seconds: number) => void
}

const PREROLL_CHUNKS = 5 // 5 x 100 ms = 500 ms pre-roll
const CAPTURE_WORKLET = '/worklets/booth-capture.js'
const ENTRY_GAP_MS = 3000 // caption entries split after this silence

export class BoothInterpreter {
  private stream: MediaStream
  private targetLang: string
  private settings: BoothSettings
  private player: PcmPlayer
  private events: InterpreterEvents

  private captureCtx: AudioContext | null = null
  private captureNode: AudioWorkletNode | null = null
  private selfMeter: VoiceMeter | null = null
  private outMeter: VoiceMeter | null = null
  private s2s: S2sSession | null = null
  private cascade: CascadeChannel | null = null
  private vad: SpeakerVad | null = null

  private preroll: Int16Array[] = []
  private status: InterpStatus = 'idle'
  private engine: EngineUsed | null = null
  private s2sConnectedAt = 0
  private cascadeSpeechMs = 0
  private srcEntryId = ''
  private tgtEntryId = ''
  private lastSrcDelta = 0
  private lastTgtDelta = 0
  private seq = 0
  private stopped = false
  private voiceMuted = false

  private constructor(opts: {
    stream: MediaStream
    targetLang: string
    settings: BoothSettings
    player: PcmPlayer
    events: InterpreterEvents
  }) {
    this.stream = opts.stream
    this.targetLang = opts.targetLang
    this.settings = opts.settings
    this.player = opts.player
    this.events = opts.events
  }

  static async start(opts: {
    stream: MediaStream
    targetLang: string
    settings: BoothSettings
    player: PcmPlayer
    events: InterpreterEvents
  }): Promise<BoothInterpreter> {
    const it = new BoothInterpreter(opts)
    await it.init()
    return it
  }

  private async init() {
    this.player.resume()
    await this.buildEngine()
  }

  private effectiveSettings(): BoothSettings {
    if (this.settings.engine === 'captions') return { ...this.settings, voiceOut: false }
    return this.settings
  }

  private setStatus(s: InterpStatus, detail?: string) {
    this.status = s
    this.events.onStatus(s, detail)
  }

  private async buildEngine() {
    const settings = this.effectiveSettings()
    const mode = settings.engine
    const keyPresent = hasApiKey(settings)
    const track = this.stream.getAudioTracks()[0]

    // source meter (mic or tab audio level)
    this.selfMeter = new VoiceMeter()
    this.selfMeter.attach(this.stream, (rms) => this.events.onSelfLevel(rms))

    const wantS2s =
      keyPresent &&
      track &&
      (mode === 's2s' || (mode === 'auto' && s2sSupportsTarget(this.targetLang)))

    if (mode === 's2s' && !keyPresent) {
      this.setStatus('error', 'Add your OpenAI key in settings to use speech-to-speech.')
      return
    }
    if (mode === 's2s' && !s2sSupportsTarget(this.targetLang)) {
      this.events.onError(
        `Speech-to-speech does not voice ${this.targetLang.toUpperCase()} yet — switching to the cascade engine.`,
      )
    }

    if (wantS2s) {
      this.setStatus('connecting')
      try {
        this.s2s = await S2sSession.connect({
          track,
          sourceStream: this.stream,
          targetLang: this.targetLang,
          apiKey: settings.openaiKey.trim(),
          events: {
            onSourceDelta: (t) => this.pushSourceDelta(t),
            onTargetDelta: (t) => this.pushTargetDelta(t, 's2s', 'delta'),
            onConnected: () => {
              this.engine = 's2s'
              this.s2sConnectedAt = Date.now()
              this.s2s.setMuted(this.voiceMuted)
              this.setStatus('live')
              this.attachOutMeter()
            },
            onClosed: () => {
              if (this.status === 'live') this.setStatus('connecting')
            },
            onError: (m) => this.events.onError(m),
          },
        })
        // cascade is not needed alongside an open S2S session
        return
      } catch (e) {
        const message = (e as Error).message ?? 'realtime connect failed'
        if (settings.engine === 's2s') {
          this.setStatus('error', message)
          return
        }
        // auto: fall through to cascade
        this.events.onError(`speech-to-speech unavailable (${message.slice(0, 120)}) — using cascade.`)
      }
    }

    if (!keyPresent) {
      this.setStatus('error', 'No OpenAI key configured — add one in settings to start interpreting.')
      return
    }

    // cascade
    this.engine = 'cascade'
    this.player.setMuted(this.voiceMuted)
    this.cascade = new CascadeChannel('auto', this.targetLang, settings, {
      onSourceCaption: (text) => this.pushSourceDelta(text, true),
      onTargetCaption: (text, engine, lagMs) => this.pushTargetDelta(text, engine, 'full', lagMs),
      onTtsPcm: (pcm) => this.player.push(pcm),
      onError: (m) => this.events.onError(m),
    })
    await this.startCapture()
    this.setStatus('live')
  }

  private attachOutMeter() {
    if (!this.s2s || this.outMeter) return
    this.outMeter = new VoiceMeter()
    this.outMeter.attach(this.s2s.remoteStream, (rms) => this.events.onOutLevel(rms))
  }

  /** AudioWorklet capture for the cascade path (24 kHz PCM16, 100 ms chunks). */
  private async startCapture() {
    const track = this.stream.getAudioTracks()[0]
    if (!track) throw new Error('No audio track on the source stream')
    const ctx = new AudioContext()
    this.captureCtx = ctx
    const source = ctx.createMediaStreamSource(this.stream)
    await ctx.audioWorklet.addModule(CAPTURE_WORKLET)
    const node = new AudioWorkletNode(ctx, 'booth-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { fromRate: ctx.sampleRate, toRate: 24000, chunkSamples: 2400 },
    })
    node.port.onmessage = (ev: MessageEvent) => {
      const pcm = ev.data as Int16Array
      if (!pcm || pcm.length === 0) return
      this.events.onSelfLevel(rmsOf(pcm))
      this.feedVad(pcm)
    }
    source.connect(node)
    node.connect(ctx.createGain()) // silent sink keeps the graph running
    this.captureNode = node
    void track
  }

  private feedVad(pcm: Int16Array) {
    if (!this.cascade) return
    this.preroll.push(pcm)
    if (this.preroll.length > PREROLL_CHUNKS) this.preroll.shift()

    if (!this.vad) {
      this.vad = new SpeakerVad(
        // speech started: replay the pre-roll so the first word survives
        () => {
          if (!this.cascade) return
          for (const c of this.preroll) {
            this.cascade.pushAudio(c, 100)
            this.cascadeSpeechMs += 100
          }
          this.preroll = []
        },
        (chunk, chunkMs) => {
          this.cascade?.pushAudio(chunk, chunkMs)
          this.cascadeSpeechMs += chunkMs
        },
        () => {
          this.cascade?.endTurn()
          this.preroll = []
        },
      )
    }
    this.vad.feed(pcm)
  }

  // ---------- caption entry management ----------

  private rotateEntry(kind: 'src' | 'tgt', force = false): string {
    const last = kind === 'src' ? this.lastSrcDelta : this.lastTgtDelta
    const cur = kind === 'src' ? this.srcEntryId : this.tgtEntryId
    if (force || !cur || Date.now() - last > ENTRY_GAP_MS) {
      this.seq += 1
      const id = `${kind}-${this.seq}`
      if (kind === 'src') this.srcEntryId = id
      else this.tgtEntryId = id
      return id
    }
    return cur
  }

  private pushSourceDelta(text: string, final = false) {
    const id = this.rotateEntry('src')
    this.lastSrcDelta = Date.now()
    this.events.onSourceCaption(id, text)
    if (final) this.srcEntryId = '' // next window starts a fresh entry
  }

  private pushTargetDelta(text: string, engine: string, mode: 'delta' | 'full', lagMs?: number) {
    const id = this.rotateEntry('tgt')
    this.lastTgtDelta = Date.now()
    this.events.onTargetCaption(id, text, engine, lagMs, mode)
    if (mode === 'full') this.tgtEntryId = '' // each translated sentence is its own entry
  }

  /** Mute/unmute the translated voice (captions keep running). */
  setVoiceMuted(muted: boolean) {
    this.voiceMuted = muted
    this.s2s?.setMuted(muted)
    this.player.setMuted(muted)
  }

  // ---------- lifecycle ----------

  /** Switch the language being heard; reuses the same source stream. */
  async retarget(lang: string) {
    if (lang === this.targetLang || this.stopped) return
    this.targetLang = lang
    await this.teardownEngine()
    await this.buildEngine()
  }

  private async teardownEngine() {
    this.s2s?.close()
    this.s2s = null
    if (this.cascade) {
      await this.cascade.close()
      this.cascade = null
    }
    this.vad = null
    this.captureNode?.port.close()
    this.captureNode?.disconnect()
    this.captureNode = null
    void this.captureCtx?.close()
    this.captureCtx = null
    this.selfMeter?.destroy()
    this.selfMeter = null
    this.outMeter?.destroy()
    this.outMeter = null
    this.preroll = []
    this.status = 'idle'
  }

  stop() {
    if (this.stopped) return
    this.stopped = true

    if (this.engine === 's2s' && this.s2sConnectedAt > 0) {
      const seconds = (Date.now() - this.s2sConnectedAt) / 1000
      if (seconds > 1) this.events.onUsage('s2s', Math.round(seconds))
    }
    if (this.engine === 'cascade' && this.cascadeSpeechMs > 1000) {
      this.events.onUsage('cascade', Math.round(this.cascadeSpeechMs / 1000))
    }

    void this.teardownEngine()
    for (const t of this.stream.getTracks()) t.stop()
  }

  get engineInUse(): EngineUsed | null {
    return this.engine
  }

  get currentStatus(): InterpStatus {
    return this.status
  }
}
