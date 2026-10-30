/**
 * Energy-based voice-activity detection with an adaptive noise floor and
 * hysteresis — ported from the relay worker to run per browser device.
 * 100 ms PCM16 mono chunks in, speech events out.
 */
import { rmsOf } from './pcm'

export const TURN_SILENCE_MS = 1_300

export type VadEvent = 'start' | 'on' | 'off'

export class SpeakerVad {
  private noiseFloor = 120
  private speechChunks = 0
  private silenceMs = 0
  private speaking = false

  constructor(
    private onStart: () => void,
    private onAudio: (pcm: Int16Array, chunkMs: number) => void,
    private onEnd: () => void,
  ) {}

  feed(pcm: Int16Array): VadEvent | null {
    const chunkMs = (pcm.length / 24000) * 1000
    if (chunkMs <= 0) return null

    const rms = rmsOf(pcm)
    const onThreshold = Math.max(this.noiseFloor * 3.2, 320)
    const offThreshold = Math.max(this.noiseFloor * 2.1, 240)

    if (!this.speaking) {
      // adaptive noise floor: falls fast when quiet, rises slowly overall
      if (rms < this.noiseFloor) this.noiseFloor = 0.7 * this.noiseFloor + 0.3 * rms
      else this.noiseFloor = Math.min(this.noiseFloor * 1.02, 1500)
      this.noiseFloor = Math.max(this.noiseFloor, 30)

      if (rms > onThreshold) {
        this.speechChunks++
        if (this.speechChunks >= 2) {
          this.speaking = true
          this.silenceMs = 0
          this.onStart()
          this.onAudio(pcm, chunkMs)
          return 'start'
        }
      } else {
        this.speechChunks = 0
      }
      return null
    }

    this.onAudio(pcm, chunkMs)
    if (rms < offThreshold) {
      this.silenceMs += chunkMs
      if (this.silenceMs >= TURN_SILENCE_MS) {
        this.speaking = false
        this.speechChunks = 0
        this.silenceMs = 0
        this.onEnd()
        return 'off'
      }
    } else {
      this.silenceMs = 0
    }
    return 'on'
  }

  get isSpeaking() {
    return this.speaking
  }
}
