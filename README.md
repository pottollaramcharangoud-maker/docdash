# DocDash — QueueZero Clinic Hack

Multi-clinic appointment booking + live virtual queue tracking web app.

## Stack

- **Frontend:** React 18 + Vite + Tailwind CSS + React Router + Socket.io client
- **Backend:** Node.js + Express, Zod validation, structured JSON logging, Socket.io push (polling fallback)
- **Database:** SQLite via Node 24 built-in `node:sqlite` (explicit indexes + v1→v2 migration)
- **Tests:** Vitest + Supertest — 64 unit & integration tests

## Run

```bash
# terminal 1 — API on :4000
cd server && npm install && npm start

# terminal 2 — web app on :5173 (proxies /api and /socket.io → :4000)
cd client && npm install && npm run dev
```

Open http://localhost:5173

## Tests

```bash
cd server && npm test     # 64 tests: EWMA, validation, queue state machine, API integration
```

Each test file runs in an isolated fork with its own temp database.

## Demo script (split screen)

1. **Doctor Console** (`/console`) — Dr. A. Mehta, Morning: Token #11 is inside.
2. **Patient dashboard** — open `/appt/14` (or My Appointments → `9000000014`): Token #14 shows ~36 min wait.
3. Console → **Call Next Patient** → patient screen updates to #12 inside, **2 patients ahead**, amber *"arrive now"* alert + simulated SMS (via Socket.io push).
4. Try: Skip no-show, Delay 10 mins, Inject emergency, prescription attach.
5. `/board/1` public queue board · `/heatmap` best-slot picker · `/my` paginated lookup.

## Architecture

```
client/                     server/
  src/api.js      REST         app.js         express factory (testable)
  src/hooks/                   index.js       HTTP + Socket.io bootstrap
    useLive.js     Socket.io   realtime.js    event bus → socket rooms
  src/pages/                   routes/        catalog | appointments | queue | meta
  src/components/              services/      ewma.js | queue.js | shift.js
                               validate.js    Zod schemas + middleware
                               errors.js      ApiError + handler
                               logger.js      structured JSON logs
                               config.js      shift windows, limits
                               db.js          schema, migration, indexes, seed
                               tests/         vitest suites
```

**Real-time:** domain events (`emitQueueEvent`) → EventEmitter bus → Socket.io rooms (`doctor:{id}`) → `useLive` hook. HTTP polling (3s) is the automatic fallback when the socket is down; the UI shows a LIVE/POLLING badge.

**Wait estimator:** `EstimatedWait = (QueuePosition − 1) × EWMA(last 5 consults, α=0.5) + DoctorOffsetDelay` — pure functions in `services/ewma.js`, unit-tested.

## Rubric coverage

| Criterion | What's included |
|---|---|
| Requirements | All core + stretch features; shift-transition rules (pre-book next day, sweep stale tokens → MISSED); 64 automated tests |
| Code quality | Layered modules, pure services, reusable `useLive` hook, Tailwind `@layer` components, no fetch logic in pages |
| Functionality | Typed errors (`ApiError` codes), rate-limited booking, idempotent SMS, graceful SSE/polling fallback |
| Architecture | 3-tier split, repository-free thin routes, explicit SQLite indexes, paginated endpoints (`page`/`limit`/`total`), v1→v2 migration |
| Security | Zod validation on every input (name/phone/coords/enums), security headers, sanitized upload names, 2 MB file cap, no `x-powered-by`, structured 4xx/5xx logs |
| Innovation | EWMA + confidence-free estimate, Haversine check-in ≤500 m, Socket.io push, emergency queue injection with ordering guarantees |

## Features

- Multi-clinic doctor directory (specialty + branch filters, paginated)
- Sequential token booking per doctor/shift/**date** with shift-window rules
- Live queue board + doctor console (call next / complete / delay / skip / status / emergency)
- My Appointments with pagination, live countdown, SMS simulator at 2 tokens away
- Virtual check-in (geolocation ≤500 m, manual fallback), prescription notes + file upload
- Wait-time heatmap + best-slot suggestion
- Shift lifecycle: open/closed phases, pre-booking for tomorrow, stale-queue sweep
