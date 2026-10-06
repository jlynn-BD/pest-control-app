# Deploying PestApp Field

This repo deploys as three pieces, all provisioned in one shot by `render.yaml`:

- **pestapp-db** — managed Postgres (paid Basic-256mb plan; the free tier expires after 30 days and suspends the database)
- **pestapp-backend** — the Express/Prisma API (paid Starter plan; still no persistent disk attached — see note below)
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
5. Send your boss the `pestapp-web` URL, and follow **Accounts & sign-in security** below to create real accounts. (The seed script still creates three sample accounts, `admin@`, `office@` and `tech@pestapp.dev`, all with the password `password123`. That password is published in this repo, so use them only to get started and then turn them off.)

## Accounts & sign-in security

Everyone signs in with their **own** account: email + password + a second step (a 6-digit code). There is no self-signup and no shared login.

**Adding people (admin only):** Settings → Team → "+ Add a person". The app shows a one-time temporary password; give it to the person privately. At their first sign-in they choose their own password and set up their second step. Admins can also reset a password, reset someone's second step (lost phone), unlock an account, or turn off access (they're signed out everywhere immediately; their past work stays).

**First-time setup right after this was deployed:** sign in as `admin@pestapp.dev` / `password123`, set up two-step sign-in, create real accounts (including a second admin), then turn off the three `@pestapp.dev` demo accounts under Team.

**Second step:** the person picks an authenticator app (works today, no cost, works offline) or text-message codes. Text messages need a Twilio account: add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER` (or `TWILIO_MESSAGING_SERVICE_SID`) to the `pestapp-backend` environment in the Render dashboard. Until then the app only offers the authenticator option. US carriers require a number registered for A2P 10DLC (or a verified toll-free number) before texts are delivered reliably; Twilio walks you through this and it can take days, so start early. Each person also gets 10 one-time recovery codes at setup.

**Sessions ("remembered" logins):** a sign-in stays alive while it keeps being used (15-minute access tokens, renewed by a refresh token that rotates every time, 7 days idle limit) but never longer than 30 days in total, after which a full sign-in with the second step is required again. A session that didn't complete the second step can never renew. Turning someone off, resetting their password or second step, changing a password, or "sign out of all devices" ends their sessions at once. A refresh token that's replayed after use ends the whole session.

**Other protections:** 5 wrong passwords/codes lock the account for 15 minutes; limits on sign-in attempts per address; sign-in activity is recorded (`AuthEvent` table); the API only answers the deployed web app's origin; stored authenticator secrets are encrypted.

**Audit trail (activity log):** every change is recorded as *who did what, to which record, and when*: inspections created/started/completed, findings added/edited/deleted, photos uploaded, site-map edits (marker moves, walls, labels, shapes), checklist answers, signatures, customer/property/appointment changes, reports generated and downloaded, estimates, checklist-template edits, and account actions (people added, turned off, passwords/two-step reset). Edits keep the **previous and new values**; deletes keep a copy of what was deleted. Work done offline is logged when it syncs, with the device's own time kept alongside the server's. Admins and office staff read it under Settings → Activity log (filter by person, area, or search; admins also see sign-ins), and an inspection page has a "View history" link. Entries can't be edited or deleted: there is no route for it and a database trigger refuses it. Passwords, codes and tokens are never written to it. Nothing is purged automatically.

**Emergency switch:** setting `MFA_ENFORCED=false` on the backend turns the requirement off for accounts that haven't set up a second step. Don't leave it that way.

## Known limitations on the free tier

- **File uploads don't persist.** No disk is attached on the free backend plan, so photos, site-map images, and generated PDFs live on ephemeral local disk and disappear whenever the service restarts (including the automatic spin-down after 15 minutes idle). Findings/checklist/treatment data in Postgres is unaffected — only the actual files. Fix: upgrade `pestapp-backend` to a paid instance type and attach a Render Disk (ask and I'll wire it into `render.yaml`).
- **The Postgres database expires after 30 days** on the free plan. Fine for a review period; upgrade before that if you want to keep it.
- **Offline/camera/GPS features don't work in a browser.** The web build (what `pestapp-web` serves) can't use the on-device SQLite store or a real camera the way the native app does — this is a browser limitation, not a bug. Anything that requires actually starting/editing an inspection in the field needs the native app via Expo Go, not the web link. The web link is great for reviewing customers, properties, completed inspections, reports, checklists, site maps, and estimates.

## Redeploying after code changes

Render auto-redeploys `pestapp-backend` and `pestapp-web` on every push to `main` (this is the default for Blueprint-provisioned services). `pestapp-backend`'s start command runs `prisma migrate deploy` before booting, so schema changes apply automatically — no manual migration step needed on future deploys.
