# Deployment runbook — VPS + Dokploy

Ops guide for deploying and operating atelier-limoun.fr. Architecture and local development live in the [README](../README.md).

Production topology:

```
atelierlimoun.fr           → public site (Astro, static)
cms.atelierlimoun.fr       → Strapi admin (your friend edits here)
deploy.atelierlimoun.fr    → Dokploy dashboard
*.preview.atelierlimoun.fr → PR previews (Dokploy generates preview-<app>-<id>.…)
```

## 1. VPS (one-time, reproducible via Ansible)

The VPS baseline (users, SSH hardening, swap, UFW, fail2ban, auto-updates)
is code in `ansible/` — re-runnable and reviewable. Ansible is agentless: it is
installed on your laptop via mise, the VPS only needs SSH + Python (Ubuntu
26.04 ships both).

::: tip Why swap is in the baseline
The box has 3.8 GB RAM and Nixpacks builds run on it. An OOM-killed build
on 2026-10-19 (no swap at the time) spiked load to 35, starved the
tunnel's QUIC connections (instant edge 530s) and flapped the Dokploy
swarm service. The `swap` role (4 GB, swappiness 10) turns build spikes
into slowness instead of kills. If the edge ever 530s again, check
`dmesg | grep -i oom` and `free -m` first.
:::

```bash
# One-time per contributor: ansible + all other dev tools
mise install

# ...and activate mise in your shell (once — puts its tools on PATH;
# without this, bare calls like ansible-lint fail with "command not found"):
eval "$(mise activate zsh)"   # bash + ~/.bashrc on Linux; persist in ~/.zshrc

# First converge only, while just the OVH image user exists
# (afterwards `wagou` is the default — use the plain tasks):
mise run ops:check:first

# Dry-run first: shows what WOULD change, changes nothing
mise run ops:check

# Apply. Keep this SSH session open and verify a NEW login works
# before closing it (SSH hardening disables passwords + root login).
mise run ops:converge
```

The target (IP), users, and admin SSH keys are committed in
`ansible/group_vars/all/main.yml` — the host is identical for everyone and
the keys are public by design. Granting someone access = adding their pubkey
to `vps_users` via PR. To point at a different address in an emergency
(e.g. a fresh IP before DNS cutover): `ATELIER_LIMOUN_VPS_HOST=<ip>`.

### The dedicated atelier-limoun SSH key

VPS access uses its own keypair — never a personal or work key — so revoking
atelier-limoun access never touches homeserver access and vice versa:

```bash
# Generated once on your Mac (passphrase prompt — use one, Keychain remembers it)
ssh-keygen -t ed25519 -C "atelier-limoun" -f ~/.ssh/id_ed25519_atelier_limoun
ssh-add --apple-use-keychain ~/.ssh/id_ed25519_atelier_limoun
# Back up the private key encrypted (Bitwarden secure note). The .pub goes in vps_users below.
```

Pin it for the host in `~/.ssh/config` (explicit `IdentityFile` also avoids
the multi-key `MaxAuthTries` trap):

```
Host atelier-limoun
    HostName 149.202.40.156
    User wagou
    IdentityFile ~/.ssh/id_ed25519_atelier_limoun
    AddKeysToAgent yes
    UseKeychain yes
```

Rollout is two converges so a bad key can never lock you out:

1. **Add, don't replace**: append the new `.pub` to `ubuntu` + `wagou` in
   `vps_users`, converge (authenticating with the old key), then verify from
   a new session with *only* the new key:
   `ssh -i ~/.ssh/id_ed25519_atelier_limoun -o IdentitiesOnly=yes wagou@149.202.40.156`.
2. **Remove**: delete the old personal-key lines, converge again. Old keys
   are dead from that point; homeservers are untouched.

### Onboarding Chloe (SSH access when she's ready)

Chloe's account exists but is locked (no keys yet). When she needs SSH:

1. Generate an ed25519 pair: easiest is Termius (Settings → Keychain → + generates
   in-app, no terminal needed). Otherwise generate one for her and hand over the
   private key via Bitwarden Send (one-time link, not email/chat).
2. She sends back the `.pub` line; add it to her `keys:` in `vps_users` via PR.
3. `mise run ops:converge` — her login activates. Verify with
   `ssh chloe@<vps-ip>` before telling her it's ready.

