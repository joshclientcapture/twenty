#!/bin/bash
# Builds twenty-server + twenty-front on the VPS, restarts both services and the worker,
# then (re)registers every cron schedule including the OS sync. Run after `git pull`.
set -uo pipefail
export NVM_DIR=$HOME/.nvm; . $NVM_DIR/nvm.sh
export NODE_OPTIONS="--max-old-space-size=8192"
cd /root/twenty

# One deploy at a time; a second one started mid-build would collide in dist/.
exec 9>/root/.deploy.lock
flock -n 9 || { echo "DEPLOY_BUSY"; exit 1; }

git checkout -q -- yarn.lock packages/twenty-server/os-migration/ 2>/dev/null
# Untracked files that an incoming commit also adds make the pull abort; say so before it does.
DIRTY=$(git status --porcelain | grep -v '^??' | grep -v 'packages/twenty-docker/docker-compose.dev.yml' || true)
[ -n "$DIRTY" ] && echo "DIRTY_TREE: $DIRTY"
git pull --ff-only || { echo "PULL_FAIL"; exit 1; }
git log -1 --format='deploying %h %s'
# Front-end dependencies change occasionally (e.g. cobe for the customer globe).
yarn install 2>&1 | tail -1

npx nx build twenty-shared --skip-nx-cache || { echo "SHARED_BUILD_FAIL"; exit 1; }
npx nx build twenty-server || { echo "SERVER_BUILD_FAIL"; exit 1; }
npx nx build twenty-front || { echo "FRONT_BUILD_FAIL"; exit 1; }
# The live front lives outside dist (FRONT_PATH in .env points at the symlink), so the server build
# above never touched what nginx is serving; swapping the symlink is the only visible moment.
rm -rf /root/front-next && cp -r packages/twenty-front/build /root/front-next
ln -sfn /root/front-next /root/front-live.tmp && mv -Tf /root/front-live.tmp /root/front-live
rm -rf /root/front-prev && [ -d /root/front-current ] && mv /root/front-current /root/front-prev
mv /root/front-next /root/front-current && ln -sfn /root/front-current /root/front-live
# dist/front stays as a fallback for a server started without FRONT_PATH.
rm -rf packages/twenty-server/dist/front && cp -r packages/twenty-front/build packages/twenty-server/dist/front

systemctl restart twenty-server twenty-worker
sleep 25
echo "server=$(systemctl is-active twenty-server) worker=$(systemctl is-active twenty-worker) healthz=$(curl -s -o /dev/null -w %{http_code} --max-time 10 http://127.0.0.1:3000/healthz)"

cd packages/twenty-server
set -a; . ./.env; set +a
node dist/command/command cron:register:all 2>&1 | grep -E "OsSync|Registered|failed|error" | head -5
echo DEPLOY_DONE
