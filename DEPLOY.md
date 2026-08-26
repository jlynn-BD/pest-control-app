# Deploying PestApp Field

This repo deploys as three pieces, all provisioned in one shot by `render.yaml`:

- **pestapp-db** — managed Postgres (free tier, expires after 30 days unless upgraded)
- **pestapp-backend** — the Express/Prisma API (free tier, no persistent disk — see note below)
- **pestapp-web** — the Expo app exported as a static site (always free on Render)

## One-time setup (manual — only you can do these)

1. **Create a GitHub repo and push this code.**
   ```bash
   git remote add origin <your-new-repo-url>
   git branch -M main
   git push -u origin main
   ```
2. **Create a free Render account** at https://render.com (sign in with GitHub is easiest — it also handles the repo-access step below).
3. In the Render dashboard: **New → Blueprint**, connect the GitHub repo, and select it. Render reads `render.yaml` at the repo root and provisions all three services automatically — no manual field entry needed.
4. Wait for all three services to finish their first deploy (a few minutes). Render will show you the live URLs for `pestapp-backend` and `pestapp-web`. The backend's start command seeds demo data automatically on every boot (Shell/one-off jobs need a paid plan, and the seed script is idempotent, so this runs it instead of requiring a manual step) — no action needed here.
5. Send your boss the `pestapp-web` URL. Demo logins (all password `password123`):
   - `admin@pestapp.dev` (admin)
   - `office@pestapp.dev` (office)
   - `tech@pestapp.dev` (technician — this is the one that sees the field/inspection workflow)

## Known limitations on the free tier

- **File uploads don't persist.** No disk is attached on the free backend plan, so photos, site-map images, and generated PDFs live on ephemeral local disk and disappear whenever the service restarts (including the automatic spin-down after 15 minutes idle). Findings/checklist/treatment data in Postgres is unaffected — only the actual files. Fix: upgrade `pestapp-backend` to a paid instance type and attach a Render Disk (ask and I'll wire it into `render.yaml`).
- **The Postgres database expires after 30 days** on the free plan. Fine for a review period; upgrade before that if you want to keep it.
- **Offline/camera/GPS features don't work in a browser.** The web build (what `pestapp-web` serves) can't use the on-device SQLite store or a real camera the way the native app does — this is a browser limitation, not a bug. Anything that requires actually starting/editing an inspection in the field needs the native app via Expo Go, not the web link. The web link is great for reviewing customers, properties, completed inspections, reports, checklists, site maps, and estimates.

## Redeploying after code changes

Render auto-redeploys `pestapp-backend` and `pestapp-web` on every push to `main` (this is the default for Blueprint-provisioned services). `pestapp-backend`'s start command runs `prisma migrate deploy` before booting, so schema changes apply automatically — no manual migration step needed on future deploys.
