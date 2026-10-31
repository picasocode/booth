import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clearSharedKey, looksLikeOpenAiKey, maskKey, saveSharedKey } from '@/lib/booth/server-key'

export const dynamic = 'force-dynamic'

/**
 * Shared Booth API configuration — set ONCE, used by everyone.
 *
 * GET    → { configured, hint, source }   (never the raw key)
 * POST   { key } → saves the shared key for the whole deployment
 * DELETE → clears it
 *
 * Guests never touch this route: they just join a room and interpretation
 * works with the key the host already saved.
 */
export async function GET() {
  try {
    const row = await db.appConfig.findUnique({
      where: { id: 'booth' },
      select: { openaiKey: true },
    })
    if (row?.openaiKey) {
      return NextResponse.json({ configured: true, hint: maskKey(row.openaiKey), source: 'db' })
    }
  } catch {
    // table missing on a cold deployment — fall through to env check
  }
  if (process.env.OPENAI_API_KEY) {
    return NextResponse.json({ configured: true, hint: 'key from server environment', source: 'env' })
  }
  return NextResponse.json({ configured: false, hint: '', source: 'none' })
}

export async function POST(req: NextRequest) {
  let body: { key?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }
  const key = (body.key ?? '').trim()
  if (!looksLikeOpenAiKey(key)) {
    return NextResponse.json(
      { error: 'That does not look like an OpenAI key (expected sk-…, at least 20 characters).' },
      { status: 400 },
    )
  }
  try {
    await saveSharedKey(key)
  } catch (e) {
    return NextResponse.json(
      { error: `Could not save: ${(e as Error).message.slice(0, 120)}` },
      { status: 500 },
    )
  }
  return NextResponse.json({ configured: true, hint: maskKey(key), source: 'db' })
}

export async function DELETE() {
  try {
    await clearSharedKey()
  } catch (e) {
    return NextResponse.json(
      { error: `Could not remove: ${(e as Error).message.slice(0, 120)}` },
      { status: 500 },
    )
  }
  return NextResponse.json({ configured: Boolean(process.env.OPENAI_API_KEY), hint: '', source: 'none' })
}
