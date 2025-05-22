#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.


echo "Building Go Lambda extension executables..."
# Directory for Go extension source files (script's own directory)
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
PROJECT_ROOT="$SCRIPT_DIR/../../../.." # Navigate up to project root
GO_EXT_SRC_DIR="$SCRIPT_DIR"
# Directory for compiled Go extension executables, relative to project root
GO_EXT_BIN_OUTPUT_DIR_REL_TO_PROJ="dist/extensions/bin"
# Absolute path for Go binary output dir
ABS_GO_EXT_BIN_OUTPUT_DIR="$PROJECT_ROOT/$GO_EXT_BIN_OUTPUT_DIR_REL_TO_PROJ"
mkdir -p "$ABS_GO_EXT_BIN_OUTPUT_DIR"

# --- Conditional Go Compilation --- 
HASH_FILE_PATH="$PROJECT_ROOT/dist/go_extension.sha256"

calculate_current_hash() {
  # Ensure this command works on macOS and handles cases where go.mod/go.sum might not exist initially
  (cd "$GO_EXT_SRC_DIR" && find . -maxdepth 1 \( -name '*.go' -o -name 'go.mod' -o -name 'go.sum' \) -print0 2>/dev/null | xargs -0 shasum -a 256 2>/dev/null | sort -k2 | shasum -a 256 | awk '{print $1}' || echo "hash_error")
}

CURRENT_HASH=$(calculate_current_hash)
PREVIOUS_HASH=""

if [ -f "$HASH_FILE_PATH" ]; then
  PREVIOUS_HASH=$(cat "$HASH_FILE_PATH")
fi

AMD64_ARTIFACT="$ABS_GO_EXT_BIN_OUTPUT_DIR/live-lambda-extension-go-amd64"
ARM64_ARTIFACT="$ABS_GO_EXT_BIN_OUTPUT_DIR/live-lambda-extension-go-arm64"

if [ "$CURRENT_HASH" != "hash_error" ] && [ "$CURRENT_HASH" == "$PREVIOUS_HASH" ] && [ -f "$AMD64_ARTIFACT" ] && [ -f "$ARM64_ARTIFACT" ]; then
  echo "Go extension source files unchanged and binaries exist. Skipping Go compilation."
elif [ "$CURRENT_HASH" == "hash_error" ]; then
  echo "Error calculating hash for Go source files. Forcing compilation."
  # Fall through to compile
fi

if ! ([ "$CURRENT_HASH" != "hash_error" ] && [ "$CURRENT_HASH" == "$PREVIOUS_HASH" ] && [ -f "$AMD64_ARTIFACT" ] && [ -f "$ARM64_ARTIFACT" ]); then
  echo "Compiling Go extension for linux/amd64..."
  (cd "$GO_EXT_SRC_DIR" && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags='-s -w' -o "$AMD64_ARTIFACT" .)
  echo "Compiling Go extension for linux/arm64..."
  (cd "$GO_EXT_SRC_DIR" && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags='-s -w' -o "$ARM64_ARTIFACT" .)
  
  if [ "$CURRENT_HASH" != "hash_error" ] && [ -f "$AMD64_ARTIFACT" ] && [ -f "$ARM64_ARTIFACT" ]; then
    # Create dist directory for hash file if it doesn't exist (it should by now due to other outputs)
    mkdir -p "$PROJECT_ROOT/dist"
    echo "$CURRENT_HASH" > "$HASH_FILE_PATH"
    echo "Stored new Go source hash: $CURRENT_HASH"
  else
    echo "Compilation failed or hash error, not updating hash file."
  fi 
fi
# --- End Conditional Go Compilation ---

echo "Preparing Lambda Layer output directories..."
# Target directory for all extension files within the layer package (now root dist)
DIST_DIR_ABS="$PROJECT_ROOT/dist"
LAYER_EXTENSIONS_DIR_ABS="$DIST_DIR_ABS/extensions"
mkdir -p "$LAYER_EXTENSIONS_DIR_ABS"
# Target directory for the runtime wrapper at the root of the layer package (dist)
mkdir -p "$DIST_DIR_ABS"

# --- Copy the main Go extension wrapper script ---
MAIN_EXTENSION_WRAPPER_TARGET="$LAYER_EXTENSIONS_DIR_ABS/live-lambda-extension"
GO_WRAPPER_TEMPLATE="$SCRIPT_DIR/live-lambda-extension-go-template.sh"

echo "Using Go extension wrapper."
cp "$GO_WRAPPER_TEMPLATE" "$MAIN_EXTENSION_WRAPPER_TARGET"
# --- End of wrapper script selection ---

echo "Copying runtime wrapper script (live-lambda-runtime-wrapper.sh)..."
cp "$SCRIPT_DIR/live-lambda-runtime-wrapper.sh" "$DIST_DIR_ABS/"

echo "Setting execute permissions..."
chmod +x "$MAIN_EXTENSION_WRAPPER_TARGET"
chmod +x "$DIST_DIR_ABS/live-lambda-runtime-wrapper.sh"
chmod +x "$ABS_GO_EXT_BIN_OUTPUT_DIR/live-lambda-extension-go-amd64"
chmod +x "$ABS_GO_EXT_BIN_OUTPUT_DIR/live-lambda-extension-go-arm64"

echo "Extension artifact build complete. Main wrapper is for Go extension."
