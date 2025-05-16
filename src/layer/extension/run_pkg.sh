#!/bin/sh
set -e

mkdir -p extensions
if [ -f dist/index.js ]; then
  echo "Using dist/index.js for pkg"
  npx pkg dist/index.js --targets node18-linux-x64 --output extensions/live-lambda-extension-exec
else
  echo "Using src/index.js for pkg"
  npx pkg src/index.js --targets node18-linux-x64 --output extensions/live-lambda-extension-exec
fi
