# GTMbench

A GTM (Go-To-Market) lead capture and enrichment platform.

## Architecture

Monorepo with two apps:

- **`apps/web`** — Next.js 16 frontend (Tailwind CSS 4, TypeScript)
- **`apps/api`** — Express 5 backend (TypeScript, MongoDB, BullMQ/Redis)

## Workflows

- **Start application** — Runs the Next.js frontend on port 5000 (webview)
- **Start Backend** — Runs the Express API on port 3000 (console)

## Replit Configuration

- Frontend runs on port 5000 (`next dev -p 5000 -H 0.0.0.0`)
- API runs on port 3000 (default PORT env)
- Frontend proxies API calls via Next.js rewrites at `/api-proxy/*` → `http://localhost:3000/*`
- CORS allows all origins in development (`ALLOWED_ORIGIN=*`)
- `allowedDevOrigins: ["*"]` set in `next.config.ts` for Replit proxy

## Required Environment Variables (API)

- `MONGODB_URL` — MongoDB connection string
- `FIBER_API_KEY` — Fiber.ai API key
- `OPENAI_API_KEY` — OpenAI API key
- `FIRECRAWL_API_KEY` — Firecrawl API key
- `JWT_SECRET` — JWT signing secret (defaults to dev value)
- `REDIS_URL` — Redis connection (defaults to localhost:6379)

## Optional Environment Variables

- `MONGODB_DB_NAME` — defaults to "gtmbench"
- `FIBER_API_BASE_URL` — defaults to https://api.fiber.ai
- `PARALLEL_API_KEY` / `PARALLEL_API_BASE_URL` — Parallel API
- `NEXT_PUBLIC_API_BASE_URL` — override API URL for frontend (defaults to /api-proxy)

## Notes

- `@tailwindcss/oxide-linux-x64-gnu` is symlinked into `apps/web/node_modules/@tailwindcss/` because npm workspaces hoists it to root, but Turbopack's worker needs it locally
- The lightningcss loader in `apps/web/node_modules/lightningcss/node/index.js` is patched to use `path.join(__dirname, ...)` for reliable binary resolution
