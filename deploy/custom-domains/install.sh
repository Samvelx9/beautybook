#!/usr/bin/env bash
# Installs (or updates) the custom-domain job on the server, from the repo:
#   sudo bash /opt/beautybook/repo/deploy/custom-domains/install.sh <server ip>
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
IP=${1:?usage: install.sh <the server public IP the domains must point at>}

install -m 755 "$HERE/bb-custom-domains.sh" /usr/local/sbin/bb-custom-domains
install -d /usr/local/share/bb-custom-domains
install -m 644 "$HERE/custom-domain.conf.template" /usr/local/share/bb-custom-domains/
install -m 644 "$HERE/bb-custom-domains.service" "$HERE/bb-custom-domains.timer" /etc/systemd/system/
printf 'SERVER_IP=%s\n' "$IP" > /etc/default/bb-custom-domains
systemctl daemon-reload
systemctl enable --now bb-custom-domains.timer
systemctl start bb-custom-domains.service
systemctl --no-pager status bb-custom-domains.service | tail -3 || true
