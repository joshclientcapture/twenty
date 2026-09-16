#!/bin/bash
# Builds twenty-server + twenty-front on the VPS, restarts both services and the worker,
# then (re)registers every cron schedule including the OS sync. Run after `git pull`.
set -uo pipefail
export NVM_DIR=$HOME/.nvm; . $NVM_DIR/nvm.sh
export NODE_OPTIONS="--max-old-space-size=8192"
cd /root/twenty

git log -1 --format='deploying %h %s'

npx nx build twenty-shared --skip-nx-cache || { echo "SHARED_BUILD_FAIL"; exit 1; }
npx nx build twenty-server || { echo "SERVER_BUILD_FAIL"; exit 1; }
npx nx build twenty-front || { echo "FRONT_BUILD_FAIL"; exit 1; }
rm -rf packages/twenty-server/dist/front && cp -r packages/twenty-front/build packages/twenty-server/dist/front

systemctl restart twenty-server twenty-worker
sleep 25
echo "server=$(systemctl is-active twenty-server) worker=$(systemctl is-active twenty-worker) healthz=$(curl -s -o /dev/null -w %{http_code} --max-time 10 http://127.0.0.1:3000/healthz)"

cd packages/twenty-server
set -a; . ./.env; set +a
node dist/command/command cron:register:all 2>&1 | grep -E "OsSync|Registered|failed|error" | head -5
echo DEPLOY_DONE
