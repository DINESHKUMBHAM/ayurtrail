# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AIIA CTMS (SIH26046) — a Clinical Trial Management System for Ayurvedic trials. Express + MySQL backend, vanilla-JS frontend, no build step and no bundler. The domain driver is **21 CFR Part 11 compliance**: electronic signatures, record immutability after signing, and a tamper-evident audit trail.

## Commands

```bash
node server.js          # run (npm start is identical)
node seed-all-users.js  # re-hash the demo account passwords

# config overrides (defaults live in src/config/env.js)
DB_USER=root DB_PASSWORD='pass' DB_NAME=sih26046_ctms PORT=3000 node server.js
```

Then open **http://localhost:3000**. Do not open `public/index.html` as a `file://` URL — every `/api/...` call resolves to `file:///api/...` and fails. The frontend must be served by Express, which serves `public/` at the root (`src/app.js`).

**There is no test suite and no linter.** `npm test` is the npm placeholder that exits 1. Because nothing catches regressions automatically, verify changes by actually running them (see Verifying changes below).

## Architecture

### Request path

`server.js` (entry, ~11 lines) → `src/app.js` (express instance, JSON body parsing, static `public/`) → `src/routes/index.js` (mounted at `/api`) → one `*.routes.js` module per domain.

`src/routes/index.js` mounts most routers under a path prefix (`/trials`, `/ecrf`, …). The exception is `randomization.routes.js`, mounted at `/` because it owns paths under two different prefixes: `/api/patients/:id/randomize` and `/api/randomizations`.

Shared code: `src/config/` (env + demo accounts), `src/db/` (pool, boot-time table creation), `src/middleware/auth.js`, `src/utils/` (audit, validateId, ecrfHash, csv), `src/services/ecrfPdf.js`.

### Frontend

`public/index.html` is markup only. Styles are split across `public/css/` (`tokens` → `base` → `layout` → `components` → `utilities`, loaded in that order — later files depend on the custom properties in `tokens.css`). Behaviour is split across `public/js/`, one module per domain.

**These are classic scripts, not ES modules.** Every function is a global, and the HTML uses inline `onclick="navigate('dashboard')"` handlers that depend on those globals. Adding `type="module"` to the script tags, or wrapping a file in an IIFE, silently breaks every inline handler. Load order in `index.html` matters: `api.js` and `ui.js` define helpers the feature modules call, and `main.js` runs last to bind forms and the session.

There is no state container. Each section re-fetches on navigation via `SECTION_LOADERS` in `public/js/ui.js`.

## Compliance logic — read before touching eCRF code

`src/utils/ecrfHash.js` is the core of the signature scheme. `generateCanonicalHashPayload` must produce a **byte-identical** string at sign time and at verify time. Any change to the field set, ordering, coercion, or the trailing signer id invalidates every signature already stored in the database. Only five fields are hashed: `id`, `patient_id`, `visit_number`, `dosha_data`, `anupana_details`.

Three rules the routes enforce, all in `src/routes/ecrf.routes.js`:

- **Immutability lock** — `PUT /api/ecrf/:id` returns 403 as soon as an `ecrf_signatures` row exists for the record. Signed records are never editable.
- **Re-authentication** — `POST /api/ecrf/:id/sign` requires the signer's password in the body even though they already hold a valid JWT. This is a Part 11 requirement, not redundancy.
- **Tamper detection** — the audit payload written at signing time doubles as the snapshot of signed state. `GET /api/ecrf/:id/verify` recomputes the hash, and on mismatch diffs the live row against that audit payload to report which field drifted. It currently diffs only `anupana_details`; extending it means adding comparisons there.

`src/utils/audit.js` writes through the **pool, not the caller's transaction connection**, so audit rows survive a rollback. This is deliberate — an attempted-but-failed action still leaves a trail. Don't "fix" it into the transaction without deciding that trade-off consciously.

## Auth and roles

Roles: `ADMIN`, `PI`, `CRC`, `ETHICS`, `AUDITOR`. JWT bearer tokens, 8h expiry.

`authenticateToken` also accepts `?token=` from the query string. This is not sloppiness — the PDF and CSV exports open in a new browser tab, which cannot carry an `Authorization` header. `public/js/ecrf.js` and `public/js/audit.js` build those URLs.

**403 is overloaded.** The server returns 403 both for an expired/invalid token (`jwt.verify` failure) and for a role that simply isn't permitted (`requireRole`). `public/js/api.js` disambiguates by pattern-matching the error message so that a forbidden action doesn't log the user out. If you change either 403 message string, update that check.

**Blinding** is enforced in SQL, not in the client. `GET /api/randomizations` runs a different query for unblinded roles (`AUDITOR`, `ETHICS`, `ADMIN`); everyone else gets the literal `'BLINDED'` selected in place of the real arm, so the true allocation never reaches the browser.

## Adding things

**A route:** create `src/routes/<domain>.routes.js` exporting an `express.Router()`, then mount it in `src/routes/index.js`. Guard with `authenticateToken` and `requireRole(...)` from `src/middleware/auth.js`.

**A frontend section:** add the `<section class="page-section" id="x">` markup and a `nav-x` sidebar button to `index.html`, add an entry to `SECTION_LOADERS` in `public/js/ui.js`, create `public/js/x.js`, add its `<script>` tag before `main.js`, and call its `bindXForm()` from `main.js`.

**Transactions:** each route owns its own `getConnection` / `beginTransaction` / `commit` / `rollback` / `release` block. This boilerplate is repeated ~6 times and is deliberately not abstracted — there are no tests, and the routes are not uniform. Note that the same failure maps to different statuses in different routes (a `validateId` throw is a 400 in `POST /api/patients` but a 500 in `PUT /api/ecrf/:id`); that asymmetry is inherited, so match the surrounding route rather than normalizing it in passing.

## Database setup traps

The app connects to **MySQL**, but `schema.sql` is written in **PostgreSQL** syntax (`SERIAL`, `JSONB`) and will not apply as-is.

`schema.sql` also defines only 5 of the 10 tables the code queries. Missing: `ecrf_signatures`, `adverse_events`, `subject_randomizations`, `treatment_arms`. A sixth, `queries_deviations`, is created at boot by `src/db/init.js` (`CREATE TABLE IF NOT EXISTS`) rather than shipped in the schema file. On an incomplete database, signing, adverse-event reporting and randomization all fail at runtime.

`seed-all-users.js` runs `UPDATE`, never `INSERT`. On a fresh database with no users it prints success lines and changes nothing, and login then fails for every account.

Randomization additionally needs rows in `treatment_arms`, or `POST /api/patients/:id/randomize` returns "No treatment arms configured for this trial."

## Known gaps

- `/api/queries` (queries & deviations, `src/routes/queries.routes.js`) is backend-only — no UI reaches it.
- The dashboard recruitment bars show a placeholder `10 / 100 (10%)` for every trial: the `trials` table has no `target_enrollment` / `enrolled_count` columns. Marked with a `NOTE:` in `public/js/dashboard.js`.
- `/api/dashboard/stats` does not aggregate adverse events, so the AE severity chart is derived client-side from `/api/pharmacovigilance`.
- DB password and `JWT_SECRET` are committed as fallback defaults in `src/config/env.js` (they predate this layout and were previously inline in `server.js`). Env vars override them.

## Verifying changes

With no test suite, these are the checks worth running:

```bash
node --check <file>                                  # syntax
node -e "require('./src/app')"                       # module graph loads
curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/trials   # 401 = mounted, 404 = not mounted
```

For frontend work, load `http://localhost:3000` and check the browser console — a broken script tag or a missing global surfaces there immediately, not at build time.
