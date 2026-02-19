# Live Lambda: Real-time Lambda Development Environment

`live-lambda` provides a development environment that enables real-time feedback and debugging for AWS Lambda functions by proxying invocations to a local development server.

## Overview

This project facilitates a faster development cycle for AWS Lambda functions by:

- Deploying a thin AWS Lambda layer and an optional proxy function.
- Using an AWS AppSync WebSocket API to channel Lambda invocation events to a local development server.
- Allowing your Lambda function code to be executed locally, with immediate access to logs and debugging tools.
- Sending responses from your local execution back through the WebSocket to the original caller.

## Features

- **Real-time Invocation**: Test Lambda changes instantly without redeploying the function itself.
- **Local Debugging**: Utilize your preferred local debugging tools.
- **Go-based Lambda Extension**: Efficiently manages the proxying of requests and responses within the Lambda environment.
- **AWS CDK for Infrastructure**: Infrastructure is managed using the AWS Cloud Development Kit (CDK).
- **TypeScript-based CLI and Server**: For managing deployments and handling local invocations.

## Prerequisites

Before you begin, ensure you have the following installed:

- Node.js (version specified in `package.json`'s `pnpm.packageManager` or latest LTS)
- pnpm (version specified in `package.json`'s `pnpm.packageManager`)
- AWS CLI (configured with appropriate credentials and default region)
- Go (latest stable version, for building the Lambda extension)
- Docker (optional, if CDK requires it for asset bundling, though currently using pre-built Go extension)

## Installation

1.  Clone the repository:
    ```bash
    git clone <your-repository-url>
    cd live-lambda
    ```
2.  Install dependencies using pnpm:
    ```bash
    pnpm install
    ```

## Configuration

- **AWS Profile**: Ensure your AWS CLI is configured with the profile you intend to use for deployment. Pass this profile to CLI commands using the `--profile <your-profile-name>` flag.
- **CDK Configuration**: The primary CDK configuration is in `cdk.json`. You might need to adjust settings like region or other context variables if they are parameterized.

## Core Commands

All commands are run from the root of the project.

- **Build the project** (compiles TypeScript and the Go Lambda extension):
  ```bash
  pnpm build
  ```
- **Clean build artifacts**:
  ```bash
  pnpm run clean
  ```
- **Deploy AWS infrastructure** (AppSync API, Lambda Layer, etc.):

  ```bash
  pnpm run dev deploy --profile <your-profile-name>
  ```

  _You can target specific stacks if needed, e.g., `pnpm run dev deploy AppSyncStack LiveLambdaLayerStack --profile <your-profile-name>`._

- **Start the local development server** (listens for proxied Lambda invocations):

  ```bash
  pnpm run dev server --profile <your-profile-name>
  ```

  _Ensure the server is running before your Lambda function (with the Live Lambda layer) is invoked._

- **Destroy AWS infrastructure**:
  ```bash
  pnpm run dev destroy --profile <your-profile-name>
  ```
  *Note: This uses a pattern match (`*Lambda`) to select stacks for destruction. Review `src/cli/main.ts` if you need to adjust this behavior.\*

## Project Structure

- `src/`
  - `cdk/`: AWS CDK stacks for defining infrastructure.
    - `layer/extension-go/`: Source code and build script for the Go Lambda extension.
  - `cli/`: Command Line Interface for managing deployments and the dev server.
  - `layer/`: (Currently holds aspects related to the layer configuration in CDK).
  - `server/`: Local development server that receives and processes proxied Lambda requests.
  - `constants.ts`: Project-wide constants.
  - `index.ts`: Main entry point for the library aspects (if any).
- `dist/`: Compiled output directory.
- `docs/`: Detailed documentation for different modules.
- `package.json`: Project dependencies and scripts.
- `tsconfig.json`: TypeScript configuration.
- `cdk.json`: CDK application configuration.

## Module Documentation

For more detailed information on specific parts of the project, please refer to:

- [CDK and Infrastructure (`docs/cdk.md`)](./docs/cdk.md)
- [Lambda Layer and Go Extension (`docs/layer.md`)](./docs/layer.md)
- [Command Line Interface (CLI) (`docs/cli.md`)](./docs/cli.md)
- [Local Development Server (`docs/server.md`)](./docs/server.md)
- [Programmatic API (`docs/programmatic-api.md`)](./docs/programmatic-api.md)

## Development

For information on contributing to this project, build processes, architectural decisions, and other development-related topics, see [Development.md](./Development.md).

## License

(Specify your license here, e.g., MIT, Apache 2.0, or leave as proprietary if applicable)
