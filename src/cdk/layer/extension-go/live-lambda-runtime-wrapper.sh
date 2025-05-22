#!/bin/sh
# This script is used by AWS_LAMBDA_EXEC_WRAPPER.
# It sets the AWS_LAMBDA_RUNTIME_API for the function process
# to point to our extension's proxy server.

# Documentation: https://docs.aws.amazon.com/lambda/latest/dg/runtimes-modify.html#runtime-wrapper

# The port our extension's proxy server (RuntimeApiProxy) is listening on.
# This will be provided by the LRAP_LISTENER_PORT environment variable.
# Default to 8082 if not set, to align with CDK default.
LISTENER_PORT="${LRAP_LISTENER_PORT:-8082}"

export AWS_LAMBDA_RUNTIME_API="127.0.0.1:${LISTENER_PORT}"

# Execute the original handler command (e.g., node index.js)
# "$@" contains the original command and arguments provided by AWS Lambda.
exec "$@"
