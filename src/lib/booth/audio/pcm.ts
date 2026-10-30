/**
 * PCM16 mono @ 24 kHz helpers shared by the capture, VAD, cascade STT and
 * the jitter-buffered player.
 */

export const SAMPLE_RATE = 24000

export function rmsOf(pcm: Int16Array): number {
  let sum = 0
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i]
  return Math.sqrt(sum / Math.max(1, pcm.length)) / 32768
}

export function concatPcm(chunks: Int16Array[]): Int16Array {
  let len = 0
  for (const c of chunks) len += c.length
  const out = new Int16Array(len)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

/** Wrap raw PCM16 mono bytes in a minimal WAV container (for STT uploads). */
export function pcmToWav(pcm: Int16Array, sampleRate = SAMPLE_RATE): ArrayBuffer {
  const bytes = pcm.length * 2
  const buf = new ArrayBuffer(44 + bytes)
  const v = new DataView(buf)
  const w = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i))
  }
  w(0, 'RIFF')
  v.setUint32(4, 36 + bytes, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  w(36, 'data')
  v.setUint32(40, bytes, true)
  new Int16Array(buf, 44).set(pcm)
  return buf
}

export function bytesToInt16(buffer: ArrayBuffer | Uint8Array): Int16Array {
  const src = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const even = src.byteOffset % 2 === 0 ? src : new Uint8Array(src) // ensure copy for alignment
  if (even.byteOffset % 2 !== 0) {
    const copy = new Uint8Array(even.byteLength)
    copy.set(even)
    return new Int16Array(copy.buffer, 0, Math.floor(copy.byteLength / 2))
  }
  return new Int16Array(even.buffer, even.byteOffset, Math.floor(even.byteLength / 2))
}
