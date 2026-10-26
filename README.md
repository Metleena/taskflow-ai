# TaskFlow — AI-assisted task assignment, review and feedback

Managers assign tasks, the AI explains them in plain language, employees submit work, the AI produces **advisory** feedback, and managers run review meetings until they confirm completion. All emails are real SMTP sends with logged delivery status.

**Stack:** React + Vite + TypeScript + Tailwind · Node + Express + TypeScript · MongoDB + Mongoose · Nodemailer · Anthropic Claude API (configurable model) · Vitest/Supertest.

## Verification status (please read)

This project was written in a sandbox with **no network access**, so `npm install` could not run there. What was and was not checked:

| Check | Status |
|---|---|
| Workflow rules (`server/src/domain`): status transitions, completion gate, reminder scheduling, idempotency keys, meeting validation | **Run: 8/8 unit tests pass** (`npm run test:domain`, needs only Node 22.6+) |
| All server `.ts` files parse (syntax only) | **Checked** |
| API/integration tests (`server/tests/api.test.ts`, 16 tests: auth, roles, assignment, email retry and duplicates, uploads, review loop, completion gate, reminders, invites) | **Written, not yet run**: they need `npm install` |
| `tsc` type-check (server and client), client build, UI in a browser | **Not run** |

Expect to fix a few small type or runtime errors on first run. Start with `cd server && npm install && npm test`; the tests pinpoint problems quickly.

## Quick start

Prerequisites: Node 22+, MongoDB 6+ running locally (or an Atlas URI).

```bash
# 1. Server
cd server
cp .env.example .env            # then edit: set JWT_SECRET (see file), SMTP_*, ANTHROPIC_API_KEY
npm install
npm run test:domain && npm test # rules + API tests (API tests use an in-memory MongoDB; first run downloads it)
npm run seed                    # demo users and tasks
npm run dev                     # API on :4000

# 2. Client (new terminal)
cd client
npm install
npm run dev                     # http://localhost:5173 (proxies /api to :4000)
```

Demo logins (password `Demo-Password-2026`, or `SEED_PASSWORD`): `admin@demo.test`, `vikram.manager@demo.test`, `neha.manager@demo.test`, `ravi@demo.test`, `priya@demo.test`, `arjun@demo.test`.
Seeded AI feedback is labelled "sample" in the UI; it is not model output.

Production: `cd client && npm run build`; the server then serves `client/dist` from the same origin. Use HTTPS (cookies are `secure` when `NODE_ENV=production`).

## External services that need your configuration

| Service | Variables | If missing |
|---|---|---|
| **MongoDB** | `MONGODB_URI` | Server will not start |
| **Secret** | `JWT_SECRET` (32+ chars) | Server will not start |
| **SMTP** (any provider: SES, SendGrid SMTP, Mailgun, Gmail app password…) | `SMTP_HOST/PORT/SECURE/USER/PASS/FROM` | Emails are recorded as **failed** ("SMTP is not configured"); use Retry after configuring |
| **Anthropic API** | `ANTHROPIC_API_KEY`, `AI_MODEL` | Task explanation and feedback show **unavailable**; nothing is faked; the manager reviews manually |
| **Meeting providers** | none | Not integrated: managers paste links. `Meeting.platform/link` is the extension point for Google Meet/Teams/Zoom |

## Architecture

```
React SPA ──/api (httpOnly cookie, JSON / multipart)──▶ Express
                                                         ├─ routes/  auth+users · tasks/submissions/review/meetings · dashboard/notifications/admin
                                                         ├─ domain/  pure rules (no DB, unit-tested)
                                                         ├─ services AI explanation + analysis, reminder scheduling
                                                         ├─ notifications  idempotent queue + worker (MongoDB-backed)
                                                         └─ mongoose models ── MongoDB
Claude API ◀── ai.ts (structured JSON, zod-validated, 1 retry)      SMTP ◀── mailer.ts (nodemailer)
```

```
taskflow-ai/
├─ server/src/  domain/ (workflow.ts + tests) · routes/ · models.ts · auth.ts · ai.ts · services.ts
│               notifications.ts · templates.ts · mailer.ts · config.ts · app.ts · index.ts · seed.ts
├─ server/tests/api.test.ts
├─ client/src/  pages/ (Dashboard, Tasks, TaskNew, TaskDetail, Meetings, Notifications, Users, Admin, Profile, Login, SetPassword) · ui.tsx · api.ts · auth.tsx
└─ docs/API.md
```

### Data model
`User` (role, department, manager, status) · `Task` (one per assignee; tasks created together share `groupId`; embedded `aiExplanation`; `finalApproval`) · `Submission` (versioned; `draft`/`submitted`; file metadata; links) · `Feedback` (AI report + manager comments + decision, one per submission) · `Meeting` (UTC `startsAt` + IANA `timeZone`, status, outcome, `nextMeeting`) · `Notification` (unique `key`, status, attempts, error) · `AuditLog`.

### Key design decisions
- **One task per employee.** A multi-person assignment creates separate tasks so each person has their own status, submissions, meetings and feedback.
- **Overdue is derived** from deadline and status, never stored, so it cannot go stale.
- **Completion is manager-only and two-step.** Review → `Approved` (AI recommendations never change status) → manager presses *Confirm completion* (`POST /tasks/:id/complete`, allowed only from `Approved`).
- **"Changes required" needs a real next meeting** (future time + http(s) link) or the request is rejected. Links are never generated.
- **Reliable email.** Every email is a `Notification` with a unique idempotency key (e.g. `meeting_reminder:<meeting>:<startsAtMs>:<offset>:<user>`), so retries and repeated requests cannot duplicate it. A worker claims due rows atomically, retries with exponential backoff up to `MAX_EMAIL_ATTEMPTS`, recovers rows stuck after a crash, and marks `sent` only after SMTP accepts. Persistence is MongoDB, so jobs survive restarts and no extra queue service is needed.
- **Rescheduling/cancelling** skips old reminders; reminders also re-check the meeting and deadline at send time.
- **AI safety.** Prompts forbid inventing requirements; user text is passed as delimited data; output is validated with zod; the analysis lists what it could not read (PDF/DOCX/XLSX/ZIP contents and links are **not** extracted or opened) and sets `requiresManagerReview`.
- **Access control.** Every task query is scoped by role; out-of-scope IDs return 404. Uploaded files are served only through an authorised endpoint, named with random IDs, filtered by extension and checked against file signatures.
- **No passwords by email.** New accounts get a single-use, 48-hour set-password link (token stored hashed).

## Known limitations
- Departments are a text field on users (no separate department management screen).
- Only the Anthropic provider is implemented in `ai.ts` (swap `callModel` to add another).
- Uploaded documents (PDF/DOCX/XLSX/ZIP) are stored and downloadable but not text-extracted for the AI.
- Editing a task does not email the employee about the change.
- Uploads are stored on local disk (`UPLOAD_DIR`); use shared storage for multiple server instances.
- No virus scanning of uploads; add one before opening to untrusted users.

API reference: `docs/API.md`.
