<div align="center">

![header](https://capsule-render.vercel.app/api?type=waving&height=220&color=0:cba6f7,25:b4befe,50:89dceb,75:f5c2e7,100:f38ba8&text=atelier-limoun&fontSize=60&fontColor=11111b&desc=craft%2C%20served%20static&descSize=18&descAlignY=62&descAlign=50&fontAlignY=38&animation=fadeIn&fontAlign=50)

[![CI](https://github.com/pierreWagou/atelier-limoun/actions/workflows/ci.yml/badge.svg)](https://github.com/pierreWagou/atelier-limoun/actions/workflows/ci.yml)
![Astro](https://img.shields.io/badge/Astro-FF5D01?logo=astro&logoColor=white)
![Strapi](https://img.shields.io/badge/Strapi-4945FF?logo=strapi&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Dokploy](https://img.shields.io/badge/Dokploy-self--hosted-1a1a2e?logo=docker&logoColor=white)
![Cloudflare](https://img.shields.io/badge/Cloudflare-F38020?logo=cloudflare&logoColor=white)

</div>

---

Showcase website for Atelier Limoun, a craft atelier. Content is edited by the atelier owner through a headless CMS — no code, ever.

## Overview

- **Headless CMS** — Strapi 5 admin at `cms.atelier-limoun.fr`; the owner writes pages and projects through the UI
- **Static by default** — Astro builds the public site from the content API; nothing dynamic to secure or scale
- **One-VPS deploy** — Dokploy orchestrates both apps + Postgres behind Traefik with automatic HTTPS
- **PR previews** — every pull request gets its own instance on `*.preview.atelier-limoun.fr`
- **Auto-rebuild** — publishing in the CMS triggers a site redeploy via webhook
- **Quality gates** — Biome + gitleaks on commit, Vitest + typechecks on push, Playwright smoke on PR

## Architecture

```
                     LOCAL DEV (mise run dev → mprocs)
 ┌──────────────────────────────────────────────────────────────┐
 │  cms :1337     site :4321     tests     types-site  types-cms│
 │  (Strapi)      (Astro)       (Vitest)   (astro       (tsc)  │
 │                                                 check)       │
 └──────────────────────────────────────────────────────────────┘

                        PRODUCTION (Dokploy)
 ┌──────────────┐      ┌───────────────────────────────────────┐
 │  Cloudflare  │      │                 VPS                   │
 │  DNS + proxy │ ───► │  Traefik (auto-HTTPS)                 │
 └──────────────┘      │   ├── atelier-limoun.fr  → site (static)
                       │   ├── cms.atelier-limoun.fr → Strapi  │
                       │   ├── deploy.atelier-limoun.fr → UI   │
                       │   └── *.preview.* → PR previews       │
                       │  Strapi ──► Postgres (internal only)  │
                       └───────────────────────────────────────┘
        publish webhook ──► rebuild site from content API
```

Deployment steps (VPS, DNS, Dokploy, backups, handover) live in [docs/deploy.md](docs/deploy.md).

## Structure

```
atelier-limoun/
├── site/               # Astro — static build, fetches Strapi at build time
│   ├── e2e/            # Playwright smoke specs (plumbing, not content)
│   └── src/lib/strapi.ts  # CMS client — the API contract
├── cms/                # Strapi 5 — Global, Home, Page, Project content types
│   └── src/index.ts    # bootstrap: demo seed + public read permissions
├── docs/deploy.md      # VPS + Dokploy ops runbook
├── AGENTS.md           # rules for AI coding agents (cross-harness)
├── package.json        # the command registry — every cross-app command
├── lefthook.yml        # git hooks (pre-commit, pre-push)
├── .github/workflows/  # CI (lint, typecheck, unit, E2E)
├── mise.toml           # contributor tasks (setup, dev, test)
├── mprocs.yaml         # dev services
├── biome.jsonc         # formatting + linting
└── gitleaks.toml       # secret detection rules
```

## Getting Started

### Prerequisites

- [mise](https://mise.jdx.dev) — manages Node.js version and dev tasks (npm comes with it)
- [gitleaks](https://github.com/gitleaks/gitleaks) — secret scanning (`brew install gitleaks`)

### Local development

```bash
# Install Node.js + all dependencies (site, cms, Playwright browser)
mise install && mise run setup

# Start the full dev environment (5 panes: cms, site, tests, typechecks)
mise run dev
```

In the mprocs TUI: `Tab`/`n`/`p` move between panes, `r` restarts the focused pane, `q` kills it, `Q` quits everything.

Without mise: install Node matching `.node-version`, then `npm install` in `/`, `site/`, `cms/`, and copy each app's `.env.example` to `.env`.

## Development

### Content types

| Type | Shape |
|---|---|
| **Global settings** | singleton — site name, contact, social links, footer |
| **Home** | singleton — title, subtitle, hero image, intro |
| **Page** | draft & publish — title, slug, rich content, hero |
| **Project** | draft & publish — title, slug, description, cover + gallery, `order` |

The CMS bootstrap seeds demo content on first boot and grants public **read-only** API access.

### Quality gates

| When | What | Tools |
|---|---|---|
| `git commit` | format + lint staged files, block secrets | Biome (auto-fix, restaged), gitleaks |
| `git push` | unit tests + typecheck both apps | Vitest, `astro check`, `tsc --noEmit` |
| PR (CI) | everything above + build + E2E smoke | Playwright against seeded CMS |

E2E specs assert **plumbing** (pages render, navigation works, no console errors) against the demo seed — never the editorial content, which changes weekly.

### CMS → site flow

The site reads `/api/global`, `/api/home`, `/api/pages`, `/api/projects` through `site/src/lib/strapi.ts` at build time. Changing a content type means updating, in one change: the schema, the bootstrap seed, the client, and the affected specs (see [AGENTS.md](AGENTS.md)).

## Quick Reference

| Action | Command |
|---|---|
| Setup | `mise run setup` |
| Dev | `mise run dev` |
| Lint | `npm run lint` |
| Typecheck | `npm run check` |
| Unit tests | `npm run test` |
| E2E | `npm run test:e2e` |
| Secret scan | `npm run secret-scan` |

## License

Private — all rights reserved.
