import { NextRequest, NextResponse } from 'next/server'
import { getSharedKey } from '@/lib/booth/server-key'

export const dynamic = 'force-dynamic'

/**
 * Same-app proxy to api.openai.com that injects the ONE shared key.
 * Guests never see or send any key — their cascade calls
 * (transcribe → translate → speak) go through here and the server adds
 * the shared key. Only the endpoints Booth needs are allowed.
 *
 * Latency impact is a single same-region hop (tens of ms) — negligible
 * against the 2–4 s cascade budget and the 0.7–1.8 s realtime path
 * (which still streams audio peer-to-peer over WebRTC).
 */
const ALLOWED = new Set([
  'audio/transcriptions',
  'audio/speech',
  'chat/completions',
  'realtime/translations/client_secrets',
])

async function proxy(req: NextRequest, path: string) {
  if (!ALLOWED.has(path)) {
    return NextResponse.json({ error: 'endpoint not allowed' }, { status: 404 })
  }
  const key = await getSharedKey()
  if (!key) {
    return NextResponse.json(
      { error: 'No shared OpenAI key — ask the host to add one in Booth settings.' },
      { status: 400 },
    )
  }

  const headers: HeadersInit = { Authorization: `Bearer ${key}` }
  const init: RequestInit = { method: req.method, headers }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const ct = req.headers.get('content-type') ?? ''
    headers['content-type'] = ct || 'application/json'
    init.body = await req.arrayBuffer()
  }

  try {
    const upstream = await fetch(`https://api.openai.com/v1/${path}`, {
      ...init,
      signal: AbortSignal.timeout(60_000),
    })
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: `OpenAI unreachable: ${(e as Error).message.slice(0, 140)}` },
      { status: 502 },
    )
  }
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params
  return proxy(req, path.join('/'))
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params
  return proxy(req, path.join('/'))
}
