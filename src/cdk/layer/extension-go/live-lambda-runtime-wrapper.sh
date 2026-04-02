#!/bin/sh
# This script is used by AWS_LAMBDA_EXEC_WRAPPER.
# It sets the AWS_LAMBDA_RUNTIME_API for the function process
# to point to our extension's proxy server.

# Only redirect Runtime API when LiveLambda proxying is enabled.
# When disabled, the function talks directly to the real Runtime API.
if [ "$LIVE_LAMBDA_ENABLED" = "true" ]; then
    LISTENER_PORT="${LRAP_LISTENER_PORT:-8082}"
    export AWS_LAMBDA_RUNTIME_API="127.0.0.1:${LISTENER_PORT}"
fi

exec "$@"
