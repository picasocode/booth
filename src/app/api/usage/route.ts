import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface Row {
  meetingId: string
  engine: string
  sourceLang: string
  targetLang: string
  seconds: number
  costUsd: number
}

/** Called by the relay (server-to-server over localhost) with metered sessions. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const rows: Row[] = Array.isArray(body.rows) ? body.rows : []
    const valid = rows.filter(
      (r) => r && typeof r.meetingId === 'string' && typeof r.seconds === 'number' && r.seconds > 0,
    )
    if (valid.length > 0) {
      await db.usageLog.createMany({
        data: valid.map((r) => ({
          meetingId: r.meetingId,
          engine: String(r.engine).slice(0, 16),
          sourceLang: String(r.sourceLang).slice(0, 8),
          targetLang: String(r.targetLang).slice(0, 8),
          seconds: r.seconds,
          costUsd: Number(r.costUsd) || 0,
        })),
      })
    }
    return NextResponse.json({ ok: true, stored: valid.length })
  } catch (e) {
    console.error('usage post failed', e)
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }
}

/** Totals for the usage panel: last 24 h and per engine. */
export async function GET() {
  const since = new Date(Date.now() - 24 * 3600_000)
  const logs = await db.usageLog.findMany({ where: { createdAt: { gte: since } } })
  const byEngine = new Map<string, { seconds: number; costUsd: number; sessions: number }>()
  for (const l of logs) {
    const cur = byEngine.get(l.engine) ?? { seconds: 0, costUsd: 0, sessions: 0 }
    cur.seconds += l.seconds
    cur.costUsd += l.costUsd
    cur.sessions += 1
    byEngine.set(l.engine, cur)
  }
  return NextResponse.json({
    since,
    engines: [...byEngine.entries()].map(([engine, v]) => ({
      engine,
      minutes: Math.round((v.seconds / 60) * 10) / 10,
      costUsd: Math.round(v.costUsd * 100) / 100,
      sessions: v.sessions,
    })),
  })
}
