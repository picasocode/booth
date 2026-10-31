'use client'

import { useCallback } from 'react'
import { HomeView, type JoinResult } from '@/components/booth/HomeView'
import { RoomView } from '@/components/booth/RoomView'
import { useSession, storeSession, type BoothSession } from '@/components/booth/session-store'

export type { BoothSession }

export function BoothApp() {
  const session = useSession()

  const enterRoom = useCallback((result: JoinResult) => {
    storeSession({
      code: result.meeting.code,
      meetingId: result.meeting.id,
      participantId: result.participantId,
      name: result.name,
      language: result.language,
      myLanguages: result.myLanguages,
      meetingName: result.meeting.name,
      languages: result.meeting.languages,
    })
  }, [])

  const leaveRoom = useCallback(() => {
    storeSession(null)
  }, [])

  return session ? (
    <RoomView session={session} onLeave={leaveRoom} />
  ) : (
    <HomeView onJoined={enterRoom} prefillCode={prefillCode()} />
  )
}

function prefillCode(): string {
  if (typeof window === 'undefined') return ''
  const m = new URLSearchParams(window.location.search).get('room')
  return m ? m.toUpperCase().slice(0, 6) : ''
}
