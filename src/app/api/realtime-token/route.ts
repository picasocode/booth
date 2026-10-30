import { NextRequest, NextResponse } from 'next/server'

/**
 * Fallback for the browser's direct call to OpenAI's client-secret endpoint.
 * The browser always tries api.openai.com first (all configuration lives in
 * the UI); if that request is ever blocked, it retries through this route,
 * which simply forwards it. Keys come from the request body (the user's own
 * key from the settings UI) or the optional OPENAI_API_KEY environment
 * variable. Nothing is stored.
 */
export async function POST(req: NextRequest) {
  let body: { key?: string; language?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }

  const key = (body.key ?? process.env.OPENAI_API_KEY ?? '').trim()
  const language = String(body.language ?? 'en').slice(0, 8)
  if (!key) {
    return NextResponse.json(
      { error: 'No OpenAI key — add one in the Booth settings.' },
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
