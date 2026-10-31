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
            {isOn && (
              <span
                aria-hidden="true"
                className="ml-auto inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[4px] border border-live/40 bg-live/10 px-1 text-[9px] font-semibold text-live-deep dark:text-live"
              >
                {selected.indexOf(l.code) + 1}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * "I understand" multi-select: the FIRST language (or the one chosen in the
 * voice dropdown) gets the translated voice; every other selected language
 * shows as live captions.
 */
export function LanguageMultiSelect({
  id,
  options,
  selected,
  onToggle,
  onPrimary,
}: {
  id: string
  options: string[]
  /** Primary-first list of understood languages. */
  selected: string[]
  onToggle: (code: string) => void
  onPrimary: (code: string) => void
}) {
  const primary = selected[0]
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Languages you understand">
        {options.map((code) => {
          const isOn = selected.includes(code)
          const isPrimary = isOn && code === primary
          return (
            <button
              key={code}
              type="button"
              aria-pressed={isOn}
              onClick={() => onToggle(code)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors min-w-0',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                isOn
                  ? 'border-live bg-live/10 text-foreground'
                  : 'border-border bg-card text-muted-foreground hover:border-input hover:text-foreground',
              )}
            >
              <Dot color={LANG_MAP[code]?.dot ?? '#888'} />
              <span className="font-caption truncate">{LANG_MAP[code]?.native ?? code}</span>
              {isPrimary && (
                <span className="text-[9.5px] font-medium text-live border border-live/40 rounded px-1 shrink-0">
                  voice
                </span>
              )}
              {isOn && !isPrimary && (
                <span className="text-[9.5px] text-muted-foreground border border-border rounded px-1 shrink-0">
                  cc
                </span>
              )}
            </button>
          )
        })}
      </div>
      {selected.length > 1 ? (
        <select
          id={id}
          value={primary}
          onChange={(e) => onPrimary(e.target.value)}
          aria-label="Which language do you hear spoken"
          className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[12.5px] text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        >
          {selected.map((code) => (
            <option key={code} value={code}>
              Voice in {LANG_MAP[code]?.native ?? code} — captions keep running in the rest
            </option>
          ))}
        </select>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {selected.length === 0
            ? 'Pick at least one language.'
            : 'Add more languages to also get captions in them.'}
        </p>
      )}
    </div>
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
