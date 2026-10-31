'use client'

/**
 * Booth settings — ONE shared API setup for the whole deployment.
 *
 * The OpenAI key is set here ONCE (by whoever deploys or hosts) and stored
 * on the Booth server. Every participant — host and guests — then uses it
 * automatically; nobody configures a key per device, and the raw key is
 * never shown or sent back to any browser.
 *
 * The form lives in an inner component so its local state re-initialises
 * from the server every time the dialog opens.
 */
import { useCallback, useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  LLM_MODELS,
  STT_MODELS,
  TTS_MODELS,
  TTS_VOICES,
  looksLikeOpenAiKey,
  saveBoothSettings,
  useBoothSettings,
  type BoothSettings,
  type EngineMode,
} from '@/lib/booth/settings-store'
import { refreshSharedConfig, useSharedConfig } from '@/lib/booth/config-store'

const ENGINE_OPTIONS: Array<{ id: EngineMode; label: string; hint: string }> = [
  {
    id: 'auto',
    label: 'Automatic (recommended)',
    hint: 'Speech-to-speech when the language is supported, cascade everywhere else.',
  },
  {
    id: 's2s',
    label: 'Speech-to-speech only',
    hint: 'gpt-realtime-translate over WebRTC — first voice in ~0.7–1.8 s.',
  },
  {
    id: 'cascade',
    label: 'Cascade',
    hint: 'Transcribe, translate, then speak — voice in ~2.5–4 s.',
  },
  {
    id: 'captions',
    label: 'Captions only',
    hint: 'Translated captions, no voice output.',
  },
]

