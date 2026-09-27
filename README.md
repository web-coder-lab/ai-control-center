# AI CONTROL CENTER

A personal, desktop-first developer/deployment control center with real provider adapters, secure credential storage, a capability-based Gateway, live audit logging, PostgreSQL persistence, and a local Chromium browser agent.

## Final architecture

- Frontend + backend in one project: React/Vite + Node.js/Express.
- PostgreSQL is the only application metadata persistence runtime. `DATABASE_URL` is required; there is no JSON database fallback.
- Provider credentials are encrypted at rest. Raw provider tokens are never returned to the frontend or Gateway clients.
- GitHub, Render, Cloudflare, Vercel, Netlify, Supabase, and DigitalOcean adapters are provider/API connections.
- Google/Gmail/Sheets/Drive are **browser-only** in this version. No Google API credential, Google OAuth client ID/secret, or Google developer project is required. Use an isolated browser session and log in normally.
- The browser agent is local to the owner machine and connects outbound through the paired WebSocket. Browser upload/download, cookie/storage/password extraction, and browser permission grants remain blocked. CAPTCHA/2FA/security verification uses human handoff.
- The Gateway exposes only owner-granted capabilities and never exposes underlying provider secrets. Gateway permissions can be edited live on the same key.
- Paid operations remain controlled by the configured cost policy; the system does not silently upgrade or spend money.

## AI brain boundary

The project intentionally contains **no external AI API dependency**. third-party hosted model endpoints are not part of the runtime. The current chat endpoint is a truthful `AI_BRAIN_NOT_CONFIGURED` boundary until the owner supplies their own local/self-hosted AI brain and connects it to the orchestration/tool contract.

The control/tool layer is still real: once called by an authorized brain or Gateway client, provider operations execute through the existing adapters, permission checks, account/resource verification, locking, logging, and result verification.

## Render deployment

Recommended service settings:

- Runtime: Node
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Health check path: `/health`
- Add a Render PostgreSQL database in the same region and set `DATABASE_URL` to the database's internal connection URL when the web service and database share the same region.
- Set the security variables from `.env.example` as Render secret environment variables. Keep `ENCRYPTION_MASTER_KEY` permanent after first setup so stored credentials remain decryptable across deploys.

The app binds to `0.0.0.0` and uses Render's `PORT` environment variable.

## Important

The browser agent is intentionally a separate local process. The Render service hosts the control center/Gateway/backend; the owner's computer runs the browser agent when browser automation is needed.
