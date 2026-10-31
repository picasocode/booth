'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Wordmark, ThemeToggle } from '@/components/booth/Chrome'
import { CaptionReel } from '@/components/booth/CaptionReel'
import { SettingsDialog } from '@/components/booth/SettingsDialog'
import {
  LanguageChipToggle,
  LanguageMultiSelect,
  LanguageLimitNote,
} from '@/components/booth/LanguageControls'
import { LANGUAGES, MAX_ROOM_LANGUAGES } from '@/lib/booth/languages'
import { useSharedConfig } from '@/lib/booth/config-store'

export interface JoinResult {
  participantId: string
  name: string
  language: string
  /** Primary-first list of languages this participant understands. */
  myLanguages: string[]
  meeting: { id: string; code: string; name: string; languages: string[] }
}

interface UsageInfo {
  engines: Array<{ engine: string; minutes: number; costUsd: number; sessions: number }>
}

export function HomeView({
  onJoined,
  prefillCode,
}: {
  onJoined: (r: JoinResult) => void
  prefillCode: string
}) {
  const [roomName, setRoomName] = useState('')
  const [picked, setPicked] = useState<string[]>(['en', 'hi', 'ta'])
  const [myName, setMyName] = useState('')
  // languages I understand — primary (voice) first, the rest are captions
  const [myPicked, setMyPicked] = useState<string[]>(['en'])
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  const [joinCode, setJoinCode] = useState(prefillCode)
  const [joinName, setJoinName] = useState('')
  const [joinLangs, setJoinLangs] = useState<string[] | null>(null)
  const [joinMyLangs, setJoinMyLangs] = useState<string[]>([])
  const [joinError, setJoinError] = useState('')
  const [joining, setJoining] = useState(false)

  // freshest join selection for the async join flow (state lags after a lookup)
  const joinMyLangsRef = useRef<string[]>([])
  useEffect(() => {
    joinMyLangsRef.current = joinMyLangs
  }, [joinMyLangs])

  const [usage, setUsage] = useState<UsageInfo | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const shared = useSharedConfig()
  const keyReady = shared.configured

  useEffect(() => {
    fetch('/api/usage')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setUsage(d))
      .catch(() => {})
    try {
      setMyName(localStorage.getItem('booth-name') ?? '')
    } catch {
      // ignore
    }
  }, [])

  // First visit with no shared key yet: open the setup dialog automatically
  // so the settings UI is impossible to miss. Only nags once per browser.
  useEffect(() => {
    if (!shared.loaded || shared.configured) return
    let seen = false
    try {
      seen = localStorage.getItem('booth-setup-seen') === '1'
      localStorage.setItem('booth-setup-seen', '1')
    } catch {
      // ignore
    }
    if (!seen) setSettingsOpen(true)
  }, [shared.loaded, shared.configured])

  useEffect(() => {
    // keep "I understand" inside the room's language set, never empty
    setMyPicked((prev) => {
      const next = prev.filter((l) => picked.includes(l))
      return next.length > 0 ? next : picked.slice(0, 1)
    })
  }, [picked])

  const toggleLang = (code: string) => {
    setCreateError('')
    setPicked((prev) =>
      prev.includes(code)
        ? prev.filter((c) => c !== code)
        : prev.length >= MAX_ROOM_LANGUAGES
          ? prev
          : [...prev, code],
    )
  }

  async function createRoom() {
    setCreateError('')
    if (!myName.trim()) return setCreateError('Enter your name.')
    if (picked.length < 2) return setCreateError('Pick at least two languages.')
    setCreating(true)
    try {
      localStorage.setItem('booth-name', myName.trim())
    } catch {
      // ignore
    }
    try {
      const res = await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: roomName.trim() || 'Untitled meeting', languages: picked }),
      })
      const data = await res.json()
      if (!res.ok) return setCreateError(data.error ?? 'Could not create the room.')
      await doJoin(data.code, myName.trim(), myPicked)
    } catch {
      setCreateError('Network problem — try again.')
    } finally {
      setCreating(false)
    }
  }

  /** Returns the room languages plus a primary-first selection for the joiner. */
  async function lookupRoom(code: string): Promise<{ langs: string[]; mine: string[] } | null> {
    const res = await fetch(`/api/meetings/${encodeURIComponent(code)}`)
    if (!res.ok) return null
    const data = await res.json()
    const langs = data.languages as string[]
    const prev = joinMyLangsRef.current
    const mine = (() => {
      const kept = prev.filter((l: string) => langs.includes(l))
      return kept.length > 0 ? kept : [langs[0]]
    })()
    setJoinLangs(langs)
    setJoinMyLangs(mine)
    return { langs, mine }
  }

  async function joinRoom() {
    setJoinError('')
    const code = joinCode.trim().toUpperCase()
    if (code.length !== 6) return setJoinError('Room codes are six characters.')
    if (!joinName.trim()) return setJoinError('Enter your name.')
    setJoining(true)
    try {
      localStorage.setItem('booth-name', joinName.trim())
    } catch {
      // ignore
    }
    try {
      let langs = joinLangs
      let mine = joinMyLangsRef.current
      if (!langs) {
        const found = await lookupRoom(code)
        if (!found) {
          setJoining(false)
          return setJoinError('No room with that code.')
        }
        langs = found.langs
        mine = found.mine
      }
      if (mine.length === 0) return setJoinError('Pick at least one language you understand.')
      await doJoin(code, joinName.trim(), mine)
    } catch {
      setJoinError('Network problem — try again.')
    } finally {
      setJoining(false)
    }
  }

  async function doJoin(code: string, name: string, myLanguages: string[]) {
    const res = await fetch(`/api/meetings/${encodeURIComponent(code)}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, language: myLanguages[0] }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Could not join.')
    onJoined({
      participantId: data.participantId,
      name,
      language: myLanguages[0],
      myLanguages,
      meeting: data.meeting,
    })
  }

  const totalMinutes = (usage?.engines ?? []).reduce((a, e) => a + e.minutes, 0)

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-hairline">
        <div className="mx-auto max-w-6xl px-5 h-14 flex items-center justify-between">
          <Wordmark />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-hairline text-[12px]"
              onClick={() => setSettingsOpen(true)}
            >
              Settings{!keyReady && <span className="text-warn">· add key</span>}
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {!keyReady && (
        <div className="border-b border-warn/40 bg-warn/10">
          <div className="mx-auto max-w-6xl px-5 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <span className="font-medium text-foreground">One step left:</span>
            <span className="text-muted-foreground">
              add the shared OpenAI key in Settings — set it once, and it works for the host and every guest.
            </span>
            <button
              className="ml-auto underline underline-offset-2 font-medium text-foreground hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onClick={() => setSettingsOpen(true)}
            >
              Open setup
            </button>
          </div>
        </div>
      )}

      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-5 pt-14 pb-16 grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
          {/* Hero */}
          <section>
            <h1 className="font-display font-extrabold tracking-tight text-foreground text-4xl sm:text-[3.4rem] leading-[1.06] max-w-[22ch]">
              Talk. Everyone hears their own language.
            </h1>
            <p className="mt-5 max-w-[58ch] text-[17px] leading-relaxed text-muted-foreground">
              Booth turns your browser into a live interpretation booth: translated voice and
              captions in up to four languages, running a few seconds behind the speaker —
              the way a human booth does. One shared key, set once, works for the host and
              every guest.
            </p>
            <div className="mt-8 max-w-xl">
              <CaptionReel />
            </div>
            <p className="mt-4 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
              Translated voice needs a moment to catch up — human interpreters run 2–3 s
              behind too. Captions appear sooner; the voice follows.
            </p>
          </section>

          {/* Create / Join — one console panel */}
          <section
            className="rounded-xl border border-hairline bg-card"
            aria-label="Open a room or join with a code"
          >
            <div className="grid xl:grid-cols-2">
            <div className="p-6">
              <h2 className="font-display text-xl font-bold tracking-tight">Open a room</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Pick the languages people will hear.
              </p>
              <div className="mt-5 space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="room-name" className="text-[13px] font-medium text-foreground">
                    Meeting name
                  </label>
                  <Input
                    id="room-name"
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    placeholder="Weekly product sync"
                    maxLength={80}
                  />
                </div>
                <div className="space-y-1.5">
                  <span className="text-[13px] font-medium text-foreground">
                    Languages <span className="text-muted-foreground font-normal">(up to four)</span>
                  </span>
                  <LanguageChipToggle selected={picked} onToggle={toggleLang} />
                  <LanguageLimitNote count={picked.length} />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="create-name" className="text-[13px] font-medium text-foreground">
                    Your name
                  </label>
                  <Input
                    id="create-name"
                    value={myName}
                    onChange={(e) => setMyName(e.target.value)}
                    placeholder="Priya"
                    maxLength={40}
                  />
                </div>
                <div className="space-y-1.5">
                  <span className="text-[13px] font-medium text-foreground">
                    I understand <span className="text-muted-foreground font-normal">(pick any)</span>
                  </span>
                  <LanguageMultiSelect
                    id="create-understand"
                    options={picked}
                    selected={myPicked}
                    onToggle={(code) =>
                      setMyPicked((prev) =>
                        prev.includes(code)
                          ? prev.length > 1
                            ? prev.filter((c) => c !== code)
                            : prev
                          : [...prev, code],
                      )
                    }
                    onPrimary={(code) =>
                      setMyPicked((prev) => [code, ...prev.filter((c) => c !== code)])
                    }
                  />
                </div>
                {createError && (
                  <p className="text-xs text-destructive" role="alert">{createError}</p>
                )}
                <Button
                  className="w-full h-10 bg-live hover:bg-live-deep text-primary-foreground"
                  onClick={createRoom}
                  disabled={creating}
                >
                  {creating ? 'Opening…' : 'Create room'}
                </Button>
              </div>
            </div>

              {/* seam between the panel halves on narrow screens */}
              <div className="relative border-t border-hairline xl:hidden" aria-hidden="true">
                <span className="absolute left-1/2 -translate-x-1/2 -top-2 bg-card px-3 text-[11px] text-muted-foreground">
                  or join with a code
                </span>
              </div>

              <div className="p-6 pt-8 xl:border-l xl:border-hairline xl:pt-6">
              <h2 className="font-display text-xl font-bold tracking-tight">Join a room</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Enter the six-character code from the host.
              </p>
              <div className="mt-5 space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="join-code" className="text-[13px] font-medium text-foreground">
                    Room code
                  </label>
                  <Input
                    id="join-code"
                    value={joinCode}
                    onChange={(e) => {
                      const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
                      setJoinCode(v)
                      setJoinLangs(null)
                      if (v.length === 6) void lookupRoom(v).then((ok) => {
                        if (!ok) setJoinError('No room with that code.')
                      })
                    }}
                    placeholder="K7M2XQ"
                    className="text-lg tracking-[0.3em] font-semibold"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="join-name" className="text-[13px] font-medium text-foreground">
                    Your name
                  </label>
                  <Input
                    id="join-name"
                    value={joinName}
                    onChange={(e) => setJoinName(e.target.value)}
                    placeholder="Karthik"
                    maxLength={40}
                  />
                </div>
                <div className="space-y-1.5">
                  <span className="text-[13px] font-medium text-foreground">
                    I understand <span className="text-muted-foreground font-normal">(pick any)</span>
                  </span>
                  {joinLangs ? (
                    <LanguageMultiSelect
                      id="join-understand"
                      options={joinLangs}
                      selected={joinMyLangs}
                      onToggle={(code) =>
                        setJoinMyLangs((prev) =>
                          prev.includes(code)
                            ? prev.length > 1
                              ? prev.filter((c) => c !== code)
                              : prev
                            : [...prev, code],
                        )
                      }
                      onPrimary={(code) =>
                        setJoinMyLangs((prev) => [code, ...prev.filter((c) => c !== code)])
                      }
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground h-10 flex items-center">
                      {joinCode.length === 6 ? 'Reading the room…' : 'The room’s languages appear here.'}
                    </p>
                  )}
                </div>
                {joinError && <p className="text-xs text-destructive" role="alert">{joinError}</p>}
                <Button
                  className="w-full h-10 bg-live hover:bg-live-deep text-primary-foreground"
                  onClick={joinRoom}
                  disabled={joining}
                >
                  {joining ? 'Joining…' : 'Join'}
                </Button>
              </div>
              </div>
            </div>
          </section>
        </div>

        {/* Console spec strip */}
        <section className="border-t border-hairline bg-card/60">
          <div className="mx-auto max-w-6xl px-5 py-10 grid gap-8 md:grid-cols-3">
            <div>
              <p className="font-display text-[15px] font-bold tracking-tight text-foreground">Set up once</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
                The host pastes the shared OpenAI key in Settings — it lives on the Booth
                server, and every guest uses it automatically. No per-device setup.
              </p>
            </div>
            <div className="md:border-l md:border-hairline md:pl-5">
              <p className="font-display text-[15px] font-bold tracking-tight text-foreground">Booth listens</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
                Use your microphone in the room, or share a meeting tab so Booth hears the
                call audio directly. Speech becomes translated voice and captions in your
                language.
              </p>
            </div>
            <div className="md:border-l md:border-hairline md:pl-5">
              <p className="font-display text-[15px] font-bold tracking-tight text-foreground">Fastest path first</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
                gpt-realtime-translate speaks in about a second. Where it is not available,
                a cascade of transcription, translation and speech keeps every language
                covered.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="mt-auto border-t border-hairline">
        <div className="mx-auto max-w-6xl px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${keyReady ? 'bg-live' : 'bg-warn'}`}
            />
            {keyReady ? 'Shared key active — everyone can interpret' : 'Add the shared OpenAI key in Settings to start'}
          </span>
          <button
            className="underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={() => setSettingsOpen(true)}
          >
            {keyReady ? 'Manage the shared API key' : 'Set up the shared API key'}
          </button>
          {usage && totalMinutes > 0 && (
            <span>Interpreted {totalMinutes.toFixed(1)} min in the last 24 h</span>
          )}
          <span className="ml-auto">
            English, 中文, हिन्दी, தமிழ் and {LANGUAGES.length - 4} more
          </span>
        </div>
      </footer>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