function SelectField({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ id: string; label: string }>
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[13px]">{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-input bg-card px-2.5 text-[13px] text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold tracking-tight">
            Booth settings
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">
            One API setup for everyone: the key saved here works for the host and every
            guest automatically — no per-device configuration.
          </DialogDescription>
        </DialogHeader>
        {open && <SettingsForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function SettingsForm({ onDone }: { onDone: () => void }) {
  const settings = useBoothSettings()
  const shared = useSharedConfig()
  const [keyValue, setKeyValue] = useState('')
  const [keyState, setKeyState] = useState<'idle' | 'checking' | 'ok' | 'bad'>('idle')
  const [keyMsg, setKeyMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [engine, setEngine] = useState<EngineMode>(settings.engine)
  const [voiceOut, setVoiceOut] = useState(settings.voiceOut)
  const [ttsVoice, setTtsVoice] = useState(settings.ttsVoice)
  const [sttModel, setSttModel] = useState(settings.sttModel)
  const [llmModel, setLlmModel] = useState(settings.llmModel)
  const [ttsModel, setTtsModel] = useState(settings.ttsModel)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void refreshSharedConfig()
  }, [])

  /** Save the shared key once — it then works for host AND all guests. */
  async function saveKey() {
    const key = keyValue.trim()
    if (!looksLikeOpenAiKey(key)) {
      setKeyState('bad')
      setKeyMsg('That does not look like an OpenAI key (expected sk-…).')
      return
    }
    setBusy(true)
    setKeyMsg('')
    try {
      const r = await fetch('/api/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key }),
      })
      const d = await r.json().catch(() => null)
      if (r.ok) {
        setKeyState('ok')
        setKeyMsg('Key saved — everyone in this Booth now uses it automatically.')
        setKeyValue('')
        await refreshSharedConfig()
        // verify the saved key against the realtime endpoint
        const v = await fetch('/api/realtime-token', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ language: 'en' }),
        })
        if (!v.ok) {
          const vd = await v.json().catch(() => null)
          setKeyState('bad')
          setKeyMsg(
            vd?.error
              ? `Saved, but OpenAI rejected it: ${String(vd.error).slice(0, 140)}`
              : `Saved, but verification failed (${v.status}).`,
          )
        }
      } else {
        setKeyState('bad')
        setKeyMsg(d?.error ? String(d.error).slice(0, 160) : `Could not save (${r.status}).`)
      }
    } catch {
      setKeyState('bad')
      setKeyMsg('Network problem while saving — try again.')
    } finally {
      setBusy(false)
    }
  }

  /** Explicit verify of whatever key is already saved on the server. */
  const verifySaved = useCallback(async () => {
    setBusy(true)
    setKeyMsg('')
    setKeyState('checking')
    try {
      const r = await fetch('/api/realtime-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ language: 'en' }),
      })
      if (r.ok) {
        setKeyState('ok')
        setKeyMsg('Verified — speech-to-speech is ready for everyone.')
      } else {
        const d = await r.json().catch(() => null)
        setKeyState('bad')
        setKeyMsg(d?.error ? String(d.error).slice(0, 160) : `Verification failed (${r.status}).`)
      }
    } catch {
      setKeyState('bad')
      setKeyMsg('Network problem while verifying.')
    } finally {
      setBusy(false)
    }
  }, [])

  async function removeKey() {
    setBusy(true)
    try {
      await fetch('/api/config', { method: 'DELETE' })
      await refreshSharedConfig()
      setKeyState('idle')
      setKeyMsg('Shared key removed.')
    } finally {
      setBusy(false)
    }
  }

  function save() {
    const patch: Partial<BoothSettings> = {
      engine,
      voiceOut,
      ttsVoice,
      sttModel,
      llmModel,
      ttsModel,
    }
    saveBoothSettings(patch)
    setSaved(true)
    setTimeout(onDone, 450)
  }

  const engineHint = ENGINE_OPTIONS.find((o) => o.id === engine)?.hint

  return (
    <div className="space-y-4">
      {/* Shared OpenAI key — one setup for the whole deployment */}
      <div className="space-y-1.5">
        <Label htmlFor="openai-key" className="text-[13px]">
          OpenAI API key{' '}
          <span className="font-normal text-muted-foreground">
            {shared.configured ? `· shared ${shared.hint}` : '· not set yet'}
          </span>
        </Label>
        <div className="flex gap-2">
          <Input
            id="openai-key"
            type="password"
            value={keyValue}
            onChange={(e) => {
              setKeyValue(e.target.value)
              setKeyState('idle')
              setKeyMsg('')
            }}
            placeholder={shared.configured ? 'Paste a new key to replace it' : 'sk-…'}
            autoComplete="off"
            aria-label="OpenAI API key"
          />
          <Button
            size="sm"
            className="h-9 bg-live hover:bg-live-deep text-primary-foreground shrink-0"
            onClick={() => void saveKey()}
            disabled={busy || !looksLikeOpenAiKey(keyValue.trim())}
          >
            {busy && keyState !== 'bad' ? 'Saving…' : 'Save for everyone'}
          </Button>
        </div>
        {keyMsg && (
          <p
            className={`text-xs ${keyState === 'bad' ? 'text-destructive' : 'text-muted-foreground'}`}
            role={keyState === 'bad' ? 'alert' : undefined}
          >
            {keyMsg}
          </p>
        )}
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          {shared.configured
            ? 'A key is already active for all participants. '
            : 'Set it once here — after that, guests just open a link and it works. '}
          The key is stored on the Booth server and never shown again.
        </p>
        {shared.configured && (
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="h-7 text-[12px] border-hairline" onClick={() => void verifySaved()} disabled={busy}>
              Test the saved key
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-[12px] text-destructive hover:text-destructive" onClick={() => void removeKey()} disabled={busy}>
              Remove
            </Button>
          </div>
        )}
      </div>

      {/* Engine */}
      <div className="space-y-1.5">
        <Label className="text-[13px]">Interpretation engine</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Engine mode">
          {ENGINE_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={engine === o.id}
              onClick={() => setEngine(o.id)}
              className={`rounded-lg border px-3 py-2 text-left text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                engine === o.id
                  ? 'border-live bg-live/10 text-foreground'
                  : 'border-border bg-card text-muted-foreground hover:border-input hover:text-foreground'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {engineHint && <p className="text-[11.5px] text-muted-foreground leading-relaxed">{engineHint}</p>}
        <p className="text-[11px] text-muted-foreground">
          Engine, voice and model choices are personal to this device; the API key is shared.
        </p>
      </div>

      {/* Voice output */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-hairline px-3 py-2.5">
        <div>
          <Label htmlFor="voice-out" className="text-[13px]">Translated voice</Label>
          <p className="text-[11.5px] text-muted-foreground">Captions always run.</p>
        </div>
        <Switch id="voice-out" checked={voiceOut} onCheckedChange={setVoiceOut} />
      </div>

      <SelectField
        id="tts-voice"
        label="Cascade voice"
        value={ttsVoice}
        onChange={setTtsVoice}
        options={TTS_VOICES}
      />

      {/* Advanced */}
      <div>
        <button
          type="button"
          className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? 'Hide advanced model settings' : 'Advanced: cascade models'}
        </button>
        {showAdvanced && (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <SelectField id="stt-model" label="Speech-to-text" value={sttModel} onChange={setSttModel} options={STT_MODELS} />
            <SelectField id="llm-model" label="Translation" value={llmModel} onChange={setLlmModel} options={LLM_MODELS} />
            <SelectField id="tts-model" label="Text-to-speech" value={ttsModel} onChange={setTtsModel} options={TTS_MODELS} />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-hairline pt-3">
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          Voice runs a few seconds behind the speaker — like a human booth. Captions
          arrive first.
        </p>
        <Button
          size="sm"
          className="bg-live hover:bg-live-deep text-primary-foreground shrink-0"
          onClick={save}
        >
          {saved ? 'Saved ✓' : 'Save preferences'}
        </Button>
      </div>
    </div>
  )
}
