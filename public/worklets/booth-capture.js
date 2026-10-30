/**
 * Booth capture worklet.
 * Resamples the browser context rate to 24 kHz mono, converts to PCM16 and
 * posts 100 ms chunks (2400 samples) to the main thread, which forwards them
 * to the relay. Echo cancellation / noise suppression are set on getUserMedia.
 */
class BoothCapture extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const opts = (options && options.processorOptions) || {}
    this.fromRate = opts.fromRate || sampleRate
    this.toRate = opts.toRate || 24000
    this.chunkSamples = opts.chunkSamples || 2400 // 100 ms at 24 kHz
    this.buf = new Float32Array(0)
    this.phase = 0
    this.out = new Float32Array(this.chunkSamples)
    this.outCount = 0
    this.ratio = this.fromRate / this.toRate
  }

  process(inputs) {
    const input = inputs[0]
    if (input && input.length > 0 && input[0]) {
      const ch = input[0]
      // append incoming samples
      let buf = this.buf
      if (buf.length === 0) {
        buf = new Float32Array(ch)
      } else {
        const nb = new Float32Array(buf.length + ch.length)
        nb.set(buf)
        nb.set(ch, buf.length)
        buf = nb
      }

      const ratio = this.ratio
      let phase = this.phase
      let outCount = this.outCount
      const out = this.out

      while (phase + 1 < buf.length && outCount < this.chunkSamples) {
        const i = phase | 0
        const frac = phase - i
        let s = buf[i] * (1 - frac) + buf[i + 1] * frac
        if (s > 1) s = 1
        else if (s < -1) s = -1
        out[outCount++] = s
        phase += ratio
      }

      // keep unconsumed tail
      const keepFrom = Math.min(phase | 0, buf.length)
      this.buf = buf.slice(keepFrom)
      this.phase = phase - keepFrom

      if (outCount >= this.chunkSamples) {
        const pcm = new Int16Array(outCount)
        for (let k = 0; k < outCount; k++) {
          const v = out[k]
          pcm[k] = v < 0 ? (v * 0x8000) | 0 : (v * 0x7fff) | 0
        }
        this.port.postMessage(pcm, [pcm.buffer])
        outCount = 0
      }
      this.outCount = outCount
    }
    return true
  }
}

registerProcessor('booth-capture', BoothCapture)