She has sudo (break-glass only — day-to-day she uses the Strapi web UI, never
SSH). Revoking later = removing the key line + converge.

### The `ubuntu` account (break-glass, not daily use)

`ubuntu` is the original OVH image user, kept and managed by Ansible so its
access can't drift outside the repo. Same keys as `wagou`, sudo, never used
day-to-day. Reach for it only if the personal accounts are locked out (lost
keys). If SSH itself is broken (bad `sshd_config`, firewall lockout), no
account helps — use OVH rescue mode (Fallback below).

Re-running `ops:converge` is always safe (idempotent): the second run reports
zero changes. To converge again after a repo change, just re-run it.

### Secrets

App secrets (Strapi keys, `DATABASE_*`) stay in the **Dokploy env UI**, never
in git. Host-level secrets (currently: the Cloudflare Tunnel token; later
candidates: a backup-encryption passphrase, an SMTP relay password, a
Cloudflare API token) live in `ansible/group_vars/all/secrets.sops.yml`,
encrypted with **`sops` + `age`** (recipients in `.sops.yaml`). The tunnel
role deploys them; values never appear in logs (`no_log`) or git history
in plaintext.

Contributor setup (one-time, via mise): `mise install` provides `sops` +
`age`. Your private key lives at `~/.config/sops/age/keys.txt` — generated
with `age-keygen -o ~/.config/sops/age/keys.txt`, never shared, backed up
in Bitwarden like the SSH key.

Onboarding a new contributor: they PR their `age1…` public key into
`.sops.yaml`; a maintainer runs
`sops updatekeys ansible/group_vars/all/secrets.sops.yml` and commits the
re-encrypted file. Without a key, any converge fails fast at decryption
with a sops error — that is intentional (fail fast, not halfway).

Rotation (e.g. recipient added/removed): regenerate the value at its
source (tunnel token: Zero Trust → Networks → Tunnels → `atelier-vps`),
update the sops file, `sops -e -i` is not needed for edits —
`sops ansible/group_vars/all/secrets.sops.yml` opens the decrypted editor —
then converge.

Explicit non-goals: no ansible-vault (shared-passphrase distribution
problem). Emergency interim if sops is ever unusable:
`ansible-vault create` with `--ask-vault-pass` (interactive prompt, zero
setup), replaced by sops right after.
### Fallback: OVH rescue mode

If Ansible/SSH is ever unusable (e.g. rescue mode after an SSH or firewall
breakage), reinstall the server from the OVH manager (the imperative
bootstrap script was retired 2026-10 — the Ansible baseline is the single
source of truth), then re-run this whole section: converge, Dokploy
install, tunnel converge.

Then install Dokploy (official, kept manual so the version stays explicit):

```bash
curl -fsSL https://dokploy.com/install.sh | sh
```

## 2. DNS + Cloudflare Tunnel (hides the VPS, no open web ports)

Prerequisite: `atelierlimoun.fr` lives on Cloudflare (free plan) — add the
domain, copy the 2 assigned nameservers into the OVH manager (Domains →
`atelierlimoun.fr` → DNS servers → custom), wait for `Active`. Keep the OVH
zone (with its MX records) intact for a week as rollback. Mail stays at OVH
(MX untouched, always grey-cloud — never proxy mail).

