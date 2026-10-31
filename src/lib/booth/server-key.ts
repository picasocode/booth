import { db } from '@/lib/db'

/**
 * The ONE shared OpenAI key for the whole deployment, set once in the
 * settings UI and stored in the Booth database. Host and every guest use it
 * automatically — nobody configures a key per device. The raw key never
 * leaves the server; browsers only ever see a masked hint.
 */

const CONFIG_ID = 'booth'

export async function getSharedKey(): Promise<string> {
  let key = ''
  try {
    const row = await db.appConfig.findUnique({ where: { id: CONFIG_ID } })
    key = row?.openaiKey ?? ''
  } catch {
    // table may not exist yet on a cold deployment — fall through to env
  }
  if (!key) key = process.env.OPENAI_API_KEY ?? ''
  return key.trim()
}

export async function saveSharedKey(key: string): Promise<void> {
  await db.appConfig.upsert({
    where: { id: CONFIG_ID },
    update: { openaiKey: key },
    create: { id: CONFIG_ID, openaiKey: key },
  })
}

export async function clearSharedKey(): Promise<void> {
  await db.appConfig.upsert({
    where: { id: CONFIG_ID },
    update: { openaiKey: '' },
    create: { id: CONFIG_ID, openaiKey: '' },
  })
}

/** sk-…1234 — enough to recognise the key, useless to an attacker. */
export function maskKey(key: string): string {
  if (!key) return ''
  return `sk-…${key.slice(-4)}`
}

export function looksLikeOpenAiKey(key: string): boolean {
  return /^sk-[A-Za-z0-9_\-]{20,}$/.test(key)
}
