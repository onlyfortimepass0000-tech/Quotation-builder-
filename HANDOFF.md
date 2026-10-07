# Quotation Builder — handoff

Next.js 16 (App Router) app. AI-analyzes a company's sample quotation PDF into a template, human approves it, then generates quotes as PDFs with zero AI calls.

Migrated from Cloudflare (D1 + R2) to **Vercel + Neon Postgres + Vercel Blob**.

## Stack
- DB: Neon Postgres via `drizzle-orm/neon-http` (`src/db/client.ts`, `src/db/schema.ts`)
- Files: Vercel Blob via `@vercel/blob` (`src/lib/storage/index.ts`)
- AI: NVIDIA NIM providers, selected by env (`src/lib/ai/registry.ts`)
- PDF: `pdf-lib` render (`src/lib/pdf/render-quote.ts`), rasterize/crop done client-side

## How a sample PDF is analyzed
1. Browser uploads the PDF straight to Blob (`/upload-sample` issues the token), so its size never hits Vercel's 4.5 MB request limit.
2. Browser renders every page (`rasterize-client.ts`) and sends each one to `/extract-page`, 4 at a time with retries:
   - digital page (usable text layer) → exact text from the PDF + a short AI layout note
   - scanned page → full AI OCR
3. `/analyze` gets the extracted text (small JSON) and runs Stage B.
If a page still fails, the user sees which one; clicking Analyze again redoes only the missing pages.

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
3. Add env vars above, link a Blob store (**public** access — the code writes public blobs).
   Keep **Fluid compute** on (Settings → Functions): `/extract-page` and `/analyze` set `maxDuration` 90s / 180s, which needs it on Hobby.
4. Create tables: paste `drizzle/0000_init.sql` into Neon's SQL Editor and run it (or `DATABASE_URL=... npx drizzle-kit migrate`)
5. Redeploy.

## Known gaps
- Upload → analyze → review was tested in a browser against a local Postgres with the mock AI providers (30-page digital PDF, 6.3 MB scanned PDF, two files at once, forced page failures + retry). Not yet tested: real NVIDIA models, real Blob store, approve → generate quote.
- `src/lib/pdf/rasterize.ts` is dev-only (`@napi-rs/canvas`); not used by routes.
- `npm run seed:fixture` points at `scripts/gen-fixture-pdf.ts`, which isn't in the repo.
- Vercel's Hobby plan is for non-commercial use; a paid client project belongs on Pro.
- NVIDIA keys are free-tier: rate-limited. Page reading is capped at 4 parallel calls and retries 429s on the next key.

## Fixed after handoff
- App moved to repo root so Vercel's default root directory works.
- Branding images used `/api/files/<blob URL>`, which broke once keys became Blob URLs. They now load the public Blob URL directly.
- Removed `/api/files/[...key]`: nothing used it after that fix, and it fetched any URL passed to it (open proxy).
- Stale Cloudflare/R2 comments updated.
- Analysis only read the first 5 pages and sent the whole PDF + all page images in one request; replaced by the per-page flow above.
- pdfjs-dist v6's default browser build needs `Map.prototype.getOrInsertComputed`, which current browsers don't have, so PDF rendering failed in the browser. Switched to the legacy (polyfilled) build.
