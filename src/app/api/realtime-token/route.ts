import { NextRequest, NextResponse } from 'next/server'
import { getSharedKey } from '@/lib/booth/server-key'

/**
 * Speech-to-speech entry point — returns a short-lived realtime client
 * secret to ANY participant, using the ONE shared key saved by the host.
 * No per-device key is needed; the raw key never leaves the server.
 * A key in the request body is still accepted as an explicit override
 * (used by the settings dialog to verify a candidate key before saving).
 */
export async function POST(req: NextRequest) {
  let body: { key?: string; language?: string } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const key = (body.key ?? '').trim() || (await getSharedKey())
  const language = String(body.language ?? 'en').slice(0, 8)
  if (!key) {
    return NextResponse.json(
      { error: 'No shared OpenAI key — add one in the Booth settings (set once, works for everyone).' },
      { status: 400 },
    )
  }

  try {
    const r = await fetch('https://api.openai.com/v1/realtime/translations/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        session: {
          model: 'gpt-realtime-translate',
          audio: { output: { language } },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const data = await r.json().catch(() => null)
    if (!r.ok) {
      const detail =
        data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)
          ? JSON.stringify((data as Record<string, unknown>).error).slice(0, 220)
          : `upstream ${r.status}`
      return NextResponse.json({ error: detail }, { status: r.status })
    }
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json(
      { error: `upstream unreachable: ${(e as Error).message.slice(0, 140)}` },
      { status: 502 },
    )
  }
}
