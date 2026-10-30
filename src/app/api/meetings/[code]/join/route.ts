import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { LANG_MAP } from '@/lib/booth/languages'

export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await ctx.params
    const body = await req.json()
    const name = String(body.name ?? '').trim().slice(0, 40)
    const language = String(body.language ?? '')

    if (!name) return NextResponse.json({ error: 'Enter your name.' }, { status: 400 })

    const meeting = await db.meeting.findUnique({ where: { code: code.toUpperCase() } })
    if (!meeting) return NextResponse.json({ error: 'No room with that code.' }, { status: 404 })

    const languages = JSON.parse(meeting.languages) as string[]
    // guide §4: the 4-language limit is enforced at meeting creation AND at join
    if (!languages.includes(language)) {
      return NextResponse.json(
        { error: `${LANG_MAP[language]?.name ?? language} is not one of this room's languages.` },
        { status: 400 },
      )
    }

    const participant = await db.participant.create({
      data: { meetingId: meeting.id, name, language },
    })
    return NextResponse.json({
      participantId: participant.id,
      meeting: {
        id: meeting.id,
        code: meeting.code,
        name: meeting.name,
        languages,
      },
    })
  } catch (e) {
    console.error('join failed', e)
    return NextResponse.json({ error: 'Could not join. Try again.' }, { status: 500 })
  }
}
