# Live Lambda Development - Progress Update (2025-05-08)

This document summarizes the current status of the Live Lambda development effort and outlines the next steps.

## Current Status / Accomplishments

The primary goal of this phase was to create a Proof of Concept (PoC) for the `LiveLambdaTunnel` CDK construct, capable of deploying a proxy Lambda function.

Key achievements include:

1.  **`@live-lambda/tunnel` Package:**
    *   Successfully defined the `LiveLambdaTunnel` CDK construct (`src/index.ts`). This construct conditionally provisions a proxy Lambda when its `is_live` property is set to `true`.
    *   Implemented a basic proxy Lambda handler (`src/lambda-proxy/handler.ts`) that logs incoming events and returns a hardcoded response, serving as the initial version of the cloud-side proxy.
    *   Corrected and aligned `package.json` (added `@types/aws-lambda`) and `tsconfig.json` (configured for proper ESM output and type declarations, extending the workspace's `tsconfig.base.json`).

2.  **Integration with `sample-app`:**
    *   The `LiveLambdaTunnel` construct was successfully imported and instantiated within the `sample-app`'s `sample-infrastructure.stack.ts`.
    *   The `is_live` flag was hardcoded to `true` for testing, demonstrating the conditional deployment of the proxy Lambda.

3.  **Successful Deployment & Verification:**
    *   The `SampleInfrastructureStack` was deployed, and the `LiveLambdaTunnel` construct successfully provisioned the proxy Lambda (`StubMyUrlLambdaArn`).
    *   Manual invocation of the deployed proxy Lambda (using its ARN via AWS CLI) confirmed its basic functionality: it received the event, logged it (implicitly, to be checked in CloudWatch), and returned the expected hardcoded response.

## Key Learnings / Troubleshooting Highlights

*   **TypeScript Configuration for ESM:** Ensured `tsconfig.json` within the `@live-lambda/tunnel` package correctly inherits from the workspace `tsconfig.base.json` and is configured for ESM output (`module: ESNext`, `moduleResolution: bundler` from base, with `noEmit: false` locally) to ensure compatibility with the ESM-based `sample-app` CDK project.
*   **`NodejsFunction` Entry Points:** Resolved an issue where the CDK `NodejsFunction` was looking for a `.ts` entry file in the `dist` directory. Corrected the path in `LiveLambdaTunnel` to point to the compiled `.js` file (e.g., `lambda-proxy/handler.js`) because `__dirname` for the construct at runtime refers to the `dist` directory.
*   **PNPM Workspace Linking:** Utilized `pnpm install` at the workspace root to refresh inter-package dependencies and symlinks after builds or changes in local workspace packages.

## Next Conceptual Steps

1.  **Actual Proxying Logic in Proxy Lambda:**
    *   Enhance `tunnel/src/lambda-proxy/handler.ts` to:
        *   Forward the incoming `APIGatewayProxyEvent` to the local development server.
        *   Receive a response from the local server.
        *   Return this response as an `APIGatewayProxyResult`.

2.  **`live-lambda-serve` CLI (Local Development Server):**
    *   Begin scaffolding the `live-lambda-serve` CLI tool.
    *   This tool will start a local HTTP server (e.g., using Vite/tsx).
    *   It will listen for requests from the cloud proxy Lambda.
    *   It will invoke the *original* Lambda handler code (e.g., `my-url-handler.ts` from `sample-app`) locally with the received event.
    *   It will send the execution result back to the proxy Lambda.

3.  **Communication Channel:**
    *   Design and implement the communication mechanism between the cloud proxy Lambda and the local `live-lambda-serve` server. (AppSync Real-Time Events API remains a strong candidate).

4.  **Automatic Trigger Re-wiring (Advanced Feature):**
    *   Explore strategies for the `LiveLambdaTunnel` construct or the `live-lambda-serve` CLI to automatically redirect the original Lambda's triggers (e.g., Function URLs, API Gateway integrations) to the proxy Lambda when live mode is active. This is crucial for a seamless developer experience.

5.  **Dynamic Configuration for `is_live`:**
    *   Make the `is_live` flag in `LiveLambdaTunnelProps` dynamically configurable, likely driven by an environment variable or CDK context value passed by the `live-lambda-serve` CLI when initiating a live development session.
