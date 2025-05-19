#!/bin/sh
# This script is used by AWS_LAMBDA_EXEC_WRAPPER.
# It sets the AWS_LAMBDA_RUNTIME_API for the function process
# to point to our extension's proxy server.

# The port our extension's proxy server (RuntimeApiProxy) is listening on.
# This must match the LISTENER_PORT in src/layer/extension/src/runtime-api-proxy.ts
LISTENER_PORT="9009"

export AWS_LAMBDA_RUNTIME_API="127.0.0.1:${LISTENER_PORT}"

# Execute the original handler command (e.g., node index.js)
# "$@" contains the original command and arguments provided by AWS Lambda.
exec "$@"
