# Ops — VPS baseline (rescue fallback)

> [!NOTE]
> The primary baseline is **Ansible** (`ansible/`, see `docs/deploy.md` §1).
> This script is the fallback for when Ansible/SSH is unusable (e.g. OVH
> rescue mode): it reproduces the same baseline imperatively, as root, with
> no dependencies beyond a shell.

Config-as-code for the single OVH VPS behind `atelier-limoun.fr`.
The full runbook lives in [docs/deploy.md](../docs/deploy.md); this folder holds the scripted part.

## What is automatic vs manual

| Area                 | How                            | Where                    |
| -------------------- | ------------------------------ | ------------------------ |
| OS packages, user, SSH, UFW, fail2ban, unattended-upgrades | Primary: Ansible (`mise run ops:converge`); fallback: this script (imperative, root) | `ansible/` + `ops/vps-bootstrap.sh` |
| OVH account (2FA, contacts, reverse DNS) | Manual in OVH manager | `docs/deploy.md` §0 |
| Dokploy install + apps + Postgres + certs | Manual in Dokploy UI | `docs/deploy.md` §3 |
| Cloudflare DNS / Access | Manual in Cloudflare dashboard | `docs/deploy.md` §2 |
| Secrets (`APP_KEYS`, `DATABASE_*`, …) | Manual in Dokploy env UI, generated with `openssl rand -hex 16` | never in git |

## Usage

Run **once** on the fresh VPS as root, then re-run after any baseline change:

```bash
# From your laptop: copy the script over (do not paste secrets)
scp ops/vps-bootstrap.sh root@<vps-ip>:/root/

# On the VPS as root — keep this session OPEN until verified.
# Creates the `wagou` user (single-key fallback path; the Ansible baseline
# manages `wagou` + `chloe` once SSH works again).
ADMIN_USER=wagou ADMIN_SSH_KEY="$(cat ~/.ssh/id_ed25519.pub)" \
  HOSTNAME_WANTED=atelier-vps \
  bash /root/vps-bootstrap.sh
```

Optional overrides: `HOSTNAME_WANTED` (default `atelier-vps`), `TIMEZONE_WANTED` (default `Europe/Paris`).

Verify from a **new** session before closing the old one:

```bash
ssh wagou@<vps-ip>
sudo ufw status verbose
sudo fail2ban-client status sshd
```

## Safety

- The script backs up `sshd_config` (`/etc/ssh/sshd_config.orig-<date>`) and runs `sshd -t` before reloading. A failed check removes the drop-in and aborts.
- `PermitRootLogin no` + `PasswordAuthentication no`: key-only auth. Losing the private key = lockout — keep an offline copy.
- UFW is reset to a known baseline (SSH only — `firewall_extra_open_ports` in `ansible/group_vars/all/main.yml` re-opens ports for direct-access fallback). Do not add app ports without updating both the script and `docs/deploy.md`.
- No secrets are accepted as arguments. Production secrets live in Dokploy env vars only.
- The script is excluded from Biome (`biome.jsonc`); validate with `bash -n ops/vps-bootstrap.sh`.

## Rollback

- SSH: remove `/etc/ssh/sshd_config.d/60-atelier-hardening.conf`, `systemctl reload ssh`, restore from the `.orig-<date>` backup if needed.
- UFW: `sudo ufw disable` (emergency only), then re-run the script to restore the baseline.
- fail2ban: `sudo fail2ban-client unban <ip>` for a locked-out IP; check `sudo fail2ban-client status sshd`.
