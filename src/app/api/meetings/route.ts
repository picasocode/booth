import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { LANG_MAP, MAX_ROOM_LANGUAGES } from '@/lib/booth/languages'

function makeCode(): string {
  // unambiguous room codes: no 0/O, 1/I
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
  let s = ''
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return s
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const name = String(body.name ?? '').trim().slice(0, 80) || 'Untitled meeting'
    const languages: unknown[] = Array.isArray(body.languages) ? body.languages : []

    if (languages.length < 2) {
      return NextResponse.json({ error: 'Pick at least two languages.' }, { status: 400 })
    }
    if (languages.length > MAX_ROOM_LANGUAGES) {
      return NextResponse.json(
        { error: `A room can have at most ${MAX_ROOM_LANGUAGES} languages.` },
        { status: 400 },
      )
    }
    const unique = [...new Set(languages.map(String))]
    for (const l of unique) {
      if (!LANG_MAP[l]) return NextResponse.json({ error: `Unknown language: ${l}` }, { status: 400 })
    }

    let code = makeCode()
    for (let i = 0; i < 5; i++) {
      const exists = await db.meeting.findUnique({ where: { code } })
      if (!exists) break
      code = makeCode()
    }

    const meeting = await db.meeting.create({
      data: { code, name, languages: JSON.stringify(unique) },
    })
    return NextResponse.json({
      id: meeting.id,
      code: meeting.code,
      name: meeting.name,
      languages: unique,
    })
  } catch (e) {
    console.error('create meeting failed', e)
    return NextResponse.json({ error: 'Could not create the room. Try again.' }, { status: 500 })
  }
}
