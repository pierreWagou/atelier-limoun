#!/usr/bin/env bash
#
# VPS baseline bootstrap for atelier-limoun.fr (OVH, Ubuntu 24.04).
#
# Idempotent: safe to run multiple times. Run as root on the VPS:
#
#   ADMIN_USER=deploy ADMIN_SSH_KEY="$(cat ~/.ssh/id_ed25519.pub)" ./ops/vps-bootstrap.sh
#
# What it does:
#   1. System update + base packages (fail2ban, unattended-upgrades, ufw)
#   2. Hostname, timezone (Europe/Paris), NTP check
#   3. Non-root sudo user + SSH key (idempotent authorized_keys)
#   4. SSH hardening (key-only, no root login) with `sshd -t` guard
#   5. UFW baseline (deny incoming, allow 22/80/443)
#   6. fail2ban sshd jail + unattended-upgrades (security only, no auto-reboot)
#
# What it does NOT do (stays manual, see docs/deploy.md):
#   - Install Dokploy (official install.sh, version explicit in runbook)
#   - Create Cloudflare/Dokploy/Postgres resources or secrets
#
# Safety: keep a second SSH session open while running. The script never
# closes your current session; verify a new login before logging out.
set -euo pipefail

ADMIN_USER="${ADMIN_USER:-deploy}"
ADMIN_SSH_KEY="${ADMIN_SSH_KEY:-}"
HOSTNAME_WANTED="${HOSTNAME_WANTED:-atelier-vps}"
TIMEZONE_WANTED="${TIMEZONE_WANTED:-Europe/Paris}"

log() {
  printf '[bootstrap] %s\n' "$*"
}

die() {
  printf '[bootstrap] ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "run as root (e.g. sudo ./ops/vps-bootstrap.sh)"
  fi
}

require_env() {
  if [ -z "${ADMIN_SSH_KEY}" ]; then
    die "ADMIN_SSH_KEY is required (your ed25519 public key, single line starting with ssh-ed25519)"
  fi
  case "${ADMIN_SSH_KEY}" in
    ssh-ed25519*|ecdsa-sha2-nistp*|ssh-rsa*)
      ;;
    *)
      die "ADMIN_SSH_KEY does not look like an SSH public key"
      ;;
  esac
}

apt_update() {
  log "Updating packages..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get full-upgrade -y
  apt-get install -y --no-install-recommends \
    fail2ban \
    unattended-upgrades \
    ufw \
    curl \
    ca-certificates \
    needrestart
}

set_hostname_timezone() {
  if [ "$(cat /etc/hostname 2>/dev/null || true)" != "${HOSTNAME_WANTED}" ]; then
    log "Setting hostname to ${HOSTNAME_WANTED}"
    hostnamectl set-hostname "${HOSTNAME_WANTED}"
  else
    log "Hostname already ${HOSTNAME_WANTED}, skipping"
  fi

  log "Setting timezone to ${TIMEZONE_WANTED}"
  timedatectl set-timezone "${TIMEZONE_WANTED}" || true
  if systemctl is-enabled systemd-timesyncd >/dev/null 2>&1; then
    systemctl enable --now systemd-timesyncd >/dev/null 2>&1 || true
  fi
  log "Time: $(date -Is) ($(timedatectl show -p Timezone --value 2>/dev/null || echo "${TIMEZONE_WANTED}"))"
}

ensure_admin_user() {
  if ! id "${ADMIN_USER}" >/dev/null 2>&1; then
    log "Creating user ${ADMIN_USER}"
    adduser --disabled-password --gecos "" "${ADMIN_USER}"
    usermod -aG sudo "${ADMIN_USER}"
  else
    log "User ${ADMIN_USER} exists, ensuring sudo membership"
    usermod -aG sudo "${ADMIN_USER}" || true
  fi

  local ssh_dir="/home/${ADMIN_USER}/.ssh"
  local auth_keys="${ssh_dir}/authorized_keys"
  mkdir -p "${ssh_dir}"
  touch "${auth_keys}"
  if ! grep -qxF "${ADMIN_SSH_KEY}" "${auth_keys}"; then
    log "Adding SSH key for ${ADMIN_USER}"
    printf '%s\n' "${ADMIN_SSH_KEY}" >>"${auth_keys}"
  else
    log "SSH key already present, skipping"
  fi
  chown -R "${ADMIN_USER}:${ADMIN_USER}" "${ssh_dir}"
  chmod 700 "${ssh_dir}"
  chmod 600 "${auth_keys}"
}

harden_ssh() {
  local sshd_config="/etc/ssh/sshd_config"
  local drop_in="/etc/ssh/sshd_config.d/60-atelier-hardening.conf"
  cp -n "${sshd_config}" "${sshd_config}.orig-$(date +%F)" 2>/dev/null || true

  log "Writing SSH hardening drop-in ${drop_in}"
  cat >"${drop_in}" <<'EOF'
# Managed by atelier-limoun ops/vps-bootstrap.sh (idempotent).
PasswordAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
ChallengeResponseAuthentication no
UsePAM yes
X11Forwarding no
EOF
  if sshd -t; then
    log "sshd config OK"
  else
    rm -f "${drop_in}"
    die "sshd -t failed, hardening reverted. Check ${sshd_config}"
  fi
  systemctl reload ssh || systemctl reload sshd || true
  log "SSH hardened: key-only, root login disabled. TEST A NEW LOGIN BEFORE LOGGING OUT."
}

configure_ufw() {
  log "Configuring UFW (deny incoming, allow 22/80/443)..."
  ufw --force reset >/dev/null
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow OpenSSH
  ufw allow 80,443/tcp
  ufw --force enable
  ufw status verbose || true
}

configure_fail2ban() {
  log "Configuring fail2ban sshd jail..."
  cat >/etc/fail2ban/jail.local <<'EOF'
# Managed by atelier-limoun ops/vps-bootstrap.sh (idempotent).
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
EOF
  systemctl enable --now fail2ban
  systemctl restart fail2ban || true
  fail2ban-client status sshd || fail2ban-client status || true
}

configure_unattended_upgrades() {
  log "Configuring unattended-upgrades (security only, no auto-reboot)..."
  cat >/etc/apt/apt.conf.d/51-atelier-unattended <<'EOF'
// Managed by atelier-limoun ops/vps-bootstrap.sh (idempotent).
Unattended-Upgrade::Allowed-Origins {
  "${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
  systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true
  unattended-upgrades --dry-run --debug >/dev/null 2>&1 && log "unattended-upgrades dry-run OK" || log "unattended-upgrades installed (dry-run skipped)"
}

print_summary() {
  log "---- baseline summary ----"
  log "hostname: $(hostname)"
  log "disk: $(df -h / | tail -1)"
  log "memory: $(free -h | head -2 | tail -1)"
  ufw status numbered || true
  fail2ban-client status sshd || true
  log "docker: $(docker --version 2>/dev/null || echo 'not installed — install Dokploy per docs/deploy.md')"
  log "NEXT: 1) ssh ${ADMIN_USER}@<vps-ip> in a NEW session  2) keep this session open until it works"
}

main() {
  require_root
  require_env
  apt_update
  set_hostname_timezone
  ensure_admin_user
  harden_ssh
  configure_ufw
  configure_fail2ban
  configure_unattended_upgrades
  print_summary
}

main "$@"
