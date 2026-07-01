# Advo AI Chatbot — Setup

The chatbot is fully wired up:

- **Backend:** [`api/chat.js`](api/chat.js) — a Vercel serverless function that
  calls Claude through the official [`@anthropic-ai/sdk`](package.json), holding
  your API key server-side. Includes per-IP rate limiting so a visitor can't run
  up your bill, and returns clear errors (bad key, upstream rate limit, network
  issue) instead of a generic failure.
- **Frontend:** the chat panel in [`editor.html`](editor.html) (`askAI()`),
  which POSTs to `/api/chat`. If the backend is unreachable or the key is
  missing, it quietly falls back to built-in demo answers so the UI never breaks.

You only need to do two things: **install the dependency** and **add your API key.**

```bash
npm install     # installs @anthropic-ai/sdk from package.json
```

---

## 1. Where to put the key

### Local development
Open [`.env`](.env) and replace the placeholder with your real key:

```bash
ANTHROPIC_API_KEY=sk-ant-...your real key...
```

Get the key from <https://console.anthropic.com/> → **API Keys**.
`.env` is gitignored, so it never gets committed.

### Production (Vercel)
The `.env` file does **not** ship to Vercel. Set the key in the dashboard:

**Vercel → your project → Settings → Environment Variables**, add:

| Name | Value |
|------|-------|
| `ANTHROPIC_API_KEY` | your real key |

(Optional: `ANTHROPIC_MODEL`, `AI_MAX_PER_HOUR`, `AI_MAX_PER_MIN`.)

Or from the CLI:

```bash
vercel env add ANTHROPIC_API_KEY
```

Then redeploy so the function picks it up.

---

## 2. Run it locally

The serverless function needs the Vercel dev runtime (a plain static server
won't execute `api/chat.js`):

```bash
npm i -g vercel      # once
vercel dev           # serves the site + /api/chat on http://localhost:3000
```

Open the file editor page, click **Ask Advo AI**, and send a message. A real
Claude reply confirms the key works. If you see canned/demo answers, the key
isn't set or the function isn't running.

---

## 3. Optional settings

Set these in `.env` (local) or Vercel env vars (production):

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANTHROPIC_MODEL` | `claude-opus-4-8` | `claude-sonnet-4-6` is cheaper + faster for chat |
| `AI_MAX_PER_HOUR` | `20` | Max messages per IP per hour |
| `AI_MAX_PER_MIN` | `6` | Max messages per IP per minute |
