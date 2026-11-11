# Security Policy

## Reporting a Vulnerability

Do not open a public issue for security problems. Report through
[GitHub Security Advisory](https://github.com/SonyPradana/simpus-antrian-client/security/advisories/new)
or contact the repository owner directly.

Include: the version you are running, reproduction steps, and impact.

## Sensitive Data

This repo **must not** contain patient data, credentials, or production
configuration.

| Data | Correct location |
|---|---|
| `APM_API_KEY` | BFF environment only |
| `AUTH_PASSWORD` | BFF environment only |
| Patient / queue data | local SQLite (`data/`), not committed |
| `.env` files | local only, not committed (see `.gitignore`) |

If you find committed credentials, treat them as already leaked: rotate the
key, then report it.

## Scope

- The BFF uses an `HttpOnly` + `SameSite=Lax` session cookie when
  `AUTH_PASSWORD` is set.
- Every call to the Go server goes through the BFF; the API key is never sent
  to the browser.
- Mock mode is opt-in through `MOCK_API=1`. The default is the real Go API, so
  a production deploy never silently serves fixture data.
