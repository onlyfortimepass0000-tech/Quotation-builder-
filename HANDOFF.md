# Quotation Builder — handoff

Next.js 16 (App Router) app. AI-analyzes a company's sample quotation PDF into a template, human approves it, then generates quotes as PDFs with zero AI calls.

Migrated from Cloudflare (D1 + R2) to **Vercel + Neon Postgres + Vercel Blob**.

## Stack
- DB: Neon Postgres via `drizzle-orm/neon-http` (`src/db/client.ts`, `src/db/schema.ts`)
- Files: Vercel Blob via `@vercel/blob` (`src/lib/storage/index.ts`)
- AI: NVIDIA NIM providers, selected by env (`src/lib/ai/registry.ts`)
- PDF: `pdf-lib` render (`src/lib/pdf/render-quote.ts`), rasterize/crop done client-side

## Env vars (set in Vercel → Settings → Environment Variables)
| Var | Notes |
|---|---|
| `DATABASE_URL` | **Missing — required.** Neon connection string |
| `BLOB_READ_WRITE_TOKEN` | Auto-added when a Blob store is linked to the project |
| `NVIDIA_API_KEY_1..4` | Text/vision keys (rotated per request) |
| `NVIDIA_API_KEY_OMNI` | Asset locator (logo/signature detection) |
| `IMAGE_TO_TEXT_PROVIDER` | `nvidia-vision` |
| `TEXT_ANALYSIS_PROVIDER` | `nvidia-text` |
| `ASSET_LOCATOR_PROVIDER` | `nvidia-omni` |

## Deploy steps
1. `npm install`
2. Push to GitHub, import repo in Vercel (framework: Next.js, root = repo root).
3. Add env vars above, link a Blob store.
4. Create tables: paste `drizzle/0000_init.sql` into Neon's SQL Editor and run it (or `DATABASE_URL=... npx drizzle-kit migrate`)
5. Redeploy.

## Known gaps
- Never verified end-to-end: no `DATABASE_URL` was available, so the DB flow (create company → upload sample → analyze → approve → generate quote) is untested. `next build` passes without it.
- `src/lib/pdf/rasterize.ts` is dev-only (`@napi-rs/canvas`); not used by routes.
- `npm run seed:fixture` points at `scripts/gen-fixture-pdf.ts`, which isn't in the repo.
- Analyze (120s) and detect-assets (60s) already set `maxDuration`. Vercel Hobby caps functions at 60s, so analyze needs Pro or a shorter AI budget.

## Fixed after handoff
- App moved to repo root so Vercel's default root directory works.
- Branding images used `/api/files/<blob URL>`, which broke once keys became Blob URLs. They now load the public Blob URL directly.
- Removed `/api/files/[...key]`: nothing used it after that fix, and it fetched any URL passed to it (open proxy).
- Stale Cloudflare/R2 comments updated.
