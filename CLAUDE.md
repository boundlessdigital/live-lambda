# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Live Lambda is a real-time AWS Lambda development environment that proxies Lambda invocations through an AppSync WebSocket API to a local development server, enabling instant feedback and debugging without redeploying.

## Commands

```bash
pnpm build                           # Compile TypeScript + build Go extension
pnpm run watch                       # Watch TypeScript files for changes
pnpm run dev deploy --profile <p>    # Deploy AWS infrastructure
pnpm run dev server --profile <p>    # Start local development server
pnpm run dev destroy --profile <p>   # Destroy AWS stacks
pnpm run clean                       # Remove dist/ and outputs.json
```

Run TypeScript directly during development:
```bash
tsx src/cli/index.ts <command>
```

## Architecture

### Core Components

1. **Go Lambda Extension** (`src/cdk/layer/extension-go/`)
   - Intercepts Lambda invocations by proxying the Lambda Runtime API
   - Sends events to AppSync WebSocket, waits for local server response
   - Key files: `main.go`, `runtime_api_proxy.go`, `extensions_api_client.go`
   - Conditional build via SHA256 hash check (avoids recompilation)

2. **CDK Infrastructure** (`src/cdk/`)
   - `stacks/appsync.stack.ts`: AppSync Event API for WebSocket communication
   - `stacks/layer.stack.ts`: Lambda Layer packaging
   - `aspects/live-lambda-layer.aspect.ts`: Auto-configures NodejsFunction constructs with layer, env vars, and IAM policies

3. **Local Server** (`src/server/`)
   - Connects to AppSync WebSocket, subscribes to `/live-lambda/requests`
   - Executes local handlers with assumed Lambda role credentials
   - Publishes responses to `/live-lambda/response/{request_id}`

4. **CLI** (`src/cli/`)
   - Uses Commander.js, interfaces with AWS CDK Toolkit
   - `main.ts` contains core deploy/server/destroy logic

### Data Flow

```
Lambda Invocation → Go Extension → AppSync WebSocket → Local Server
                                                           ↓
                                                    Execute Handler
                                                           ↓
Lambda Response  ← Go Extension ← AppSync WebSocket ← Response
```

### Key Environment Variables (set by CDK aspect)

- `AWS_LAMBDA_EXEC_WRAPPER`: `/opt/live-lambda-runtime-wrapper.sh`
- `APPSYNC_ENDPOINT_URL`, `APPSYNC_API_ID`, `APPSYNC_REGION`
- `LIVE_LAMBDA_LAYER_ARN`, `LRAP_LISTENER_PORT`

## Code Style

- **Naming**: snake_case for functions/variables, CamelCase for classes/interfaces/types
- **No semicolons** (enforced by ESLint)
- TypeScript strict mode enabled

## Key Dependencies

- AWS CDK 2.x for infrastructure
- `@boundlessdigital/aws-appsync-events-websockets-client` for WebSocket communication
- Go (required for building Lambda extension)
