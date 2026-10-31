'use client'

/**
 * The one orchestrated moment on the home page: a caption console that
 * demonstrates the product's core experience — a speaker line appears first,
 * the interpreted line follows with a measured "behind" chip. Loops through
 * four real examples; rendered statically under prefers-reduced-motion.
 */
import { useEffect, useState } from 'react'
import { LANG_MAP } from '@/lib/booth/languages'

const REEL = [
  {
    speaker: 'Priya',
    src: 'en',
    source: 'The launch slips to the eighteenth, so I will send the revised plan this afternoon.',
    tgt: 'hi',
    target: 'लॉन्च अठारह तारीख को खिसक गया है, इसलिए मैं दोपहर में नया प्लान भेजूँगा।',
    behind: 3.8,
  },
  {
    speaker: 'Karthik',
    src: 'ta',
    source: 'நாளை மதிப்பாய்வில் வெளியீட்டு தேதி குறித்து விவாதிப்போகிறோம்.',
    tgt: 'en',
    target: "We'll discuss the release date in tomorrow's review.",
    behind: 3.1,
  },
  {
    speaker: 'Chen Wei',
    src: 'zh',
    source: '预算批下来了，下周一可以开始采购。',
    tgt: 'en',
    target: 'The budget is approved, so purchasing can start next Monday.',
    behind: 2.9,
  },
  {
    speaker: 'Amara',
    src: 'en',
    source: 'Can the Chennai team join the four o’clock demo?',
    tgt: 'ja',
    target: 'チェンナイチームは4時のデモに参加できますか？',
    behind: 3.4,
  },
]

const STEP_MS = 1100 // source shows, then target
const HOLD_MS = 3400

export function CaptionReel() {
  const [idx, setIdx] = useState(0)
  const [showTarget, setShowTarget] = useState(false)
  const [staticMode, setStaticMode] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStaticMode(true)
      setShowTarget(true)
      return
    }
    let i = 0
    let t1: ReturnType<typeof setTimeout>
    let t2: ReturnType<typeof setTimeout>
    const cycle = () => {
      setIdx(i % REEL.length)
      setShowTarget(false)
      t1 = setTimeout(() => {
        setShowTarget(true)
        t2 = setTimeout(() => {
          i++
          cycle()
        }, HOLD_MS)
      }, STEP_MS + 400)
    }
    cycle()
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])

  const item = staticMode ? REEL[0] : REEL[idx]

  return (
    <div
      className="w-full rounded-xl border border-hairline bg-card overflow-hidden"
      role="img"
      aria-label="Example of live captions: a speaker's words appear in the original language, then the interpretation arrives a few seconds behind."
    >
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">Live captions</span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="booth-pulse h-1.5 w-1.5 rounded-full bg-live" aria-hidden />
          interpreting
        </span>
      </div>
      <div className="px-4 py-3.5 space-y-2 min-h-[7.2rem]" key={staticMode ? 'static' : idx}>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: LANG_MAP[item.src]?.dot ?? '#888' }}
          />
          <span className="font-medium text-foreground/80">{item.speaker}</span>
          <span>{LANG_MAP[item.src]?.name}</span>
        </div>
        <p className="font-caption text-[13px] leading-relaxed text-muted-foreground booth-settle">
          {item.source}
        </p>
        <p className="font-caption text-[17px] leading-relaxed font-medium text-foreground">
          {staticMode || showTarget ? (
            <span className="booth-settle">{item.target}</span>
          ) : (
            <span className="text-muted-foreground/70 italic">interpreting…</span>
          )}
        </p>
        {(staticMode || showTarget) && (
          <p className="text-[11px] text-warn pt-0.5">voice {item.behind.toFixed(1)} s behind</p>
        )}
      </div>
    </div>
  )
}
