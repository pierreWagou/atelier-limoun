# Deployment runbook — VPS + Dokploy

Ops guide for deploying and operating atelier-limoun.fr. Architecture and local development live in the [README](../README.md).

Production topology:

```
atelier-limoun.fr           → public site (Astro, static)
cms.atelier-limoun.fr       → Strapi admin (your friend edits here)
deploy.atelier-limoun.fr    → Dokploy dashboard
*.preview.atelier-limoun.fr → PR previews (Astro)
```

## 1. VPS (one-time, reproducible via Ansible)

The VPS baseline (users, SSH hardening, UFW, fail2ban, auto-updates) is
code in `ansible/` — re-runnable and reviewable. Ansible is agentless: it is
installed on your laptop via mise, the VPS only needs SSH + Python (Ubuntu
26.04 ships both).

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
account helps — use OVH rescue mode + `ops/vps-bootstrap.sh` instead (see
Fallback below).

Re-running `ops:converge` is always safe (idempotent): the second run reports
zero changes. To converge again after a repo change, just re-run it.

### Secrets

App secrets (Strapi keys, `DATABASE_*`) stay in the **Dokploy env UI**, never
in git. There are currently no host-level secrets, so there is no vault and
no secret tooling for contributors to set up — deliberately.

When the first host secret appears (likely candidates: a backup-encryption
passphrase, an SMTP relay password, a Cloudflare API token), the standing
decision is **`sops` + `age`**, for the same reasons SSH keys work this way:
no shared passphrase to distribute; a contributor PRs their age *public* key
into `.sops.yaml`, a maintainer runs `sops updatekeys`. `sops` comes via mise
(one line, zero contributor setup) and the `community.sops` lookup ships
inside the `ansible` package already — no Galaxy step.

Explicit non-goals: no ansible-vault (shared-passphrase distribution
problem), no helper CLIs beyond mise-provided `sops`. Emergency interim if a
secret is needed before sops is wired: `ansible-vault create` with
`--ask-vault-pass` (interactive prompt, zero setup), replaced by sops right
after.
### Fallback: OVH rescue mode

If Ansible/SSH is ever unusable (e.g. rescue mode after an SSH or firewall
breakage), `ops/vps-bootstrap.sh` reproduces the same baseline imperatively — see
`ops/README.md`.

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
| `*.preview.atelierlimoun.fr` | PR previews (wildcard route) |

   Each route auto-creates a proxied (orange) DNS record. Nothing is grey:
   the origin IP never appears in DNS.
3. If a nested preview hostname ever shows a cert error at the edge, check
   Total TLS coverage first; fallbacks in order: Advanced Certificate Manager
   → disable PR previews until resolved (site unaffected).

### Connector + firewall (on the VPS, via Ansible)

1. As root, place the token once (typed/pasted, never committed, never in
   shell history — write from a file, then shred it):

   ```bash
   install -m 600 /dev/stdin /etc/cloudflared/token <<'EOF'
   <paste token>
   EOF
   ```

2. Converge (tunnel role installs `cloudflared`, writes the systemd unit,
   starts the connector; firewall role then drops 80/443 — safe order,
   same run):

   ```bash
   mise run ops:check && mise run ops:converge
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

::: warning Ubuntu 26.04 caveat
The VPS runs Ubuntu 26.04. Dokploy pins specific Docker versions in its
installer and has broken on 26.04 before (pinned Docker missing for the
release). If the install fails on Docker, check Dokploy's issue tracker
for the 26.04 thread before downgrading anything — do not hand-install a
different Docker over it without recording why.
:::

Then, per Dokploy's Cloudflare Tunnel guide: **disable Let's Encrypt** and
leave the **HTTPS toggle OFF** on every app — Cloudflare terminates TLS at
the edge and talks plain HTTP to Traefik on loopback. Turning HTTPS on
anywhere in Dokploy causes redirect loops behind the tunnel.

1. Open `https://deploy.atelierlimoun.fr`, create the admin account, **enable 2FA**.
2. **Database** → Postgres service (note host/port/name/user/password — never exposed publicly; internal Docker network only).
3. **Project** → 2 apps from this GitHub repo (HTTPS toggle OFF, no certificate selected):
   - **cms**: root directory `cms`, build `npm run build`, start `npm start`, domain `cms.atelierlimoun.fr`. Env: `DATABASE_CLIENT=postgres` + the service's `DATABASE_*`, `APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `JWT_SECRET` (generate with `openssl rand -hex 16`).
   - **site**: root directory `site`, build `npm run build`, start `npx serve dist` (or adapt), domains `atelierlimoun.fr` + `www.atelierlimoun.fr`. Env: `STRAPI_URL=https://cms.atelierlimoun.fr`, optional `STRAPI_TOKEN`.
4. **Preview deployments** → enable on the **site** app (one PR = one instance at `pr-<n>.preview.atelierlimoun.fr`, routed by the wildcard tunnel route).
5. **GitHub integration** → auto-deploy on push to `main`.

## 4. Auto-rebuild after CMS publish

In the Strapi admin → **Settings → Webhooks** → create a `site-rebuild` webhook:

- URL: the Dokploy deploy hook URL for the **site** app (or a GitHub workflow dispatch)
- Events: Create & Update for **Page** and **Project**

Or set `SITE_REBUILD_URL` / `SITE_REBUILD_TOKEN` on the CMS side (the lifecycle code already calls them).

## 5. CMS security

`cms.atelierlimoun.fr` is reachable only through the tunnel (no public origin
IP, no open web ports) and protected by the Strapi login. Additionally:

- Strong admin password + **Strapi 2FA** if available,
- No Cloudflare Access in v1 — it conflicts with Dokploy's auth on `deploy.`
  and adds a second login to `cms.` for no current threat; reconsider if
  bot traffic becomes a problem,
- The CMS public permissions only allow **reading** published content (no writes).

## 6. Backups

- Weekly Postgres dump: `docker exec <pg-container> pg_dump -U strapi strapi | gzip > backup-$(date +%F).sql.gz`
- Strapi uploads (`cms/public/uploads`) live on the app's volume — include them in the backup.
- See Dokploy → Settings → Backups (S3-compatible if available).

## Handover (your friend)

1. Go to `cms.atelierlimoun.fr`, log in (account created by you).
2. **Home** for the landing page, **Project** to add projects (images via the media library), **Page** for static pages.
3. Click **Publish** → the site auto-rebuilds in ~1 min.
