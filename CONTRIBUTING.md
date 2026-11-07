# Contributing

## Process

1. Fork the repo, create a branch from `main` (`feat/...`, `fix/...`, `docs/...`).
2. Run local checks before pushing:

```powershell
bun install
bun run lint
bun run typecheck
bun test
```

3. Open a pull request to `main`. CI must be green.

## Code Rules

Full guide in [`docs/conventions.md`](docs/conventions.md). Short version:

- API data shapes only in `src/shared/schema.ts` (zod).
- Logic testable without React goes in `src/shared/` and gets tests.
- No business logic inside React components.
- Do not edit `src/components/ui/` (owned by shadcn); wrap in `src/web/components/` if needed.
- Format and lint with Biome: `bun run format`, `bun run lint`.

## Tests

- Test files: `test/*.test.ts`, import via `@/` alias.
- Tests must be able to fail when business rules change.
- Do not test that a function "does not throw error".

## Commits

Use Conventional Commit messages:

```
feat(manual): add no-identity mode
fix(server): create data folder before opening SQLite
docs: clarify how to run
```

## Data

Never include real patient data, API keys, or `.env` files in commits. Fixtures are synthetic data.