import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/** Room details + who is in the room right now. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params
  const meeting = await db.meeting.findUnique({
    where: { code: code.toUpperCase() },
    include: {
      participants: { orderBy: { lastSeenAt: 'desc' }, take: 24 },
    },
  })
  if (!meeting) return NextResponse.json({ error: 'No room with that code.' }, { status: 404 })
  return NextResponse.json({
    id: meeting.id,
    code: meeting.code,
    name: meeting.name,
    languages: JSON.parse(meeting.languages) as string[],
    participantCount: meeting.participants.length,
    participants: meeting.participants.map((p) => ({
      participantId: p.id,
      name: p.name,
      language: p.language,
      micOn: true,
      lastSeenAt: p.lastSeenAt.toISOString(),
    })),
  })
}

/** Heartbeat: refresh presence (and language) for one participant. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params
  let body: { participantId?: string; language?: string } = {}
  try {
    body = await req.json()
  } catch {
    // heartbeat tolerates an empty body
  }
  const meeting = await db.meeting.findUnique({ where: { code: code.toUpperCase() } })
  if (!meeting) return NextResponse.json({ error: 'No room with that code.' }, { status: 404 })

  if (body.participantId) {
    const data: { lastSeenAt: Date; language?: string } = { lastSeenAt: new Date() }
    if (body.language) data.language = String(body.language).slice(0, 8)
    await db.participant
      .updateMany({
        where: { id: body.participantId, meetingId: meeting.id },
        data,
      })
      .catch(() => null)
  }

  const participants = await db.participant.findMany({
    where: { meetingId: meeting.id },
    orderBy: { lastSeenAt: 'desc' },
    take: 24,
  })
  return NextResponse.json({
    ok: true,
    participants: participants.map((p) => ({
      participantId: p.id,
      name: p.name,
      language: p.language,
      micOn: true,
      lastSeenAt: p.lastSeenAt.toISOString(),
    })),
  })
}