Traffic flow afterwards (Dokploy's official tunnel pattern):

```
visitor ──TLS──▶ Cloudflare edge ──tunnel (outbound 7844)──▶ cloudflared ──http://localhost:80──▶ Traefik ──▶ apps
```

No Let's Encrypt anywhere, no open 80/443 on the VPS (UFW is SSH-only),
no Cloudflare Access in v1 (it conflicts with Dokploy's auth — app logins
are the boundary). Cloudflare SSL/TLS mode → **Full (strict)**.

### Tunnel setup (Cloudflare dashboard, manual)

1. **Zero Trust → Networks → Tunnels → Create tunnel** → `atelier-vps`
   (connector type Cloudflared). Copy the **token** — it is shown once.
2. **Public hostnames** (routes), each → Service URL `http://localhost:80`:

| Hostname | Purpose |
|---|---|
| `atelierlimoun.fr` | site (apex — Cloudflare flattens the CNAME automatically) |
| `www.atelierlimoun.fr` | site alias |
| `cms.atelierlimoun.fr` | Strapi admin |
| `deploy.atelierlimoun.fr` | Dokploy dashboard |
| `preview.atelierlimoun.fr` | PR previews landing (Dokploy) |
| `*.preview.atelierlimoun.fr` | PR previews (Dokploy generates `preview-<app>-<id>.preview…`) |

   Each route auto-creates a proxied (orange) DNS record. Nothing is grey:
   the origin IP never appears in DNS.
3. If a nested preview hostname ever shows a cert error at the edge, check
   Total TLS coverage first; fallbacks in order: Advanced Certificate Manager
   → disable PR previews until resolved (site unaffected).

### Connector + firewall (on the VPS, via Ansible)

The tunnel token is managed by Ansible now: it is decrypted from
`ansible/group_vars/all/secrets.sops.yml` on your laptop at converge time
and deployed to the host as `/etc/cloudflared/token` (`0600 root:root`).
No manual paste needed — just converge (tunnel role installs `cloudflared`,
writes the systemd unit, deploys the token, starts the connector; firewall
role then drops 80/443 — safe order, same run):

```bash
mise run ops:check && mise run ops:converge
```

Fallback (no age key, or sops unusable): place the token manually as root
(typed/pasted, never committed, never in shell history — write from a file,
then shred it), and converge skips the sops task:

```bash
install -m 600 /dev/stdin /etc/cloudflared/token <<'EOF'
<paste token>
EOF
```

3. Verify: tunnel shows **Healthy** in the dashboard, `ufw status` allows
   only `22/tcp`, `curl -sI https://cms.atelierlimoun.fr` returns 200
   through Traefik. From outside: `nc -vz 149.202.40.156 80` must fail.

Rollback (each step verified independently): stop cloudflared → reopen
80/443 by temporarily setting `firewall_extra_open_ports: [80, 443]` in
`ansible/group_vars/all/main.yml` and converging (or raw
`ansible-playbook … -e firewall_extra_open_ports=[80,443]`, since npm scripts
don't forward extra args) → origin serves directly again. DNS CNAMEs keep
resolving throughout; only the origin path changes.

## 3. Dokploy (behind the tunnel — no TLS here)

Install Dokploy *before* the tunnel converge (its installer requires ports
80/443/3000 free to listen on — UFW state doesn't matter, listeners do):

```bash
curl -fsSL https://dokploy.com/install.sh | sh
```

::: warning Ubuntu 26.04 caveat (hit 2026-10-18, Dokploy v0.30.8)
The VPS runs Ubuntu 26.04 (resolute). Dokploy v0.30.8's installer pins
Docker CE 28.5.0, which does not exist for resolute (repo minimum is 29.x —
upstream issues Dokploy/dokploy#4501, #5471). The installer fails at
`Failed to initialize Docker Swarm` and leaves holds on the uninstalled
packages. Workaround (why the manual Docker install below is legitimate):
unhold, install Docker 29.x from the official resolute repo the installer
already configured, then re-run the installer (it detects Docker and skips
that step):

```bash
sudo apt-mark unhold docker-ce docker-ce-cli docker-ce-rootless-extras
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
curl -fsSL https://dokploy.com/install.sh | sudo sh
```

Installed this way on 2026-10-18: Docker 29.9.1 + Dokploy v0.30.8
(dokploy / dokploy-traefik / dokploy-postgres healthy, swarm active).
Re-check the upstream issues before the next fresh install — a fixed
installer makes the workaround unnecessary.
:::

Then, per Dokploy's Cloudflare Tunnel guide: **disable Let's Encrypt** and
leave the **HTTPS toggle OFF** on every app — Cloudflare terminates TLS at
the edge and talks plain HTTP to Traefik on loopback. Turning HTTPS on
anywhere in Dokploy causes redirect loops behind the tunnel.

1. First access is via SSH forward — the dashboard listens on `:3000` but UFW
   blocks it publicly, and `deploy.` returns 404 until step 2 routes it:
   ```bash
   ssh -L 3000:localhost:3000 atelier-limoun   # Host alias from §1
   ```
   then open `http://localhost:3000`, create the admin account, **enable 2FA**.
2. Panel routing is Ansible-owned, not UI-owned: `mise run ops:converge`
   writes Traefik's `dokploy.yml` with `Host(deploy.atelierlimoun.fr)` and
   every converge re-asserts it — so leave **Server Domain empty** in
   Settings → Server (saving a host there makes Dokploy rewrite the file;
   converge would revert it). From then on `https://deploy.atelierlimoun.fr`
   serves the panel through the tunnel. GitHub webhook URLs are pasted
   manually as `https://deploy.atelierlimoun.fr/api/webhook/...`.

::: tip Tunnel login shows "Invalid origin"?
Dokploy's Better Auth only trusts origins from `webServerSettings`
(`http://<serverIp>:3000`, `https://<host>`) plus the owner's
`user.trustedOrigins` array. With Server Domain empty, the tunnel origin is
trusted only via the array: with one owner row present,
`UPDATE "user" SET "trustedOrigins" = ARRAY['https://deploy.atelierlimoun.fr']`
(single-row table at the time — scope the `WHERE` if that ever changes).
Rollback is setting it back to null. Snapshot the DB (`pg_dump --data-only`)
before touching auth state.
:::
**Build location (decided 2026-10-19):** apps build on-server from git
(Nixpacks). Evaluated CI-built GHCR images (industry standard, creneau's
model) and deferred: Dokploy's native per-PR previews only work for
git-built apps, and this project needs per-PR review, not release
promotion. Revisit if VPS build load hurts or staging-prod parity is ever
required — the switch is a per-app provider change, no architecture change.

3. **Project → New project** → `atelier-limoun` (default environment), then:

### `postgres` (Databases → Postgres)

Dokploy-managed Postgres, internal Docker network only — never a Traefik
route, never publicly resolvable. Note the service's host/port/name/user/
password (Apps → Environment tab shows them as `DATABASE_*`). Scheduled
backups → S3 destination when one exists (see §6).

### `cms` (Strapi 5, Nixpacks)

| Setting | Value |
|---|---|
| Provider | GitHub, same repo, branch `main` |
| Root directory | `cms` |
| Build type | Nixpacks (default) — build `npm run build`, start `npm start` |
| Port | `1337` |
| Domain | `cms.atelierlimoun.fr`, **HTTPS toggle OFF**, no certificate |
| Watch paths | `cms/**` (a `site/`-only push must not rebuild the CMS) |

Env (secrets never committed — `.env.example` holds placeholders only):

| Var | Value |
|---|---|
| `HOST` / `PORT` | `0.0.0.0` / `1337` |
| `DATABASE_CLIENT` | `postgres` |
| `DATABASE_HOST/PORT/NAME/USERNAME/PASSWORD` | from the `postgres` service |
| `APP_KEYS`, `JWT_SECRET` | fresh `openssl rand -hex 16` (APP_KEYS: two comma-separated) |
| `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT` | fresh `openssl rand -hex 16` each |
| `SITE_REBUILD_URL` (+ optional `SITE_REBUILD_TOKEN`) | the site app's Dokploy deploy hook — see §4 |

Two traps:

- **Uploads are ephemeral** unless a persistent Dokploy volume is mounted on
  `/app/public/uploads` — without it, every redeploys loses media. Mount it,
  and include it in volume backups.
- **`STRAPI_TOKEN` deliberately unset**: bootstrap already grants the public
  role read-only API access on an empty DB (and seeds demo content —
  `cms/src/index.ts`, idempotent, nothing to do by hand). Add a read-only
  token later only if a real need appears.

### `site` (Astro 7 static, Nixpacks + Publish Directory)

| Setting | Value |
|---|---|
| Provider | GitHub, same repo, branch `main` |
| Root directory | `site` |
| Build type | Nixpacks — build `npm run build`, **Publish directory** `dist` (Dokploy serves it with its optimized NGINX image — zero-Downtime-ish static serving, no Node runtime) |
| Port | `80` |
| Domains | `atelierlimoun.fr` + `www.atelierlimoun.fr`, **HTTPS OFF** |
| Watch paths | `site/**` |

Env — **build-time** (baked into `dist/` by `astro build`, set before the
first build):

| Var | Value |
|---|---|
| `STRAPI_URL` | `https://cms.atelierlimoun.fr` (public origin; dev fallback `http://localhost:1337` in `site/src/lib/strapi.ts` is for local dev only) |

### Preview deployments (both apps)

Enable on both apps. Custom wildcard domain: `*.preview.atelierlimoun.fr`
(Dokploy generates `preview-<app>-<id>.preview…` — the tunnel wildcard route
already covers it). Defaults otherwise (max 3, all PRs to `main`).

- **site previews build against the production CMS** (`STRAPI_URL=https://cms…`):
  content is not in git, so PR previews test code against real content —
  intended, documented. Per-override to a preview CMS only for end-to-end
  CMS+site PRs.
- **cms previews must never touch the production database**: override
  `DATABASE_CLIENT` so bootstrap falls back to throwaway sqlite + demo seed
  (verify Dokploy's per-preview env override applies to `DATABASE_HOST`
  too; fallback if not: a dedicated preview postgres service).

### GitHub auto-deploy

The GitHub app integration watches `main` on both apps (deploy on push).
Webhook URLs are pasted manually per app (Server Domain stays empty —
§3 step 2): `https://deploy.atelierlimoun.fr/api/webhook/github/<token>`
shown in each app's Deployments tab.

::: tip No setup wizard? Unknown admin row
If `http://localhost:3000` shows a login page instead of registration on a
fresh install, an admin row already exists (`select count(*) from "user"` —
seen once 2026-10-18 with a `lab-orch@localhost.local` account, origin
never determined; entry was only possible via an SSH forward since `:3000`
was never public). Fix: snapshot first
(`pg_dump -U dokploy -d dokploy --data-only`), then
`DELETE FROM session; DELETE FROM account; DELETE FROM member; DELETE FROM "user";`
via `docker exec` on the postgres container — the next load redirects `/`
→ `/register`. Afterwards, review `journalctl -u ssh` Accepted lines for
unrecognized sessions before re-registering.
:::

## 4. Auto-rebuild after CMS publish

Primary path (chosen 2026-10, versioned in git): the Strapi lifecycle code
(`cms/src/api/*/content-types/*/lifecycle.ts` → `cms/src/api/shared/rebuild.ts`)
POSTs to `SITE_REBUILD_URL` on every Page/Project publish. Set on the `cms`
app:

- `SITE_REBUILD_URL` = the **site** app's Dokploy deploy hook URL (app →
  Deployments tab → webhook; runs a full build+deploy of the Astro site,
  ~1 min)
- `SITE_REBUILD_TOKEN` = optional bearer, if the hook requires one

Checkpoint (verify once at first deploy): the hook's accepted
method/auth/body vs `rebuild.ts`'s POST + optional Bearer — adapt
`rebuild.ts` if they mismatch (CMS-contract rule: keep seed/E2E and the
client in the same change).

Alternative (UI-only, no env): Strapi admin → Settings → Webhooks → create a
`site-rebuild` webhook, same URL, events Create & Update for Page + Project.

## 5. CMS security

`cms.atelierlimoun.fr` is reachable only through the tunnel (no public origin
IP, no open web ports) and protected by the Strapi login. Additionally:

- Strong admin password + **Strapi 2FA** if available,
- No Cloudflare Access in v1 — it conflicts with Dokploy's auth on `deploy.`
  and adds a second login to `cms.` for no current threat; reconsider if
  bot traffic becomes a problem,
- The CMS public permissions only allow **reading** published content (no writes).

## 6. Backups

- Weekly Postgres dump: `docker exec <postgres-container> pg_dump -U <user> <db> | gzip > backup-$(date +%F).sql.gz` (user/db from the Dokploy `postgres` service's env)
- Strapi uploads (`cms/public/uploads`) live on the app's volume — include them in the backup.
- See Dokploy → Settings → Backups (S3-compatible if available).

## Handover (your friend)

1. Go to `cms.atelierlimoun.fr`, log in (account created by you).
2. **Home** for the landing page, **Project** to add projects (images via the media library), **Page** for static pages.
3. Click **Publish** → the site auto-rebuilds in ~1 min.
