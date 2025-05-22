# CDK and Infrastructure (`docs/cdk.md`)

This document describes the AWS Cloud Development Kit (CDK) setup and the AWS infrastructure provisioned by this project.

## Overview

The AWS infrastructure required for `live-lambda` is defined using AWS CDK in TypeScript. This includes:

-   **AppSync API**: A GraphQL API with WebSocket capabilities for real-time communication between the Lambda environment and the local development server.
-   **Lambda Layer**: A Lambda Layer containing the Go-based extension responsible for intercepting Lambda invocations.
-   **IAM Roles and Policies**: Necessary permissions for the Lambda functions, AppSync, and other services to interact securely.
-   (Potentially) Helper Lambda functions or other supporting resources.

## CDK Stacks

Located in `src/cdk/`:

-   **`appsync-stack.ts`**: Defines the AWS AppSync API. This API is crucial for establishing the WebSocket connection used to proxy events.
-   **`live-lambda-layer-stack.ts`**: Defines the Lambda Layer. This stack packages the Go extension and any necessary wrapper scripts.
-   **`live-lambda-aspect.ts` (or similar)**: Might contain CDK Aspects used to modify or enforce configurations across multiple stacks or constructs, such as automatically adding the Live Lambda layer to specified functions.

## Key Infrastructure Components

### 1. AppSync API

-   **Purpose**: To provide a persistent WebSocket connection.
-   **Authentication**: Typically uses IAM authentication for secure connections from the Lambda extension and the local server.
-   **Schema**: A minimal GraphQL schema is defined, primarily to support the WebSocket event publishing and subscription mechanism.

### 2. Lambda Layer (`live-lambda-layer`)

-   **Contents**:
    -   The compiled Go extension binary (`live-lambda-extension-go`).
    -   A wrapper script (`live-lambda-runtime-wrapper.sh` or similar) set as the `AWS_LAMBDA_EXEC_WRAPPER`.
-   **Functionality**: The extension intercepts calls to the Lambda Runtime API. When an invocation event is received, it forwards the event payload via the AppSync WebSocket to the local development server.

### 3. IAM Permissions

-   The Lambda execution role for functions using `live-lambda` will need permissions to:
    -   Connect to and publish messages to the AppSync WebSocket API.
    -   Any other AWS services the original Lambda function needs to access.
-   The CDK deployment role requires permissions to create and manage these resources.

## Deployment

Infrastructure is deployed using the CLI:

```bash
pnpm run dev deploy --profile <your-profile-name>
```

This command synthesizes the CDK application and deploys the defined stacks to your AWS account.

## Configuration

-   **`cdk.json`**: Contains context information and settings for the CDK application, such as default AWS region or feature flags.
-   **Environment Variables for Lambda Functions**:
    -   `AWS_LAMBDA_EXEC_WRAPPER=/opt/live-lambda-runtime-wrapper.sh`: Instructs the Lambda runtime to use the custom wrapper.
    -   `APPSYNC_ENDPOINT_URL`: The WebSocket URL of the deployed AppSync API.
    -   `APPSYNC_API_ID`: The ID of the AppSync API.
    -   `APPSYNC_REGION`: The AWS region of the AppSync API.
    -   `LIVE_LAMBDA_LAYER_ARN`: The ARN of the deployed Live Lambda layer.
    -   `LRAP_LISTENER_PORT`: Port for the Go extension to listen on (default 8082).

These variables are typically injected into Lambda functions either manually, via CDK (e.g., using an Aspect), or by the `live-lambda` CLI when configuring a function to use the system.

## Customization

-   To modify the infrastructure, edit the relevant TypeScript files in `src/cdk/`.
-   After making changes, rebuild the project (`pnpm build`) and redeploy (`pnpm run dev deploy ...`).
