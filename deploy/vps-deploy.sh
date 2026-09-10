#!/usr/bin/env bash
# Nasazení / aktualizace aplikace Salda na VPS (spouštět z Macu ve složce projektu):  ./deploy/vps-deploy.sh
# Poprvé: na VPS vytvořit /opt/datec-salda/.env podle .env.example (SQL_* a PORT=3091) a přidat blok z deploy/Caddyfile.snippet.
set -e
VPS="${VPS:-root@95.216.201.2}"
KEY="${KEY:-$HOME/.ssh/id_ed25519_jhnapps}"
DIR=/opt/datec-salda
SSH="ssh -i $KEY -o BatchMode=yes"

cd "$(dirname "$0")/.."
$SSH "$VPS" "mkdir -p $DIR && chown jhnapps:jhnapps $DIR"
rsync -az -e "$SSH" --exclude node_modules --exclude .git --exclude .DS_Store --exclude .env --exclude .netlify ./ "$VPS:$DIR/"
$SSH "$VPS" "chown -R jhnapps:jhnapps $DIR && su - jhnapps -c 'cd $DIR && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -1 && (pm2 restart datec-salda --update-env 2>/dev/null || pm2 start deploy/ecosystem.config.cjs) && pm2 save && sleep 2 && curl -s localhost:3091/api/health'"
echo
echo "Hotovo. Log: ssh -i $KEY $VPS \"su - jhnapps -c 'pm2 logs datec-salda --lines 50'\""
