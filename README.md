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
bun run dev      # http://localhost:5173  (hot reload, BFF :3000, mock)
```

To use the production build:

```powershell
bun run build    # vite build + compile antrian-client.exe
bun run start    # http://localhost:3000
```

## Mock mode vs real API

Mock is **not** a runtime toggle. It is decided by the BFF environment at
startup: `MOCK_API=1` serves fixture data, anything else (or unset) talks to
the real Go API. The default is `0`.

| Situation | How |
|---|---|
| local dev | `bun run dev` sets `MOCK_API=1` inline |
| staging | edit `.env`, point `APM_BASE_URL` at the test server |
| production | `.env` next to the exe with the real `APM_API_KEY` |

One `.env` file only. Variables already set in the shell win over the file, so
`MOCK_API=1 bun run start` overrides it for a single run.

The header shows a **MOCK** badge only when mock is on, so an operator can
never mistake fixture data for real patients.

To use the real Go API: copy `.env.example` to `.env`, set `APM_API_KEY` and
`APM_BASE_URL`, then `bun run start`. Without a key, APM API requests are
rejected with `APM_NOT_CONFIGURED`.

All calls use the facade `/api/v1/apm/*` (see
[`docs/conventions.md`](docs/conventions.md)). Location names are not sent; the
client only sends `poscheck_id`.

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
| `MOCK_API` | `0` | `1` = fixture data, `0` = real Go API |
| `PORT` | `3000` | BFF port |
| `ANTRIAN_DB` | `./data/antrian.db` | SQLite file |
| `APM_BASE_URL` | *(settings)* | Go API base URL; overrides Settings |
| `APM_API_KEY` | *(empty)* | APM API key (required when `MOCK_API=0`) |
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