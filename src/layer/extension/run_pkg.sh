#!/bin/sh
set -e

mkdir -p extensions/bin

PKG_INPUT_FILE=""
# Determine the input file for pkg
if [ -f dist/index.js ]; then
  PKG_INPUT_FILE="dist/index.js"
  echo "--- Using $PKG_INPUT_FILE for pkg (from CWD: $(pwd)) ---"
elif [ -f src/index.js ]; then
  PKG_INPUT_FILE="src/index.js"
  echo "--- Using $PKG_INPUT_FILE for pkg (from CWD: $(pwd)) ---"
else
  echo "Error: index.js not found in ./src/ or ./dist/ relative to CWD: $(pwd)"
  # List directories for easier debugging if this error occurs
  ls -la ./src ./dist 2>/dev/null || echo "(failed to list ./src or ./dist directories)"
  exit 1
fi

# This line is intended to force CDK asset rebuilds.
# Is it still necessary? If removed, ensure CDK correctly detects changes.
echo "--- Forcing asset rebuild marker: $(date) --- "

echo "--- Running pkg with input: $PKG_INPUT_FILE ---"

echo "--- Building for arm64 (node18-linux-arm64) -> extensions/bin/live-lambda-extension.arm64 ---"
npx pkg "$PKG_INPUT_FILE" \
  --targets node18-linux-arm64 \
  --output extensions/bin/live-lambda-extension.arm64

echo "--- Building for x86_64 (node18-linux-x86_64) -> extensions/bin/live-lambda-extension.x86_64 ---"
npx pkg "$PKG_INPUT_FILE" \
  --targets node18-linux-x86_64 \
  --output extensions/bin/live-lambda-extension.x86_64

echo "--- Successfully built binaries: ---"
ls -l extensions/bin/live-lambda-extension.arm64 extensions/bin/live-lambda-extension.x86_64

echo "--- run_pkg.sh finished. ---"
