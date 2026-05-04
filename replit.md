# GTMbench

A GTM (Go-To-Market) lead capture and enrichment platform.

## Architecture

Monorepo with two apps:

- **`apps/web`** — Next.js 16 frontend (Tailwind CSS 4, TypeScript)
- **`apps/api`** — Express 5 backend (TypeScript, MongoDB, BullMQ/Redis)

## Workflows

- **Start application** — Runs the Next.js frontend on port 5000 (webview)
- **Start Backend** — Runs the Express API on port 3000 (console)
- **Local login** — Use the app's **Continue with Google** sign-in flow; Google OAuth creates/updates the user and returns the app auth token.

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
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth credentials for app sign-in and Gmail/Calendar connection
- `JWT_SECRET` — JWT signing secret (defaults to dev value)
- `REDIS_URL` — Redis connection (defaults to localhost:6379)

## Optional Environment Variables

- `MONGODB_DB_NAME` — defaults to "gtmbench"
- `FIBER_API_BASE_URL` — defaults to https://api.fiber.ai
- `PARALLEL_API_KEY` / `PARALLEL_API_BASE_URL` — Parallel API
- `NEXT_PUBLIC_API_BASE_URL` — override API URL for frontend (defaults to /api-proxy)

## Design System

- Stripe-inspired color tokens: `#1a1f36` (dark navy), `#4f566b` (muted text), `#5469d4` (primary blue), `#e3e8ee` (borders), `#f7fafc` (light bg), `#697386` (secondary text), `#a3acb9` (hint text)
- Custom CSS animations in `globals.css`: `animate-fade-in`, `animate-slide-up`, `animate-shimmer` (for skeleton loaders)
- Styled scrollbars (thin, rounded, zinc palette)
- Search/filter on Companies and People list pages
- Skeleton loading states on list pages (shimmer animation)

## Notes

- `@tailwindcss/oxide-linux-x64-gnu` is symlinked into `apps/web/node_modules/@tailwindcss/` because npm workspaces hoists it to root, but Turbopack's worker needs it locally
- The lightningcss loader in `apps/web/node_modules/lightningcss/node/index.js` is patched to use `path.join(__dirname, ...)` for reliable binary resolution
