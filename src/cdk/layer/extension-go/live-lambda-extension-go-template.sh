#!/bin/sh
set -e

BIN_DIR=/opt/extensions/bin
ARCH=$(uname -m)

# In AWS Lambda, arm64 is reported as 'aarch64'
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
  # Execute the arm64 binary
  exec "$BIN_DIR/live-lambda-extension-go-arm64" "$@"
elif [ "$ARCH" = "x86_64" ]; then
  # Execute the x86_64 binary
  exec "$BIN_DIR/live-lambda-extension-go-amd64" "$@"
else
  echo "Unsupported architecture: $ARCH" >&2
  exit 1
fi
