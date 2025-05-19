#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

echo "Building Lambda extension with esbuild..."
# Navigate to the extension's source directory and run its build script (which uses esbuild)
(cd src/layer/extension && pnpm run build)

echo "Creating Lambda Layer output directories..."
# Create the target directory structure for the Lambda Layer
mkdir -p dist/layer/extension/extensions/

echo "Copying bundled extension code..."
# Copy the esbuild output (index.js) to the layer's extensions directory
cp src/layer/extension/dist/index.js dist/layer/extension/extensions/

echo "Copying extension wrapper script..."
# Copy the main extension wrapper script
cp src/layer/extension/live-lambda-extension dist/layer/extension/extensions/

echo "Copying runtime wrapper script..."
# This script seems to be copied to the root of the layer, not inside extensions/
# If it's part of the extension layer to be used by the function, this might be okay.
# Otherwise, if it's part of the extension itself, it should also go into extensions/
mkdir -p dist/layer/extension
cp src/layer/extension/live-lambda-runtime-wrapper.sh dist/layer/extension/

echo "Setting execute permissions..."
# Set execute permissions on the shell scripts
chmod +x dist/layer/extension/extensions/live-lambda-extension
chmod +x dist/layer/extension/live-lambda-runtime-wrapper.sh

echo "Extension artifact build complete."
