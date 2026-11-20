# DocDash — QueueZero Clinic Hack

Multi-clinic appointment booking + live virtual queue tracking web app.

## Stack

- **Frontend:** React 18 + Vite + Tailwind CSS + React Router
- **Backend:** Node.js + Express, REST + 3s polling (live token updates)
- **Database:** SQLite (via Node 24 built-in `node:sqlite`)

## Run

```bash
# terminal 1 — API on :4000
cd server && npm install && npm start

# terminal 2 — web app on :5173 (proxies /api → :4000)
cd client && npm install && npm run dev
```

Open http://localhost:5173

## Demo script (split screen)

1. **Doctor Console** (`/console`) — Dr. A. Mehta, Morning: Token #11 is inside.
2. **Patient dashboard** — open `/appt/14` (or My Appointments → `9000000014`): Token #14 shows ~36 min wait.
3. Console → **Call Next Patient** → patient screen updates to #12 inside, **2 patients ahead / ~24 min**, amber *"arrive now"* alert + simulated SMS.
4. Try: Skip no-show, Delay 10 mins, Inject emergency, prescription attach.
5. `/board/1` public queue board, `/heatmap` best-slot picker.

## Features

- Multi-clinic doctor directory (specialty + branch filters)
- Sequential token booking (morning/evening shifts)
- Wait estimator: `(queue position − 1) × EWMA(last 5 consults) + doctor delay offset`
- Live queue board + doctor console (call next / complete / delay / skip / status)
- My Appointments with 3s polling, countdown wait, SMS simulator at 2 tokens away
- Stretch: geolocation check-in (≤500 m), emergency escalation, prescription upload, wait heatmap
