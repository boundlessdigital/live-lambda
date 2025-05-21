#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.


echo "Building Go Lambda extension executables..."
# Directory for Go extension source files (script's own directory)
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
GO_EXT_SRC_DIR="$SCRIPT_DIR"
# Directory for compiled Go extension executables within the layer structure
GO_EXT_BIN_OUTPUT_DIR="dist/layer/extension/extensions/bin" # Output for Go binaries
mkdir -p "$GO_EXT_BIN_OUTPUT_DIR"

echo "Compiling Go extension for linux/amd64..."
(cd "$GO_EXT_SRC_DIR" && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags='-s -w' -o "../../../$GO_EXT_BIN_OUTPUT_DIR/live-lambda-extension-go-amd64" .)
echo "Compiling Go extension for linux/arm64..."
(cd "$GO_EXT_SRC_DIR" && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags='-s -w' -o "../../../$GO_EXT_BIN_OUTPUT_DIR/live-lambda-extension-go-arm64" .)

echo "Preparing Lambda Layer output directories..."
# Target directory for all extension files within the layer package
LAYER_DIR="dist/layer/extension"
LAYER_EXTENSIONS_DIR="${LAYER_DIR}/extensions"
mkdir -p "$LAYER_EXTENSIONS_DIR"
# Target directory for the runtime wrapper (if any) at the root of the layer package
mkdir -p "$LAYER_DIR"

# --- Copy the main Go extension wrapper script ---
MAIN_EXTENSION_WRAPPER_TARGET="$LAYER_EXTENSIONS_DIR/live-lambda-extension"
GO_WRAPPER_TEMPLATE="$SCRIPT_DIR/live-lambda-extension-go-template.sh"

echo "Using Go extension wrapper."
cp "$GO_WRAPPER_TEMPLATE" "$MAIN_EXTENSION_WRAPPER_TARGET"
# --- End of wrapper script selection ---

echo "Copying runtime wrapper script (live-lambda-runtime-wrapper.sh)..."
cp "$SCRIPT_DIR/live-lambda-runtime-wrapper.sh" "$LAYER_DIR/"

echo "Setting execute permissions..."
chmod +x "$MAIN_EXTENSION_WRAPPER_TARGET"
chmod +x "$LAYER_DIR/live-lambda-runtime-wrapper.sh"
chmod +x "$GO_EXT_BIN_OUTPUT_DIR/live-lambda-extension-go-amd64"
chmod +x "$GO_EXT_BIN_OUTPUT_DIR/live-lambda-extension-go-arm64"

echo "Extension artifact build complete. Main wrapper is for Go extension."
