'use client'

import { useSyncExternalStore } from 'react'

export interface BoothSession {
  code: string
  meetingId: string
  participantId: string
  name: string
  /** Primary language — the one you hear spoken. */
  language: string
  /** Every language you understand, primary first (extras are captions). */
  myLanguages: string[]
  meetingName: string
  /** The room's language set. */
  languages: string[]
}

const KEY = 'booth-session'

let current: BoothSession | null | undefined = undefined // undefined = not read yet
const listeners = new Set<() => void>()

function init() {
  if (current !== undefined) return
  if (typeof window === 'undefined') {
    current = null
    return
  }
  try {
    const raw = sessionStorage.getItem(KEY)
    current = raw ? (JSON.parse(raw) as BoothSession) : null
  } catch {
    current = null
  }
}

function getSnapshot(): BoothSession | null {
  init()
  return current ?? null
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useSession(): BoothSession | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null)
}

export function storeSession(s: BoothSession | null) {
  current = s
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s))
    else sessionStorage.removeItem(KEY)
  } catch {
    // storage may be unavailable; the session still works in memory
  }
  listeners.forEach((l) => l())
}
