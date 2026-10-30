'use client'

import { LANGUAGES, LANG_MAP, MAX_ROOM_LANGUAGES } from '@/lib/booth/languages'
import { cn } from '@/lib/utils'

function Dot({ color }: { color: string }) {
  return <span aria-hidden className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
}

export function LanguageChipToggle({
  selected,
  onToggle,
  disabled,
}: {
  selected: string[]
  onToggle: (code: string) => void
  disabled?: string[]
}) {
  return (
    <div
      className="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1 [scrollbar-width:thin]"
      role="group"
      aria-label="Room languages"
    >
      {LANGUAGES.map((l) => {
        const isOn = selected.includes(l.code)
        const isBlocked = !isOn && disabled?.includes(l.code)
        return (
          <button
            key={l.code}
            type="button"
            aria-pressed={isOn}
            disabled={isBlocked}
            onClick={() => onToggle(l.code)}
            title={
              l.asr === 'good' && l.voice === 'good'
                ? 'Voice and captions supported'
                : 'Captions supported; voice may be captions-only'
            }
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-full border px-2.5 text-[13px] transition-colors min-w-0 justify-start',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              isOn
                ? 'border-live bg-live/10 text-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-input hover:text-foreground',
              isBlocked && 'opacity-40 cursor-not-allowed',
            )}
          >
            <Dot color={l.dot} />
            <span className="font-caption truncate">{l.native}</span>
            {l.voice === 'no' && (
              <span className="text-[10px] text-muted-foreground border border-border rounded px-0.5 shrink-0">
                cc
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function LanguageSelect({
  value,
  onChange,
  options,
  id,
}: {
  value: string
  onChange: (code: string) => void
  options: string[]
  id: string
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
    >
      {options.map((code) => (
        <option key={code} value={code}>
          {LANG_MAP[code]?.native ?? code} — {LANG_MAP[code]?.name ?? code}
        </option>
      ))}
    </select>
  )
}

export function LanguageLimitNote({ count }: { count: number }) {
  if (count <= MAX_ROOM_LANGUAGES) return null
  return (
    <p className="text-xs text-destructive" role="alert">
      Four languages is the limit — drop one to add another.
    </p>
  )
}
