# Command Line Interface (CLI) (`docs/cli.md`)

This document provides details about the `live-lambda` Command Line Interface (CLI).

## Overview

The CLI is the primary way to interact with the `live-lambda` system. It allows you to manage the AWS infrastructure (deployment, destruction) and run the local development server.

The CLI is implemented in TypeScript and uses the `commander` library for command parsing. The main entry point for development is `src/cli/index.ts`, which is executed via `tsx`. For packaged/distributed use, the compiled `dist/cli/index.js` is used.

## Accessing the CLI

During development, CLI commands are typically run via `pnpm run dev ...` which translates to `tsx src/cli/index.ts ...`.

Example:
```bash
pnpm run dev deploy --profile my-profile
```

## Core Commands

### 1. `deploy`

-   **Action**: Deploys the necessary AWS infrastructure using AWS CDK.
-   **Usage**:
    ```bash
    pnpm run dev deploy [stacks...] --profile <your-aws-profile> [--region <aws-region>]
    ```
-   **Arguments**:
    -   `[stacks...]` (optional): A list of specific CDK stack names to deploy. If omitted, all stacks defined in the CDK app (typically `AppSyncStack` and `LiveLambdaLayerStack`) are deployed.
-   **Options**:
    -   `--profile <your-aws-profile>` (required): Specifies the AWS named profile to use for deployment.
    -   `--region <aws-region>` (optional): Specifies the AWS region for deployment. If not provided, it may default to the region configured in your AWS profile or CDK settings.
-   **Details**: This command invokes `cdk deploy` with the specified arguments and options. It handles synthesizing the CDK CloudFormation templates and provisioning the resources in your AWS account.

### 2. `server`

-   **Action**: Starts the local development server.
-   **Usage**:
    ```bash
    pnpm run dev server --profile <your-aws-profile> [--region <aws-region>]
    ```
-   **Options**:
    -   `--profile <your-aws-profile>` (required): Specifies the AWS named profile. This is used to fetch AWS credentials for connecting to the AppSync WebSocket API with IAM authentication.
    -   `--region <aws-region>` (optional): Specifies the AWS region where the AppSync API is deployed.
-   **Details**: The server listens for incoming Lambda invocation events proxied via the AppSync WebSocket. When an event is received:
    1.  It typically attempts to invoke a local handler function that mirrors your actual Lambda function's logic.
    2.  The path to this local handler might be configurable or follow a convention.
    3.  It sends the response from the local handler back through the WebSocket to the Go extension in the Lambda environment.
    4.  It logs request and response details to the console.

### 3. `destroy`

-   **Action**: Destroys the AWS infrastructure previously deployed by `live-lambda`.
-   **Usage**:
    ```bash
    pnpm run dev destroy --profile <your-aws-profile> [--region <aws-region>]
    ```
-   **Options**:
    -   `--profile <your-aws-profile>` (required): Specifies the AWS named profile used for deployment.
    -   `--region <aws-region>` (optional): Specifies the AWS region where the resources were deployed.
-   **Details**: This command invokes `cdk destroy`. By default, it might target stacks with names matching a pattern like `*Lambda*` or all stacks in the app. Be cautious with this command, as it will permanently delete the resources.

## CLI Implementation (`src/cli/`)

-   **`index.ts`**: Sets up `commander` and defines the top-level commands. This is the script executed by `tsx`.
-   **`main.ts`**: Contains the core logic for each command (deploy, server, destroy).
    -   **`deployCdk` function**: Handles the logic for deploying CDK stacks. It constructs and executes the `cdk deploy` command.
    -   **`serve` function (in `src/server/index.ts` but called from `main.ts`)**: Implements the local development server. See `docs/server.md` for more details.
    -   **`destroyCdk` function**: Handles the logic for destroying CDK stacks. It constructs and executes the `cdk destroy` command.
-   **Shared Utilities**: May include helper functions for AWS SDK interactions, configuration loading, etc.

## Configuration

The CLI relies on:

-   **AWS Credentials**: Sourced via the AWS SDK's standard credential chain, preferring the `--profile` option if provided.
-   **CDK Output**: After a successful `deploy` command, CDK typically generates an `outputs.json` file (or similar, depending on configuration). This file contains crucial information like the AppSync API endpoint, API ID, and Layer ARN, which the `server` command needs to connect correctly.
-   **Environment Variables**: Some behaviors might be configurable via environment variables, though command-line options are generally preferred for explicit settings.

## Future Enhancements (Potential)

-   Commands to attach the Live Lambda layer to existing Lambda functions.
-   More sophisticated local handler mapping and reloading.
-   Interactive prompts for configuration where appropriate.
