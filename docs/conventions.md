# Conventions — client

Contribution guide and code map for this repo.

## 1. Stack

| Area | Choice |
|---|---|
| Runtime / package manager | Bun 1.4 |
| BFF | Elysia 1.4 + `@elysiajs/static` |
| UI | React 19 + Vite 8 + TypeScript 7 (strict) |
| Styling | Tailwind v4 + shadcn/ui (preset `radix-nova`) |
| Theme | `next-themes`, manual, dark default |
| Drag-drop table | `@dnd-kit/sortable` |
| Excel | `read-excel-file/browser` |
| Validation | zod (contract) + `t` Elysia (route body) |
| Storage | `bun:sqlite` |

## 2. Folder map

```
src/
  server/      BFF: db, antrian (HTTP client), loket (external actions), mock,
               batch, auth, index (route)
  shared/      shared by server + web + tests; includes loket.ts (pure rules)
  web/         React
    pages/     Manual, Batch
    components/ app components (not shadcn)
    lib/       api client, format
  components/ui/  shadcn — do NOT edit manually
  lib/utils.ts    `cn` from `cn` package (used by shadcn)
test/          unit tests (`*.test.ts`)
docs/          conventions.md
```

**Where to put new code:**

| Kind of code | Location |
|---|---|
| API data shapes | `src/shared/schema.ts` — the only place |
| Client-owned types (Job, QueueItem, Settings) | `src/shared/types.ts` |
| Pure testable logic (excel, dedupe, identifier, loket validation/payload) | `src/shared/*.ts` |
| Routes / DB access / executor | `src/server/*.ts` |
| Page components | `src/web/pages/` |
| Reusable components | `src/web/components/` |
| HTTP calls from browser to BFF | `src/web/lib/api.ts` |

Do not put business logic inside React components. If a rule can be tested
without React (validation, dedupe, parsing), put it in `shared/` and write a
test for it.

## 3. Data flow

```
UI (web/) -> /api/* (BFF Elysia) -> AntrianApi -> Go API
                                    \-> mock (MOCK_API=1)
                                    \-> LoketApi -> external queue app
```

The browser **never** calls the Go API directly. Everything goes through the
BFF so that: no CORS is needed, the API key does not leak, and batch status can
be stored in SQLite.

`AntrianApi` (`src/server/antrian.ts`) is the interface; it has two
implementations: `createAntrianApi()` (HTTP to `/api/v1/apm/*`) and
`createMockApi()` (fixture). To add a Go endpoint, add a method to the
interface **and** both implementations.

APM rules that apply (server contract §2.9):

- Every request needs an `x-api-key` header. The key only comes from the BFF
  env var `APM_API_KEY`; never store it in SQLite, settings, or the browser.
- Location names are **not** sent. Send `poscheck_id`; the server resolves the
  name from the `poschecks` table. A `lokasi` field in the body is rejected
  (`400 INVALID_INPUT`).
- `POST /apm/queue` has two modes: `registration` (identifier + `petugas_id`)
  and `blank` (no identifier and no `petugas_id`).
- `POST /apm/lookup` always returns 200; the mode decision is in
  `mode`/`can_register`. Use `actionForLookup` in `src/shared/mode.ts`, do not
  guess.
- Lookup uses `pcare=false`; registration uses `pcare=true`.

### External loket actions

`LoketApi` (`src/server/loket.ts`) talks to external apps only from the BFF.
`src/shared/loket.ts` holds the pure Hadir payload builder and validator shared
with the browser.

- Print posts `{"kode":"B001","force":false}` plus `X-API-Key` to
  `${PRINT_API_BASE_URL}/api/print`. The legacy form endpoint was removed; the
  terminal handles the legacy print server and the `printer = 'medium'` flag.
  `force: true` is used only by `Cetak Ulang`. `409 ALREADY_REQUESTED` and
  `ALREADY_PRINTED` are idempotent successes. HTTP 200 only means the command
  was accepted; it is not proof that paper was printed.
- Both print and Hadir are manual only, from the Step 4 buttons. `Simpan`
  (`POST /api/queue`) never triggers either action. Neither action claims that
  paper was printed or that BPJS was updated.
- Hadir still posts the four form fields to `${HADIR_API_BASE_URL}/Hadir`. It
  needs `ci_session` hydration, follows the `303` redirect, and treats success
  text in the body as authoritative. The hydration data unit is derived from
  `PRINT_UNIT_ID` (`99→Pendaftaran_1`, `96→Pendaftaran_2`,
  `88→Pendaftaran_3`). HTTP 500 can still contain a success message. Retry only
  once, and only for a lost session — never after success or a 500 response.
