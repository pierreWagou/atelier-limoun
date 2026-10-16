# Deployment runbook — VPS + Dokploy

Ops guide for deploying and operating atelier-limoun.fr. Architecture and local development live in the [README](../README.md).

Production topology:

```
atelier-limoun.fr           → public site (Astro, static)
cms.atelier-limoun.fr       → Strapi admin (your friend edits here)
deploy.atelier-limoun.fr    → Dokploy dashboard
*.preview.atelier-limoun.fr → PR previews (Astro)
```

## 1. VPS (one-time)

```bash
# Ubuntu 24.04, non-root user with SSH key
sudo apt update && sudo apt upgrade -y
sudo apt install -y fail2ban unattended-upgrades
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
# Install Dokploy (official)
curl -fsSL https://dokploy.com/install.sh | sh
```

## 2. DNS (Cloudflare)

| Type | Name      | Target     | Proxy |
| ---- | --------- | ---------- | ----- |
| A    | `@`       | VPS IP     | yes   |
| A    | `cms`     | VPS IP     | no    |
| A    | `deploy`  | VPS IP     | no    |
| A    | `*`       | VPS IP     | yes   |

## 3. Dokploy

1. Open `https://deploy.atelier-limoun.fr`, create the admin account, **enable 2FA**.
2. **Certificates** → create a wildcard cert for `*.preview.atelier-limoun.fr` via **DNS-01** with a Cloudflare token (scope: Zone → DNS → Edit, single zone).
3. **Database** → Postgres service (note host/port/name/user/password — never expose it publicly).
4. **Project** → 2 apps from this GitHub repo:
   - **cms**: root directory `cms`, build `npm run build`, start `npm start`, domain `cms.atelier-limoun.fr`. Env: `DATABASE_CLIENT=postgres` + the service's `DATABASE_*`, `APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `JWT_SECRET` (generate with `openssl rand -hex 16`).
   - **site**: root directory `site`, build `npm run build`, start `npx serve dist` (or adapt), domain `atelier-limoun.fr`. Env: `STRAPI_URL=https://cms.atelier-limoun.fr`, optional `STRAPI_TOKEN`.
5. **Preview deployments** → enable on the **site** app (one PR = one instance at `pr-<n>.preview.atelier-limoun.fr`).
6. **GitHub integration** → auto-deploy on push to `main`.

## 4. Auto-rebuild after CMS publish

In the Strapi admin → **Settings → Webhooks** → create a `site-rebuild` webhook:

- URL: the Dokploy deploy hook URL for the **site** app (or a GitHub workflow dispatch)
- Events: Create & Update for **Page** and **Project**

Or set `SITE_REBUILD_URL` / `SITE_REBUILD_TOKEN` on the CMS side (the lifecycle code already calls them).

## 5. CMS security

`cms.atelier-limoun.fr` is public but protected by the Strapi login. Additionally:

- Strong admin password + **Strapi 2FA** if available,
- Optional but recommended: **Cloudflare Access** (free tier, 1 user) in front of `cms.` — your friend gets a code by email,
- The CMS public permissions only allow **reading** published content (no writes).

## 6. Backups

- Weekly Postgres dump: `docker exec <pg-container> pg_dump -U strapi strapi | gzip > backup-$(date +%F).sql.gz`
- Strapi uploads (`cms/public/uploads`) live on the app's volume — include them in the backup.
- See Dokploy → Settings → Backups (S3-compatible if available).

## Handover (your friend)

1. Go to `cms.atelier-limoun.fr`, log in (account created by you).
2. **Home** for the landing page, **Project** to add projects (images via the media library), **Page** for static pages.
3. Click **Publish** → the site auto-rebuilds in ~1 min.
