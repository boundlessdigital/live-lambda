#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

echo "Building Lambda extension TypeScript..."
# Navigate to the extension's source directory and compile its TypeScript
# The tsconfig.json in src/layer/extension outputs to its own 'dist' folder (src/layer/extension/dist)
(cd src/layer/extension && tsc -p tsconfig.json)

echo "Creating binary output directory..."
# Create the target directory for the packaged binaries, relative to project root
mkdir -p dist/layer/extension/extensions/bin

echo "Packaging x86_64 binary..."
# Package for x86_64
pkg src/layer/extension/dist/index.js --targets node18-linux-x64 --output dist/layer/extension/extensions/bin/live-lambda-extension.x86_64

echo "Packaging arm64 binary..."
# Package for arm64
pkg src/layer/extension/dist/index.js --targets node18-linux-arm64 --output dist/layer/extension/extensions/bin/live-lambda-extension.arm64

echo "Copying wrapper script..."
# Copy the main extension wrapper script
cpy src/layer/extension/live-lambda-extension dist/layer/extension/ --overwrite

echo "Setting execute permissions..."
# Set execute permissions on the wrapper and the binaries
chmod +x dist/layer/extension/live-lambda-extension
chmod +x dist/layer/extension/extensions/bin/*

echo "Extension artifact build complete."
