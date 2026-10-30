/**
 * Browser-side playback for the interpretation booth.
 * - PcmPlayer: jitter-buffered 24 kHz PCM16 voice (cascade TTS output).
 * - VoiceMeter: RMS level of any MediaStream (translated WebRTC audio, mic).
 */
import { SAMPLE_RATE } from './pcm'

interface Voice {
  gain: GainNode
  queue: Int16Array[]
  queuedSamples: number
  nextStart: number
  started: boolean
}

const JITTER_START_MS = 170

export class PcmPlayer {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private voice: Voice | null = null
  private onRms: ((rms: number) => void) | null = null

  /** Must be called from a user gesture at least once before playback. */
  resume() {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.master = this.ctx.createGain()
      this.master.gain.value = 1
      this.master.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  onLevel(cb: ((rms: number) => void) | null) {
    this.onRms = cb
  }

  setMuted(muted: boolean) {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02)
    }
  }

  /** Queue raw PCM16 mono @ 24 kHz for gapless playback. */
  push(pcm: Int16Array) {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    if (!this.voice) {
      const gain = ctx.createGain()
      gain.gain.value = 1
      gain.connect(this.master)
      this.voice = { gain, queue: [], queuedSamples: 0, nextStart: 0, started: false }
    }
    const v = this.voice
    if (this.onRms) {
      let sum = 0
      for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i]
      this.onRms(Math.sqrt(sum / Math.max(1, pcm.length)) / 32768)
    }

    v.queue.push(pcm)
    v.queuedSamples += pcm.length
    const bufferedMs = (v.queuedSamples / SAMPLE_RATE) * 1000
    if (!v.started && bufferedMs >= JITTER_START_MS) v.started = true

    while (v.started && v.queue.length > 0) {
      const chunk = v.queue[0]!
      const buf = ctx.createBuffer(1, chunk.length, SAMPLE_RATE)
      const f = new Float32Array(chunk.length)
      for (let i = 0; i < chunk.length; i++) f[i] = chunk[i] / 32768
      buf.copyToChannel(f, 0)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(v.gain)
      const now = ctx.currentTime
      const startAt = Math.max(v.nextStart, now + 0.02)
      src.start(startAt)
      v.nextStart = startAt + buf.duration
      v.queuedSamples -= chunk.length
      v.queue.shift()
    }

    // safety: drop the oldest audio if we accumulate too much unstarted
    if (!v.started && bufferedMs > 1500 && v.queue.length > 4) {
      const dropped = v.queue.shift()!
      v.queuedSamples -= dropped.length
    }
  }

  flush() {
    if (this.voice) {
      this.voice.queue = []
      this.voice.queuedSamples = 0
      this.voice.started = false
    }
  }

  destroy() {
    this.flush()
    void this.ctx?.close()
    this.ctx = null
    this.master = null
    this.voice = null
  }
}

/** Live RMS of a MediaStream via an AnalyserNode (e.g. the translated track). */
export class VoiceMeter {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private buf: Uint8Array | null = null
  private raf = 0

  attach(stream: MediaStream, cb: (rms: number) => void) {
    this.detach()
    if (!this.ctx) this.ctx = new AudioContext()
    const ctx = this.ctx
    if (ctx.state === 'suspended') void ctx.resume()
    // Chrome quirk: a remote WebRTC stream only drives a MediaStreamSource
    // reliably once an (inaudible) <audio> element is bound to it.
    const sink = document.createElement('audio')
    sink.srcObject = stream
    sink.muted = true
    void sink.play().catch(() => {})
    const node = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    node.connect(analyser)
    this.analyser = analyser
    this.buf = new Uint8Array(analyser.fftSize)
    const tick = () => {
      if (!this.analyser || !this.buf) return
      this.analyser.getByteTimeDomainData(this.buf as Uint8Array<ArrayBuffer>)
      let sum = 0
      for (let i = 0; i < this.buf.length; i++) {
        const x = (this.buf[i] - 128) / 128
        sum += x * x
      }
      cb(Math.sqrt(sum / this.buf.length))
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  detach() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.analyser?.disconnect()
    this.analyser = null
  }

  destroy() {
    this.detach()
    void this.ctx?.close()
    this.ctx = null
  }
}
