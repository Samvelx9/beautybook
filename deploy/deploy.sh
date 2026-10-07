#!/usr/bin/env bash
# Redeploy the platform on the VM after pushing to main:
#   ssh oracle-server 'bash /opt/beautybook/repo/deploy/deploy.sh'
# Migrations are separate: see deploy/README.md.
set -euo pipefail

APP=/opt/beautybook
WWW=/opt/nginx-setup/www/beautybook
set -a; source "$APP/.env"; set +a

echo "== Pulling latest code =="
cd "$APP/repo" && git pull --ff-only

echo "== Rebuilding + restarting backend =="
cd "$APP" && sudo docker compose build && sudo docker compose up -d

echo "== Building frontends =="
sudo docker run --rm -v "$APP/repo:/repo" -w /repo \
  -e VITE_PLATFORM_DOMAIN="$PLATFORM_DOMAIN" -e VITE_PRODUCT_NAME="${PRODUCT_NAME:-BeautyBook}" \
  node:20-alpine sh -c 'npm ci && npm run build --workspace client-guest && npm run build --workspace client-admin'

echo "== Publishing frontend builds =="
sudo rm -rf "$WWW.new" && sudo mkdir -p "$WWW.new/guest" "$WWW.new/admin"
sudo cp -r "$APP/repo/client-guest/dist/." "$WWW.new/guest/"
sudo cp -r "$APP/repo/client-admin/dist/." "$WWW.new/admin/"
sudo rm -rf "$WWW.old" && { [ -d "$WWW" ] && sudo mv "$WWW" "$WWW.old" || true; } && sudo mv "$WWW.new" "$WWW"

echo "== Backend health =="
sleep 3
sudo docker exec beautybook-backend node -e \
  "fetch('http://localhost:4000/api/health').then(r=>r.json()).then(d=>console.log(JSON.stringify(d)))"
