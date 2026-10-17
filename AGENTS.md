# Atelier Limoun — AI Agent Guidelines

## Project

Showcase website for a friend's craft atelier — `atelier-limoun.fr`.
Astro 7 static site (`site/`) + Strapi 5 headless CMS (`cms/`; SQLite locally, Postgres in prod) on a single VPS behind Dokploy and Cloudflare. The site is built from the CMS API at deploy time — editorial content lives in the CMS, not in the repo. The owner edits content herself through the Strapi admin UI; she is non-technical and must never be routed to code or git.

## Rules

### Commands & gates

- Root `package.json` is **the command registry** (`lint`, `lint:fix`, `lint:ansible`, `lint:ansible:fix`, `check`, `check:site`, `check:cms`, `test`, `test:e2e`, `secret-scan`, `setup`). lefthook, CI and mise must call these scripts, never re-spell the underlying commands. Exception: pre-commit jobs in `lefthook.yml` keep raw `biome`/`gitleaks` invocations because they need `{staged_files}` substitution — hook plumbing, not a portable primitive.
- Before finishing any task, keep the gates green: `npm run lint`, `npm run lint:ansible`, `npm run check`, `npm run test`. CI additionally runs the Playwright smoke against a seeded CMS.

### Language & content

- All repo artifacts (docs, comments, commit messages, tooling) are in English.
- The **website content** (Strapi seed data, hardcoded UI strings in `site/src/pages/`) is French for now and will move to English through the CMS later — do not "fix" it.

### CMS contract

- The site reads `/api/global`, `/api/home`, `/api/pages`, `/api/projects` through `site/src/lib/strapi.ts`.
- Any content-type schema change must update, in the same change: that client, the bootstrap seed (`cms/src/index.ts`), and the E2E specs if they touch the affected content.
- Public API permissions are read-only (granted in bootstrap) — never grant write access to the public role.
- E2E specs assert plumbing against the demo seed content ("Exemple de projet", "a-propos"); keep them independent of editorial content the owner changes weekly.

### Deployment

- Each app's `npm run build` / `npm start` (cms) and build/serve commands (site) are the **deployer contract** — exactly what Dokploy runs in production. Changing them requires updating the deployment runbook (`docs/deploy.md`) in the same change.
- The ops runbook (VPS, DNS, Dokploy, rebuild webhook, backups, handover) lives in `docs/deploy.md`.
- The docs site builds via `npm run docs:build` (VitePress, root devDep) and deploys through `.github/workflows/docs.yml` to GitHub Pages. `docs/index.md` includes the README — keep that include working when restructuring either file.

### Secrets

- Never commit secrets. Only `.env.example` files are tracked; real `.env` files are gitignored; production secrets live in Dokploy env vars.
- `gitleaks` blocks commits containing secret-like strings; don't add allowlist entries for real secrets.

### Node

- `.node-version` at the root is the single source of truth (read by fnm, mise, Nixpacks). `engine-strict` is on in each app's `.npmrc`; do not bypass it.
