# Development Guide (`Development.md`)

This document provides guidance for developers working on or contributing to the `live-lambda` project.

## Project Overview

`live-lambda` aims to accelerate AWS Lambda development by proxying invocations to a local development server, enabling real-time feedback and debugging.

**Core Components:**

1.  **AWS CDK Infrastructure**: Manages AWS resources (AppSync, Lambda Layer).
2.  **Go Lambda Extension**: Runs in the Lambda environment to intercept and proxy invocations.
3.  **TypeScript CLI**: For deploying infrastructure and running the local server.
4.  **TypeScript Local Server**: Receives proxied events and executes local Lambda code.

## Getting Started for Developers

1.  **Prerequisites**: Ensure all tools listed in `README.md` (Node.js, pnpm, AWS CLI, Go) are installed.
2.  **Clone & Install**: Clone the repository and run `pnpm install`.
3.  **Environment Setup**:
    -   Configure your AWS CLI with a development profile.
    -   Familiarize yourself with the `package.json` scripts.

## Build Process

-   **Main Build (`pnpm build`)**: This command performs two main actions:
    1.  **TypeScript Compilation**: `tsc -p tsconfig.json` compiles all TypeScript files in `src/` to JavaScript in `dist/`.
    2.  **Go Extension Build**: `bash src/cdk/layer/extension-go/build-extension-artifacts.sh` compiles the Go Lambda extension for `amd64` and `arm64` Linux, placing binaries in `dist/extensions/bin/` and preparing the layer structure in `dist/layer/extension/`.
        -   This script features conditional compilation: it skips recompiling Go if source files haven't changed and binaries exist (based on a SHA256 hash stored in `dist/go_extension.sha256`).
-   **Cleaning (`pnpm run clean`)**: Removes the `dist/` directory and `outputs.json`.
-   **Watching TypeScript (`pnpm run watch`)**: Runs `tsc -w` for continuous compilation of TypeScript files during development.

## Key Architectural Decisions & Patterns

-   **Go for Lambda Extension**: Chosen for its performance, small binary size, and suitability for system-level tasks like acting as a runtime API proxy.
-   **AppSync WebSockets for Communication**: Provides a managed, scalable, and secure WebSocket solution with IAM authentication, suitable for bi-directional communication between the Lambda environment and the local server.
-   **AWS CDK for IaC**: TypeScript-based Infrastructure as Code allows for defining cloud resources using a familiar programming language.
-   **Conditional Compilation for Go Extension**: Reduces build times by avoiding unnecessary recompilation of the Go binaries when their source code is unchanged.
-   **AWS_LAMBDA_EXEC_WRAPPER**: Used to inject custom logic (via `live-lambda-runtime-wrapper.sh`) before the Lambda handler runs, primarily to redirect the `AWS_LAMBDA_RUNTIME_API` to the Go extension.

## Code Structure Highlights

-   `src/cdk/`: Infrastructure definition.
    -   `layer/extension-go/runtime_api_proxy.go`: The heart of the Lambda extension.
    -   `layer/extension-go/build-extension-artifacts.sh`: Go build logic.
-   `src/cli/`: CLI command definitions and logic.
    -   `main.ts`: Core implementation of `deploy`, `server`, `destroy` commands.
-   `src/server/index.ts`: Implementation of the local development server that connects to AppSync and invokes local handlers.
-   `src/constants.ts`: Shared constants, e.g., stack names, output file names.

## Important Environment Variables (for the Lambda Function)

These are typically set by the CDK aspect or CLI when integrating a Lambda with `live-lambda`:

-   `AWS_LAMBDA_EXEC_WRAPPER`: `/opt/live-lambda-runtime-wrapper.sh`
-   `APPSYNC_ENDPOINT_URL`: WebSocket endpoint for the AppSync API.
-   `APPSYNC_API_ID`: ID of the AppSync API.
-   `APPSYNC_REGION`: AWS region of the AppSync API.
-   `LIVE_LAMBDA_LAYER_ARN`: ARN of the deployed `live-lambda` layer.
-   `LRAP_LISTENER_PORT`: Port the Go extension listens on (e.g., 8082).

## Reference Documentation & Examples (Links)

*(This section can be populated with links to specific AWS documentation, blog posts, or code examples that were influential or helpful during development.)*

-   **AWS Lambda Extensions API**: [Official Documentation](https://docs.aws.amazon.com/lambda/latest/dg/runtimes-extensions-api.html)
-   **AWS Lambda Runtime Interface Emulator (RIE)**: While we use a custom Go extension, the RIE provides insights into how Lambda runtime interactions work: [AWS RIE on GitHub](https://github.com/aws/aws-lambda-rie)
-   **AWS AppSync WebSocket Protocol**: [Subscription Protocol](https://docs.aws.amazon.com/appsync/latest/devguide/real-time-websocket-client.html#connection-authorization-flow-iam) (especially IAM auth for WebSockets)
-   **AWS CDK Documentation**: [CDK Developer Guide](https://docs.aws.amazon.com/cdk/v2/guide/home.html)
-   **Go `net/http` package (for extension's server)**: [Go net/http Docs](https://pkg.go.dev/net/http)
-   **Go `os/exec` package (example for running commands, if needed elsewhere)**: [Go os/exec Docs](https://pkg.go.dev/os/exec)
-   **User Memory (Internal): WebSocket Header for IAM Auth in Go**: `MEMORY[539105a3-c06a-4fd5-9fdc-871ffdd46f69]` - Emphasizes `base64.RawURLEncoding` and exact header casing.
-   **User Memory (Internal): Go AppSync Client Options v0.2.0**: `MEMORY[8a90449e-f33b-454a-8457-82c89624e0ce]` - Notes the change from full URLs to Host/Region parameters.

## Debugging Tips

-   **Go Extension**: Add extensive logging. Compile and deploy a debug version if necessary. Remember, logs from extensions go to CloudWatch under the Lambda function's log group, often prefixed or identifiable.
-   **Local Server**: Use Node.js debugger or extensive `console.log` statements.
-   **CDK**: Use `cdk diff` to see changes before deploying. `cdk synth` to inspect the generated CloudFormation.
-   **Permissions**: IAM issues are common. Double-check roles and policies for Lambda, AppSync, and any services your function accesses.

## Contribution Guidelines

(If this project becomes open-source or has multiple contributors, add guidelines here, e.g., coding standards, branch strategy, PR process.)

-   Follow existing naming conventions (e.g., snake_case for Go variables/functions as per `MEMORY[3f21a42a-7f8a-4d09-965e-a9207ccb641e]`).
-   Keep documentation updated with any changes.
-   Write tests for new features or bug fixes.