- `GET /api/health` checks `${PRINT_API_BASE_URL}/healthz`. When the terminal
  is unavailable, `printBackendReady` is `false` and only Cetak is disabled;
  Hadir is unaffected.
- Batch jobs may print per row when the row is opted in and print is
  configured. Hadir is never part of a batch. A print failure keeps the
  registration status successful and appends a note to `message`.

### Environment

`src/server/config.ts` reads `.env` from the working directory and never
overrides a variable that is already set in the shell.

| Variable | Default | Meaning |
|---|---|---|
| `MOCK_API` | `0` | `1` = fixture, `0` = real Go API |
| `APM_BASE_URL` | settings | overrides the Settings base URL |
| `APM_API_KEY` | *(empty)* | APM facade key, BFF only |
| `AUTH_PASSWORD` | *(empty)* | enables login |
| `PRINT_API_BASE_URL` | *(empty)* | terminal base URL; empty disables Cetak |
| `PRINT_API_KEY` | *(empty)* | terminal API key, BFF only |
| `HADIR_API_BASE_URL` | *(empty)* | legacy app base URL; empty disables Hadir |
| `PRINT_ENABLED` | from URLs | explicit kill switch for both loket actions |
| `PRINT_UNIT_ID` | `99` | selects the Hadir session data unit |
| `PRINT_TIMEOUT_MS` | `5000` | timeout per external request |

The effective gates are `PRINT_ENABLED && !MOCK_API`, then `PRINT_API_BASE_URL
!== "" && PRINT_API_KEY !== ""` for Cetak and `HADIR_API_BASE_URL !== ""` for
Hadir. Mock is **not** part of `Settings` and is not editable from the UI; it is
decided at process start. Mock mode always disables external loket actions.

## 4. Adding a shadcn component

```powershell
bunx shadcn@latest add <name>
```

- Do **not** use `--bun`; the CLI needs Node.
- `bunx` often exits with code 1 in PowerShell even on success; verify via the
  files that appear in `src/components/ui/`.
- Do not edit files in `components/ui/`; wrap them in `web/components/` when
  special behavior is needed.

## 5. Adding a BFF route

Follow the pattern in `src/server/index.ts`:

1. Validate the body with a `t` schema as the second argument
   (`{ body: SomeSchema }`).
2. Reply `{ data }` on success, `{ error: { code, message } }` on failure.
3. Forward the HTTP status from the Go API via the `errorStatus(error)` helper.
4. Do not throw to Elysia for domain errors — return the envelope.

## 6. Theme

- Default **dark**, manual toggle in the header (`ThemeToggle`), no "follow
  system" option. The choice is stored in `localStorage` under
  `antrian-theme`.
- `next-themes` puts `.dark` on `<html>`; that matches `@custom-variant dark`
  in `src/index.css`.
- Do not hardcode colors. Use tokens (`bg-background`,
  `text-muted-foreground`, `border-border`, `text-destructive`, etc.). For
  status colors, see `StatusBadge` as an example of the light/dark pair.

## 7. Tests

- `bun test`, files `test/*.test.ts`, import via the `@/` alias.
- Required tests: Excel parser, identity normalization, dedupe, batch executor,
  loket payload/validation/HTTP classification. Not required: presentational
  components.
- Tests must be able to **fail** when business rules change. Do not test that a
  function "does not throw error".

## 8. Known traps

| Symptom | Cause / fix |
|---|---|
| `bun add` exit code 1 | PowerShell treats stderr as error. Check `package.json`, not exit code. |
| `bunx shadcn --bun` fails | Run without `--bun`. |
| `Option 'baseUrl' has been removed` | TypeScript 7; use `paths` only. |
| `read-excel-file` has no root export | Import `read-excel-file/browser`. |
| `cookie.set()` is not a function | Elysia 1.4: `cookie` is read-only; use `set.headers["Set-Cookie"]`. |
| `t.Boolean` error | Must be `t.Boolean()` (called). |
| Toast does not follow theme | `ThemeProvider` must be above `Toaster` (`main.tsx`). |
| NIK broken from Excel | `normalizeIdentifier` rejects scientific notation / wrong length. |
| `400 INVALID_INPUT` on queue | Body contains `lokasi` (or identifier in `blank` mode). Send `poscheck_id` only. |
| `503 APM_NOT_CONFIGURED` | `APM_API_KEY` not set in BFF, or `MOCK_API=0` without key. |
| All APM requests rejected 401 | `x-api-key` header wrong/empty; key must not go in settings/browser. |
| `SQLITE_CANTOPEN` when running exe | `data/` folder missing. Since v0.1.0 `Store` creates it automatically. |