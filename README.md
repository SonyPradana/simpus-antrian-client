# Antrian — client

[![CI](https://github.com/sonypradana/simpus-antrian-client/actions/workflows/ci.yml/badge.svg)](https://github.com/sonypradana/simpus-antrian-client/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/sonypradana/simpus-antrian-client)](https://github.com/sonypradana/simpus-antrian-client/releases)

Patient registration UI + BFF (backend-for-frontend) for community health-center queueing. Runs fully **without** the Go server while mock mode is active.

> **Disclaimer.** This project is not affiliated with BPJS Kesehatan or any other institution. Do not commit real patient data. API keys and production configuration must only come from environment variables; they must never enter the repository.

## Prerequisites

| Requirement | Version |
|---|---|
| [Bun](https://bun.sh) | ≥ 1.4 |
| Node.js | only for `bunx shadcn` (optional) |
| Windows | only for building `antrian-client.exe` |

The Go server is optional — the app runs fully against mock data:
<https://github.com/SonyPradana/simpus-antrian-server>

## Running

```powershell
bun install
bun run dev      # http://localhost:5173  (hot reload, BFF :3000)
```

To use the production build:

```powershell
bun run build    # vite build + compile antrian-client.exe
bun run start    # http://localhost:3000
```

## Mock mode vs real API

Default is **mock**: all data comes from `src/server/mock.ts`, no request reaches the Go API. The header shows a **MOCK** badge while this mode is active.

To use the real Go API: set `APM_API_KEY` in the BFF environment, then in **Settings** turn off "Mock mode" and fill in the Base URL (default `http://localhost:8080`). Without a key, APM API requests are rejected with `APM_NOT_CONFIGURED`.

All calls use the facade `/api/v1/apm/*` (see [`docs/conventions.md`](docs/conventions.md)). Location names are not sent; the client only sends `poscheck_id`.

Mock-mode simulation (identifier must be digits):

| Marker | Result |
|---|---|
| ends with `9` | patient not found (lookup `mode=new`, registration `404`) |
| contains `6666` | BPJS inactive (lookup `mode=existing_inactive` → new patient number) |
| contains `7777` | already registered today (treated as success) |
| contains `8888` | doctor quota exhausted (failed) |

## Features

- **Manual** — 3 steps: identity + location → doctor → confirmation. The lookup result decides whether the patient gets registered or only receives a queue number (new patient / inactive BPJS).
- **No-identity patient** — a dedicated checkbox to issue a number without lookup (mode `blank`, `petugas_id` not sent).
- **Batch input** — paste many identities (one per line), pick doctor/poli, reorder with drag, then send/pause/stop.
- **Batch Excel** — drop `.xlsx`, columns are auto-detected (NIK > BPJS > No. RM), mapping can be fixed manually.
- **Duplicates rejected** — the same identity + poli + doctor combination is never sent twice.

The queue is stored in SQLite, so refreshing the browser does not clear it.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | BFF port |
| `ANTRIAN_DB` | `./data/antrian.db` | SQLite file |
| `APM_API_KEY` | *(empty)* | APM API key (required in non-mock mode) |
| `AUTH_PASSWORD` | *(empty)* | enable login |

Details: [`.env.example`](.env.example).

## Theme

Dark by default, manual toggle in the header. The choice is stored in `localStorage`.

## Structure & contribution

- [`docs/conventions.md`](docs/conventions.md) — folder map, code conventions, known traps.

## Commands

```powershell
bun test           # unit tests
bun run typecheck  # tsc --noEmit
bun run build:web  # UI bundle only
```

## License

MIT. See [`LICENSE`](LICENSE).