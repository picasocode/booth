'use client'

/**
 * Client view of the SHARED Booth API configuration — the one key the host
 * saves, which every participant (host and guests) uses automatically.
 * Browsers only ever see whether a key exists and its masked hint.
 */
import { useSyncExternalStore } from 'react'

export interface SharedConfig {
  configured: boolean
  hint: string
  source: 'db' | 'env' | 'none'
  loaded: boolean
}

let current: SharedConfig = { configured: false, hint: '', source: 'none', loaded: false }
const listeners = new Set<() => void>()
let inflight: Promise<void> | null = null

function emit() {
  listeners.forEach((l) => l())
}

export async function refreshSharedConfig(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const r = await fetch('/api/config', { cache: 'no-store' })
      const d = (await r.json()) as { configured?: boolean; hint?: string; source?: SharedConfig['source'] }
      current = {
        configured: Boolean(d.configured),
        hint: d.hint ?? '',
        source: d.source ?? 'none',
        loaded: true,
      }
    } catch {
      current = { ...current, loaded: true }
    }
    emit()
  })().finally(() => {
    inflight = null
  })
  return inflight
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  if (typeof window !== 'undefined') void refreshSharedConfig()
  return () => {
    listeners.delete(cb)
  }
}

export function useSharedConfig(): SharedConfig {
  return useSyncExternalStore(subscribe, () => current, () => current)
}
