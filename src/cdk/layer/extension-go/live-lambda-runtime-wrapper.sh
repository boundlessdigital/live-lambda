#!/bin/sh
# This script is used by AWS_LAMBDA_EXEC_WRAPPER.
# It sets the AWS_LAMBDA_RUNTIME_API for the function process
# to point to our extension's proxy server.

# Documentation: https://docs.aws.amazon.com/lambda/latest/dg/runtimes-modify.html#runtime-wrapper

# Only redirect Runtime API when LiveLambda proxying is enabled.
# LIVE_LAMBDA_ENABLED can be "true" (always on), "false" (off), or a Unix
# timestamp (heartbeat — enabled if within 5 minutes of current time).
ENABLED="$LIVE_LAMBDA_ENABLED"
REDIRECT=false

if [ "$ENABLED" = "true" ]; then
    REDIRECT=true
elif [ "$ENABLED" != "false" ] && [ "$ENABLED" != "" ]; then
    # Treat as Unix timestamp — check if within 5 minute heartbeat window
    NOW=$(date +%s)
    AGE=$((NOW - ENABLED))
    if [ "$AGE" -lt 300 ] && [ "$AGE" -ge 0 ]; then
        REDIRECT=true
    fi
fi

if [ "$REDIRECT" = "true" ]; then
    LISTENER_PORT="${LRAP_LISTENER_PORT:-8082}"
    export AWS_LAMBDA_RUNTIME_API="127.0.0.1:${LISTENER_PORT}"
fi

exec "$@"
