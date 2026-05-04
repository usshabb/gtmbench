# GTMbench Monorepo

Basic Vercel-friendly monorepo with:

- `apps/web`: Next.js App Router frontend
- `apps/api`: Node.js + Express API (MongoDB + Fiber enrichment)

## Features

- Google OAuth sign-in
- Add domain leads
- Persist leads in MongoDB
- Enrich new leads by calling Fiber API

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Add env files:
   - `apps/api/.env` (already scaffolded locally, not committed)
   - `apps/web/.env.local` (already scaffolded locally, not committed)

3. Run both apps:

   ```bash
   npm run dev
   ```

4. Open:
   - Frontend: `http://localhost:3000`
   - API: `http://localhost:4000`

## API Endpoints

- `GET /auth/google/signin-url` returns a Google OAuth sign-in URL
- `GET /auth/google/callback` completes Google OAuth and redirects with the app auth token
- `GET /leads` with `Authorization: Bearer <token>`
- `POST /leads` `{ domain }` with `Authorization: Bearer <token>`

## Fiber API Notes

Fiber request is configured by:

- `FIBER_API_BASE_URL` (default: `https://api.fiber.ai`)
- `FIBER_ENRICH_PATH` (default: `/v1/enrich`)

If your Fiber account uses a different endpoint shape, update those env values.
