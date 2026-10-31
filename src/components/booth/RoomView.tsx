'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Wordmark } from '@/components/booth/Chrome'
import {
  CaptionEntry,
  EngineStrip,
  SettingsChip,
  SpeakerRow,
  type ParticipantView,
} from '@/components/booth/RoomPieces'
import { SettingsDialog } from '@/components/booth/SettingsDialog'
import { BoothInterpreter, type EngineUsed, type InterpStatus } from '@/lib/booth/engine/interpreter'
import { PcmPlayer } from '@/lib/booth/audio/player'
import { LANG_MAP } from '@/lib/booth/languages'
import { useBoothSettings } from '@/lib/booth/settings-store'
import { useSharedConfig } from '@/lib/booth/config-store'
import type { BoothSession } from '@/components/booth/session-store'

interface CaptionItem {
  id: string
  sourceLang: string
  sourceText: string
  targetText?: string
  engine?: string
  lagMs?: number
  /** Set for extra caption-language entries (no voice). */
  targetLang?: string
  updatedAt: number
}

interface UsageRow {
  engine: string
  sourceLang: string
  targetLang: string
  seconds: number
  costUsd: number
}

const ONLINE_WINDOW_MS = 90_000

export function RoomView({
  session,
  onLeave,
}: {
  session: BoothSession
  onLeave: () => void
}) {
  const settings = useBoothSettings()
  const shared = useSharedConfig()
  const playerRef = useRef<PcmPlayer | null>(null)
  const interpRef = useRef<BoothInterpreter | null>(null)
  const usageRef = useRef<UsageRow[]>([])
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const myLangRef = useRef(session.language)

  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [status, setStatus] = useState<InterpStatus>('idle')
  const [engineUsed, setEngineUsed] = useState<EngineUsed | null>(null)
  const [participants, setParticipants] = useState<ParticipantView[]>([])
  const [captions, setCaptions] = useState<CaptionItem[]>([])
  const [myLang, setMyLang] = useState(() => {
    const mine = session.myLanguages?.[0] ?? session.language
    return session.languages.includes(mine) ? mine : session.languages[0]
  })
  // extra caption languages — everything else I understand, minus the primary
  const [extraLangs, setExtraLangs] = useState<string[]>(() =>
    (session.myLanguages ?? [])
      .slice(1)
      .filter((l, i) => l !== (session.myLanguages?.[0] ?? session.language) && session.languages.includes(l)),
  )
  const [voiceOut, setVoiceOut] = useState(settings.voiceOut)
  const [meters, setMeters] = useState({ self: 0, out: 0 })
  const [notice, setNotice] = useState('')
  const [fatal, setFatal] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [elapsedS, setElapsedS] = useState(0)

  useEffect(() => {
    myLangRef.current = myLang
  }, [myLang])

  const extraLangsRef = useRef<string[]>(extraLangs)
  useEffect(() => {
    extraLangsRef.current = extraLangs
    interpRef.current?.setExtraTargets(extraLangs)
  }, [extraLangs])

  // ---------------- usage metering ----------------

  const flushUsage = useCallback(() => {
    if (usageRef.current.length === 0) return
    const rows = usageRef.current
    usageRef.current = []
    void fetch('/api/usage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rows: rows.map((r) => ({ ...r, meetingId: session.meetingId })),
      }),
      keepalive: true,
    }).catch(() => {})
  }, [session.meetingId])

  // ---------------- presence heartbeat ----------------

  useEffect(() => {
    let alive = true
    const beat = async () => {
      try {
        const res = await fetch(`/api/meetings/${encodeURIComponent(session.code)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ participantId: session.participantId, language: myLangRef.current }),
        })
        if (!res.ok || !alive) return
        const d = await res.json()
        const fresh = (d.participants ?? []).filter(
          (p: ParticipantView & { lastSeenAt: string }) =>
            Date.now() - new Date(p.lastSeenAt).getTime() < ONLINE_WINDOW_MS,
        )
        setParticipants(fresh)
      } catch {
        // presence is best-effort
      }
    }
    void beat()
    const t = setInterval(beat, 6000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [session.code, session.participantId])

  // ---------------- start / stop ----------------

  const startInterpreter = useCallback(
    async (stream: MediaStream) => {
      const player = playerRef.current ?? new PcmPlayer()
      playerRef.current = player
      player.resume()
      player.setMuted(!voiceOut)

      setStarting(true)
      setNotice('')
      setFatal('')
      try {
        const interp = await BoothInterpreter.start({
          stream,
          targetLang: myLangRef.current,
          settings,
          keyReady: shared.configured,
          extraTargets: extraLangsRef.current,
          player,
          events: {
            onStatus: (s, detail) => {
              setStatus(s)
              if (detail && s === 'error') setFatal(detail)
            },
            onSourceCaption: (id, text) => {
              setCaptions((prev) => upsertAppend(prev, id, { sourceText: text }).slice(-120))
            },
            onTargetCaption: (id, text, engine, lagMs, mode, targetLang) => {
              setCaptions((prev) =>
                (mode === 'full'
                  ? upsertReplace(prev, id, { targetText: text, engine, lagMs, targetLang })
                  : upsertAppend(prev, id, { targetText: text, engine, targetLang })
                ).slice(-120),
              )
            },
            onSelfLevel: (rms) => setMeters((m) => (Math.abs(m.self - rms) > 0.01 ? { ...m, self: rms } : m)),
            onOutLevel: (rms) => setMeters((m) => (Math.abs(m.out - rms) > 0.01 ? { ...m, out: rms } : m)),
            onError: (msg) => setNotice((prev) => (prev ? prev : msg)),
            onUsage: (engine, seconds) => {
              usageRef.current.push({
                engine,
                sourceLang: 'auto',
                targetLang: myLangRef.current,
                seconds,
                costUsd: 0,
              })
            },
          },
        })
        interpRef.current = interp
        setRunning(true)
        setElapsedS(0)
      } catch (e) {
        setFatal(humanMicError(e))
        for (const t of stream.getTracks()) t.stop()
      } finally {
        setStarting(false)
      }
    },
    [settings, voiceOut, shared.configured],
  )

  const startMic = useCallback(async () => {
    setFatal('')
    setNotice('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      await startInterpreter(stream)
    } catch (e) {
      setFatal(humanMicError(e))
    }
  }, [startInterpreter])

  const startTabAudio = useCallback(async () => {
    setFatal('')
    setNotice('')
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // Chrome requires a video request to offer tab audio
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      for (const t of stream.getVideoTracks()) t.stop() // audio only from here
      const audioTracks = stream.getAudioTracks()
      if (audioTracks.length === 0) {
        stream.getTracks().forEach((t) => t.stop())
        setFatal('No audio was shared — tick "Share tab audio" (or "Share system audio") in the picker.')
        return
      }
      await startInterpreter(stream)
    } catch (e) {
      setFatal(humanMicError(e))
    }
  }, [startInterpreter])

  const stopInterpreter = useCallback(() => {
    interpRef.current?.stop()
    interpRef.current = null
    playerRef.current?.flush()
    setRunning(false)
    setStatus('idle')
    setEngineUsed(null)
    setMeters({ self: 0, out: 0 })
    flushUsage()
  }, [flushUsage])

  const switchLanguage = useCallback(
    async (lang: string) => {
      setMyLang(lang)
      myLangRef.current = lang
      // the new primary moves out of the extra-caption set
      setExtraLangs((prev) => prev.filter((l) => l !== lang))
      try {
        const raw = sessionStorage.getItem('booth-session')
        if (raw) {
          const s = JSON.parse(raw)
          s.language = lang
          s.myLanguages = [lang, ...((s.myLanguages ?? []) as string[]).filter((l: string) => l !== lang)]
          sessionStorage.setItem('booth-session', JSON.stringify(s))
        }
      } catch {
        // ignore
      }
      if (interpRef.current && running) {
        setStatus('connecting')
        await interpRef.current.retarget(lang)
      }
    },
    [running],
  )

  const toggleVoice = useCallback(
    (v: boolean) => {
      setVoiceOut(v)
      interpRef.current?.setVoiceMuted(!v)
      playerRef.current?.setMuted(!v)
    },
    [],
  )

  const leave = useCallback(() => {
    stopInterpreter()
    flushUsage()
    onLeave()
  }, [onLeave, stopInterpreter, flushUsage])

  // cleanup + flush usage when the tab closes
  useEffect(() => {
    const onHide = () => flushUsage()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      interpRef.current?.stop()
      interpRef.current = null
      playerRef.current?.destroy()
      playerRef.current = null
      flushUsage()
    }
  }, [flushUsage])

  // engine actually in use (after status settles)
  useEffect(() => {
    if (status === 'live') setEngineUsed(interpRef.current?.engineInUse ?? null)
  }, [status])

  // elapsed timer while running
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setElapsedS((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [running])

  // auto-scroll captions to the newest line
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [captions])

  // ---------------- render ----------------

  const mins = Math.floor(elapsedS / 60)
  const secs = elapsedS % 60
  const keyReady = shared.configured
  const me = participants.find((p) => p.participantId === session.participantId)
  const others = participants.filter((p) => p.participantId !== session.participantId)

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* top bar */}
      <header className="border-b border-hairline shrink-0">
        <div className="px-4 sm:px-5 h-14 flex items-center gap-3 flex-wrap">
          <Wordmark small />
          <div className="hidden sm:flex items-baseline gap-2 min-w-0">
            <span className="font-medium text-foreground truncate max-w-[26ch]">
              {session.meetingName}
            </span>
            <span className="rounded-md border border-hairline px-1.5 py-0.5 text-[11px] tracking-widest text-muted-foreground">
              {session.code}
            </span>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 text-[11px] ${status === 'error' ? 'text-warn' : 'text-muted-foreground'}`}
            aria-live="polite"
          >
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${
                status === 'live' ? 'bg-live booth-pulse' : status === 'error' ? 'bg-warn' : 'bg-border'
              }`}
            />
            {running ? (status === 'live' ? 'live' : 'connecting…') : 'idle'}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums hidden sm:inline">
            {mins}:{String(secs).padStart(2, '0')}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <SettingsChip />
            <label className="hidden md:flex items-center gap-2 text-[11px] text-muted-foreground">
              you hear
              <select
                value={myLang}
                onChange={(e) => void switchLanguage(e.target.value)}
                className="h-8 rounded-lg border border-input bg-card px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                aria-label="Your language"
              >
                {session.languages.map((l) => (
                  <option key={l} value={l}>
                    {LANG_MAP[l]?.native ?? l}
                  </option>
                ))}
              </select>
            </label>
            {running ? (
              <Button
                onClick={stopInterpreter}
                className="h-9 rounded-full px-4 text-sm bg-mic hover:bg-mic/90 text-white"
              >
                Stop interpreting
              </Button>
            ) : (
              <Button
                onClick={startMic}
                disabled={starting}
                className="h-9 rounded-full px-4 text-sm bg-live hover:bg-live-deep text-primary-foreground"
              >
                {starting ? 'Starting…' : 'Start interpreting'}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={leave}
              className="h-9 rounded-full px-4 text-sm border-hairline bg-transparent hover:bg-accent"
            >
              Leave
            </Button>
          </div>
        </div>
        <div className="md:hidden px-4 pb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="tabular-nums">{mins}:{String(secs).padStart(2, '0')}</span>
          <span>·</span>
          <span>you hear</span>
          <select
            value={myLang}
            onChange={(e) => void switchLanguage(e.target.value)}
            className="h-7 rounded-lg border border-input bg-card px-1.5 text-xs text-foreground"
            aria-label="Your language"
          >
            {session.languages.map((l) => (
              <option key={l} value={l}>
                {LANG_MAP[l]?.native ?? l}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* main */}
      <div className="flex-1 min-h-0 grid lg:grid-cols-[300px_1fr]">
        {/* stage */}
        <aside className="hidden lg:flex flex-col border-r border-hairline min-h-0">
          <p className="px-4 pt-4 pb-1 text-xs text-muted-foreground">In the room</p>
          <div className="px-4 pb-2 overflow-y-auto" style={{ maxHeight: '46%' }}>
            {me && <SpeakerRow p={me} isMe rms={meters.self} />}
            {others.map((p) => (
              <SpeakerRow key={p.participantId} p={p} isMe={false} rms={0} />
            ))}
            {participants.length === 0 && (
              <p className="text-xs text-muted-foreground py-3">Nobody here yet…</p>
            )}
          </div>
          <div className="mt-auto border-t border-hairline p-4 space-y-3">
            {!running && (
              <Button
                variant="outline"
                className="w-full h-9 text-[13px] border-hairline"
                onClick={startTabAudio}
                disabled={starting}
              >
                Interpret a meeting tab instead
              </Button>
            )}
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="voice-out-room" className="text-[13px] text-foreground">
                Translated voice
              </label>
              <Switch
                id="voice-out-room"
                checked={voiceOut}
                onCheckedChange={toggleVoice}
              />
            </div>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Booth interprets the audio your device hears. Use headphones — sound leaking
              from your speakers back into the mic gets re-interpreted.
            </p>
          </div>
        </aside>

        {/* captions */}
        <section className="flex flex-col min-h-0" aria-label="Live captions">
          <div className="flex items-center gap-2 px-5 py-2 border-b border-hairline shrink-0 flex-wrap">
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              Captions in{' '}
              <span className="font-medium text-foreground font-caption">
                {LANG_MAP[myLang]?.native ?? myLang}
              </span>
            </span>
            {session.languages
              .filter((l) => l !== myLang)
              .map((l) => {
                const on = extraLangs.includes(l)
                return (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={on}
                    title={on ? 'Captions on — click to turn off' : 'Add captions in this language'}
                    onClick={() =>
                      setExtraLangs((prev) => (prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]))
                    }
                    className={`inline-flex items-center gap-1 rounded-full border px-2 h-6 text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                      on
                        ? 'border-live bg-live/10 text-foreground'
                        : 'border-border bg-card text-muted-foreground hover:border-input hover:text-foreground'
                    }`}
                  >
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: LANG_MAP[l]?.dot ?? '#888' }} />
                    <span className="font-caption">{LANG_MAP[l]?.native ?? l}</span>
                  </button>
                )
              })}
            <span className="ml-auto text-[11px] text-muted-foreground hidden sm:inline whitespace-nowrap">
              voice runs a few seconds behind the speaker
            </span>
          </div>

          {(fatal || notice || !keyReady) && (
            <div className="mx-4 mt-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] leading-relaxed text-foreground flex items-start gap-2">
              <span aria-hidden className="mt-1 h-1.5 w-1.5 rounded-full bg-warn shrink-0" />
              <p className="min-w-0">
                {fatal || notice || 'No shared OpenAI key yet — the host adds it once in settings, then it works for everyone.'}
                <button
                  className="ml-2 underline underline-offset-2 hover:no-underline"
                  onClick={() => setSettingsOpen(true)}
                >
                  Open settings
                </button>
              </p>
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto" aria-live="polite">
            {captions.length === 0 ? (
              <div className="h-full flex items-center justify-center px-6">
                <div className="max-w-sm text-center">
                  <p className="font-display text-lg font-semibold text-foreground">
                    Nothing interpreted yet
                  </p>
                  <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                    Start interpreting and let Booth hear the meeting — through your
                    microphone or a shared browser tab. Everything anyone says will appear
                    here in{' '}
                    <span className="font-caption">{LANG_MAP[myLang]?.native ?? myLang}</span>{' '}
                    (plus any extra caption languages you switch on above), with the
                    interpreted voice on your audio.
                  </p>
                </div>
              </div>
            ) : (
              captions.map((c) => (
                <CaptionEntry
                  key={c.id}
                  name="Room audio"
                  sourceLang={c.sourceLang}
                  sourceText={c.sourceText}
                  targetText={c.targetText}
                  targetLang={c.targetLang}
                  lagMs={c.lagMs}
                />
              ))
            )}
          </div>
        </section>
      </div>

      {/* engine strip */}
      <footer className="border-t border-hairline shrink-0 bg-card/60">
        <EngineStrip engine={engineUsed} targetLang={myLang} status={running ? status : 'idle'} />
      </footer>

      {/* mobile controls */}
      <div className="lg:hidden border-t border-hairline px-4 py-3 space-y-2 bg-background shrink-0">
        {!running && (
          <Button
            variant="outline"
            className="w-full h-9 text-[13px] border-hairline"
            onClick={startTabAudio}
            disabled={starting}
          >
            Interpret a meeting tab instead
          </Button>
        )}
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="voice-out-m" className="text-[13px] text-foreground">
            Translated voice
          </label>
          <Switch id="voice-out-m" checked={voiceOut} onCheckedChange={toggleVoice} />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Use headphones — speaker leak gets re-interpreted.
        </p>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}

function humanMicError(e: unknown): string {
  const name = (e as Error).name ?? ''
  if (name === 'NotAllowedError')
    return 'Microphone or screen-share access was blocked. Allow it in your browser’s address bar, then try again.'
  if (name === 'NotFoundError') return 'No microphone found. Connect one, or interpret a meeting tab instead.'
  return (e as Error).message?.slice(0, 200) || 'Could not start.'
}

type CaptionPatch = Partial<Pick<CaptionItem, 'sourceText' | 'targetText' | 'engine' | 'lagMs'>>

function upsertAppend(list: CaptionItem[], id: string, patch: CaptionPatch): CaptionItem[] {
  const idx = list.findIndex((c) => c.id === id)
  if (idx === -1) {
    return [
      ...list,
      {
        id,
        sourceLang: 'auto',
        sourceText: '',
        updatedAt: Date.now(),
        ...patch,
      },
    ]
  }
  const next = [...list]
  const cur = next[idx]
  next[idx] = {
    ...cur,
    ...patch,
    sourceText: patch.sourceText !== undefined ? (cur.sourceText + patch.sourceText) : cur.sourceText,
    targetText:
      patch.targetText !== undefined && patch.lagMs === undefined
        ? (cur.targetText ?? '') + patch.targetText
        : (patch.targetText ?? cur.targetText),
    engine: patch.engine ?? cur.engine,
    updatedAt: Date.now(),
  }
  return next
}

function upsertReplace(list: CaptionItem[], id: string, patch: CaptionPatch): CaptionItem[] {
  const idx = list.findIndex((c) => c.id === id)
  if (idx === -1) {
    return [...list, { id, sourceLang: 'auto', sourceText: '', updatedAt: Date.now(), ...patch }]
  }
  const next = [...list]
  next[idx] = { ...next[idx], ...patch, updatedAt: Date.now() }
  return next
}
