'use client'

import { LANG_MAP } from '@/lib/booth/languages'
import { Settings } from 'lucide-react'
import { SettingsDialog } from '@/components/booth/SettingsDialog'
import { useSharedConfig } from '@/lib/booth/config-store'
import { useState } from 'react'

export interface ParticipantView {
  participantId: string
  name: string
  language: string
  micOn: boolean
}

function Dot({ color }: { color: string }) {
  return <span aria-hidden className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
}

/** Five-bar level meter driven by live RMS samples. */
export function VuBars({ rms, live }: { rms: number; live: boolean }) {
  const level = Math.min(5, Math.round(rms * 55))
  return (
    <span className="inline-flex items-end gap-[3px] h-4" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`w-[3px] rounded-sm transition-colors duration-100 ${
            live && i < level ? 'bg-live' : 'bg-border'
          }`}
          style={{ height: `${5 + i * 2.5}px` }}
        />
      ))}
    </span>
  )
}

export function SpeakerRow({
  p,
  isMe,
  rms,
}: {
  p: ParticipantView
  isMe: boolean
  rms: number
}) {
  const lang = LANG_MAP[p.language]
  return (
    <div className="flex items-center gap-2.5 py-2">
      <Dot color={lang?.dot ?? '#888'} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">
          {p.name}
          {isMe && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">you</span>}
        </p>
      </div>
      <VuBars rms={rms} live={rms > 0.005} />
    </div>
  )
}

/**
 * Status strip for the device's own interpretation lane: which engine is
 * running, into which language, plus a settings shortcut.
 */
export function EngineStrip({
  engine,
  targetLang,
  status,
}: {
  engine: string | null
  targetLang: string
  status: 'idle' | 'connecting' | 'live' | 'error'
}) {
  const target = LANG_MAP[targetLang]
  const label = engine === 's2s' ? 'gpt-realtime-translate' : engine === 'cascade' ? 'cascade' : 'not running'
  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5 overflow-x-auto" aria-label="Interpretation status">
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        <span className="font-medium text-foreground">{target?.native ?? targetLang}</span>
        <span className="mx-1.5 text-border" aria-hidden>→</span>
        your interpretation
      </span>
      <span
        className={`inline-flex items-center gap-1.5 rounded-md border border-hairline px-1.5 py-0.5 text-[11px] whitespace-nowrap ${
          status === 'live' ? 'text-foreground' : 'text-muted-foreground'
        }`}
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${
            status === 'live' ? 'bg-live booth-pulse' : status === 'error' ? 'bg-warn' : 'bg-border'
          }`}
        />
        {label}
      </span>
    </div>
  )
}

export function CaptionEntry({
  name,
  sourceLang,
  sourceText,
  targetText,
  targetLang,
  lagMs,
}: {
  name: string
  sourceLang: string
  sourceText: string
  targetText?: string
  /** Set when this entry is an extra caption language (no voice). */
  targetLang?: string
  lagMs?: number
}) {
  const lang = targetLang ? LANG_MAP[targetLang] : LANG_MAP[sourceLang]
  return (
    <article className="px-5 py-3 border-b border-hairline/70 last:border-b-0">
      <header className="flex items-center gap-2 mb-1">
        <Dot color={lang?.dot ?? '#888'} />
        {targetLang ? (
          <span className="text-xs font-medium text-foreground/80">
            {lang?.native ?? targetLang}
            <span className="ml-1.5 text-[10px] font-normal text-muted-foreground border border-border rounded px-1">
              captions
            </span>
          </span>
        ) : (
          <>
            <span className="text-xs font-medium text-foreground/80">{name}</span>
            <span className="text-[11px] text-muted-foreground">
              {lang?.name ?? (sourceLang === 'auto' ? 'auto-detected' : sourceLang)}
            </span>
          </>
        )}
        {lagMs !== undefined && lagMs > 0 && targetText && !targetLang && (
          <span className="ml-auto text-[11px] text-warn">
            voice {(lagMs / 1000).toFixed(1)} s behind
          </span>
        )}
      </header>
      <p className="font-caption text-[17px] leading-relaxed font-medium text-foreground">
        {targetText ?? <span className="text-muted-foreground/60 italic">interpreting…</span>}
      </p>
      {!targetLang && sourceText && (
        <p className="font-caption mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
          {sourceText}
        </p>
      )}
    </article>
  )
}

/** Settings chip shown in the room header — opens the settings dialog. */
export function SettingsChip() {
  const [open, setOpen] = useState(false)
  const shared = useSharedConfig()
  return (
    <>
      <button
        className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 h-7 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label="Open Booth settings"
        onClick={() => setOpen(true)}
      >
        <Settings className="h-3 w-3" aria-hidden />
        settings{!shared.configured && <span className="text-warn">· key needed</span>}
      </button>
      <SettingsDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
