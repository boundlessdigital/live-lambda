# Lambda Layer and Go Extension (`docs/layer.md`)

This document details the `live-lambda` Lambda Layer and the Go-based extension it contains.

## Overview

The Lambda Layer is a critical component that enables the `live-lambda` system to intercept Lambda function invocations. It includes a custom AWS Lambda Extension written in Go and a wrapper script.

## Layer Contents

When the layer is built and packaged, it typically includes:

1.  **Go Extension Binary (`live-lambda-extension-go`)**: This is the core executable that runs alongside your Lambda function. It's responsible for:
    -   Registering with the Lambda Extensions API.
    -   Subscribing to `INVOKE` events for the associated Lambda function.
    -   Proxying invocation payloads to the local development server via an AppSync WebSocket connection.
    -   Receiving responses from the local server and forwarding them back to the Lambda Runtime API.
2.  **Runtime Wrapper Script (`live-lambda-runtime-wrapper.sh` or similar)**:
    -   This script is set as the `AWS_LAMBDA_EXEC_WRAPPER` environment variable for the Lambda function.
    -   Its primary role is to ensure the Lambda runtime communicates with the Go extension (acting as a local Runtime API Proxy - LRAP) instead of the actual Lambda Runtime API endpoint.
    -   It modifies the `AWS_LAMBDA_RUNTIME_API` environment variable to point to the Go extension's listening address and port (e.g., `127.0.0.1:8082`).

## Go Extension (`src/cdk/layer/extension-go/`)

-   **`runtime_api_proxy.go`**: The main Go program for the extension.
    -   It initializes a client for the AWS Lambda Runtime API.
    -   It starts an HTTP server that mimics the Lambda Runtime API locally for the function's runtime.
    -   It establishes a WebSocket connection to the AWS AppSync API specified by environment variables.
    -   When an `INVOKE` event is received from the Lambda Extensions API:
        1.  It extracts the event payload and request ID.
        2.  Sends this information over the WebSocket to the connected local development server.
        3.  Waits for a response from the local server via the WebSocket.
        4.  Posts this response back to the Lambda function's runtime via its proxied Runtime API endpoint.
-   **`build-extension-artifacts.sh`**: The build script for the Go extension.
    -   Compiles the Go source code for `linux/amd64` and `linux/arm64` architectures.
    -   Implements conditional compilation: if the Go source files haven't changed and the binaries exist, compilation is skipped to save time.
    -   Stores a hash of the Go source files (`go_extension.sha256`) to detect changes.
    -   Prepares the directory structure for the Lambda layer (`extensions/` and `extensions/bin/`).
    -   Copies the appropriate runtime wrapper script template (`live-lambda-extension-go-template.sh` or `live-lambda-extension-node-template.sh`) to `dist/layer/extension/extensions/live-lambda-extension` based on the `LIVE_LAMBDA_EXTENSION_TYPE` environment variable (defaults to 'go').

## Build Process

The Go extension is built as part of the main project build command (`pnpm build`), which invokes `src/cdk/layer/extension-go/build-extension-artifacts.sh`.

Key steps in `build-extension-artifacts.sh`:
1.  Define source and output directories.
2.  Calculate the SHA256 hash of all `.go` files in the Go extension source directory.
3.  Compare this current hash with a previously stored hash (if `dist/go_extension.sha256` exists).
4.  If hashes match and compiled binaries exist, skip Go compilation.
5.  Otherwise, compile `runtime_api_proxy.go` for both `amd64` and `arm64` architectures.
    -   `CGO_ENABLED=0` is used for static linking.
    -   `-ldflags='-s -w'` are used to strip debug symbols and reduce binary size.
6.  If compilation is successful and hashes were different (or no previous hash), store the new hash in `dist/go_extension.sha256`.
7.  Prepare the output directory structure for the layer (`dist/layer/extension/` which will be zipped by CDK).
8.  Copy the selected main extension wrapper script (`live-lambda-extension`) and the runtime wrapper (`live-lambda-runtime-wrapper.sh`) into the layer structure.

## How it Works with Lambda

1.  When a Lambda function configured with this layer starts, the Lambda service first initializes any registered extensions, including our `live-lambda-extension-go`.
2.  The `AWS_LAMBDA_EXEC_WRAPPER` environment variable points to `/opt/live-lambda-runtime-wrapper.sh`. This script runs *before* the actual Lambda handler.
3.  The `live-lambda-runtime-wrapper.sh` script modifies the `AWS_LAMBDA_RUNTIME_API` environment variable to point to the Go extension's local HTTP server (e.g., `127.0.0.1:8082`).
4.  The Go extension registers with the Lambda Extensions API to receive `INVOKE` and `SHUTDOWN` events.
5.  When your Lambda function is invoked:
    a.  The Go extension receives an `INVOKE` event from the Extensions API.
    b.  The Go extension takes the event payload and sends it over an AppSync WebSocket to your local `live-lambda` server.
    c.  Your Lambda function's runtime (e.g., Node.js, Python) makes a request to what it thinks is the standard Lambda Runtime API (e.g., `GET /2018-06-01/runtime/invocation/next`) but is actually talking to the Go extension's local server.
    d.  The Go extension's server holds this request until it receives a response from your local `live-lambda` server via the WebSocket.
    e.  Once the local server processes the event and sends a response back via WebSocket, the Go extension provides this response to the Lambda function's runtime.
    f.  The Lambda function's runtime then processes this response as if it came directly from the Runtime API (e.g., by sending a `POST /2018-06-01/runtime/invocation/{request_id}/response`).
    g.  The Go extension forwards this final response to the actual Lambda Runtime API to complete the invocation.

This sophisticated dance allows your local code execution to be seamlessly integrated into the AWS Lambda invocation model.
