# Booth — live interpretation for meetings

Give a meeting a live interpretation channel: translated voice and captions in up
to four languages, running a few seconds behind the speaker — the way a human
booth does.

**Everything runs in the browser UI.** There is no separate backend service, no
relay worker, no server-side audio path. Each participant's browser is its own
interpretation booth: it listens to the meeting (microphone in the room, or a
shared meeting tab), and produces translated voice + captions for the language
that person selected. All API configuration happens in the app's Settings
dialog and is stored on the device (localStorage) — never on the server.

## Architecture

- **UI** (`src/components/booth/`, `src/lib/booth/`): the whole product.
  - `engine/s2s.ts` — **gpt-realtime-translate** over WebRTC: the
    lowest-latency speech-to-speech path (first translated voice in about
    0.7–1.8 s). The browser exchanges the user's key for a short-lived client
    secret, then performs the offer/answer handshake directly with
    `api.openai.com`.
  - `engine/cascade.ts` — cascade fallback: streaming ASR windows →
    LLM interpreter → streaming TTS, straight against the OpenAI REST API.
  - `engine/interpreter.ts` — VAD-gated orchestration, 500 ms pre-roll,
    caption entry management, usage metering.
  - `audio/player.ts` — jitter-buffered 24 kHz PCM16 playback + level meters.
  - `settings-store.ts` — every setting (OpenAI key, engine mode, models,
    voice) lives in the browser. The server cannot read it.
- **Control plane** (`src/app/api/*`): the only server-side code — thin Next.js
  routes that create rooms, keep presence, and store metered usage seconds in
  **Prisma Postgres** via Prisma. These deploy with the app on Vercel
  automatically; nothing to operate.
- **No WebSockets needed**: the realtime audio path is browser → OpenAI
  WebRTC (peer connection), so it works on Vercel's serverless platform.

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel (framework: Next.js —
   auto-detected; build command `next build`).
2. Add the environment variables:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Prisma Postgres **pooled** URL (`pooled.db.prisma.io`) |
   | `DIRECT_DATABASE_URL` | Prisma Postgres **direct** URL (`db.prisma.io`) — used by `prisma db push` |
   | `OPENAI_API_KEY` | *(optional)* fallback key for `/api/realtime-token` only |

3. Create the schema once: locally run `bun run db:push` (or `npx prisma db
   push`) with the same `.env` values.
4. Deploy. Each user adds their own OpenAI key in Settings on first use.

## Local development

```bash
bun install          # runs prisma generate
cp .env.example .env # fill in your Prisma Postgres URLs
bun run db:push      # create the tables
bun run dev          # http://localhost:3000
```

## Using a room

1. Open a room, pick up to four languages, share the six-character code.
2. Everyone opens the link (or enters the code), picks the language they
   understand, and clicks **Start interpreting**.
3. Booth listens through the microphone — or use **Interpret a meeting tab
   instead** for online calls (share the meeting tab with audio; the picker's
   "share tab audio" checkbox matters).
4. Use headphones. Speaker sound leaking into the mic gets re-interpreted.

## Language coverage

With an OpenAI key configured, `gpt-realtime-translate` speaks 13 target
languages (en, es, pt, fr, de, it, ru, zh, ja, ko, hi, id, vi) at the lowest
latency. Every other offered language — and every fallback situation — runs on
the cascade, which transcribes any of the 16 offered languages and speaks them
through `gpt-4o-mini-tts`. Captions are always available in all languages.

## Notes

- The OpenAI key entered in the UI is kept in that browser's localStorage and
  sent only to `api.openai.com` (or, if that request is ever blocked, through
  the app's own `/api/realtime-token` forwarder, which does not store it).
- Metered interpretation seconds are stored per room in Prisma Postgres and
  shown on the home page (last 24 h).
