#!/bin/sh
# Builds the page and runs a private demo service, so several people can work at once.
# Usage: scripts/demo-as.sh <name> <port>. Rebuild by running it again.
set -e
name="$1"; port="$2"
lsof -ti ":$port" | xargs kill 2>/dev/null || true
npx vite build --outDir "$PWD/.scratch/web-$name" --emptyOutDir --logLevel error
SF_WEB_ROOT="$PWD/.scratch/web-$name" SF_DEMO=1 SF_DATA_DIR="$PWD/.scratch/demo-$name" SF_PORT="$port" \
	nohup node src/server/main.ts > "$PWD/.scratch/demo-$name.log" 2>&1 &
for _ in 1 2 3 4 5 6 7 8 9 10; do
	curl -s -o /dev/null "http://127.0.0.1:$port/" && break
	node -e 'setTimeout(()=>{},400)'
done
echo "http://127.0.0.1:$port"
