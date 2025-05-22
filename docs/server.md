# Local Development Server (`docs/server.md`)

This document describes the local development server component of the `live-lambda` system.

## Overview

The local development server is responsible for receiving proxied AWS Lambda invocation events, processing them using your local Lambda function code, and sending the results back. It's a critical piece for enabling the real-time development experience.

The server is implemented in TypeScript and is started via the `pnpm run dev server` CLI command.

## Core Functionality

1.  **WebSocket Connection**: Establishes and maintains a WebSocket connection to the AWS AppSync API that was deployed by the `deploy` command.
    -   It uses IAM authentication, requiring valid AWS credentials (typically provided via the `--profile` option).
    -   It subscribes to specific topics or channels on the WebSocket to receive invocation events forwarded by the Go Lambda extension.
2.  **Event Handling**: When a new event (Lambda payload and context) is received over the WebSocket:
    -   The server parses the incoming message.
    -   It identifies the target local handler function that should process this event.
    -   It invokes this local handler with the received event and a mock context object.
3.  **Local Handler Invocation**: The server needs a mechanism to find and execute your local Lambda function code. This might involve:
    -   A configurable path to your handler file and function name (e.g., `src/handlers/myFunction.handler`).
    -   Dynamically importing or requiring the handler module.
    -   Potentially supporting hot-reloading of handler code for an even faster feedback loop (though this might be an advanced feature).
4.  **Response Proxying**: After the local handler executes and returns a response (or an error):
    -   The server packages this response.
    -   It sends the response back over the AppSync WebSocket to the Go Lambda extension running in the AWS Lambda environment.
5.  **Logging**: Provides console output for incoming requests, responses, errors, and WebSocket connection status, aiding in debugging and monitoring the local development flow.

## Implementation Details (`src/server/index.ts`)

-   **AppSync WebSocket Client**: Uses the `@boundlessdigital/aws-appsync-events-websockets-client` library (or a similar custom implementation) to manage the WebSocket connection to AppSync.
    -   Handles connection establishment, IAM signing of WebSocket headers, subscription requests, and message parsing.
    -   Manages reconnection logic if the WebSocket connection drops.
-   **Configuration**: Reads necessary configuration to connect to AppSync, such as:
    -   AppSync Realtime (WebSocket) Endpoint URL.
    -   AppSync API Host.
    -   AWS Region.
    -   These values are typically read from the CDK outputs file (e.g., `outputs.json`) or environment variables set by the CLI based on those outputs.
-   **Handler Logic**: The `serve` function in `src/server/index.ts` (or a module it calls) contains the main loop for:
    -   Setting up the WebSocket client.
    -   Defining callbacks for `onMessage`, `onConnect`, `onError`, etc.
    -   The `onMessage` callback is where the core logic of invoking the local handler and sending back the response resides.

## Running the Server

```bash
pnpm run dev server --profile <your-aws-profile>
```

-   The server must be running *before* any Lambda functions configured with `live-lambda` are invoked in AWS.
-   Ensure that the AWS profile provided has the necessary IAM permissions to connect to the AppSync API (these permissions are typically set up by the `deploy` command).

## Example Workflow for an Event

1.  Local server starts and connects to AppSync WebSocket.
2.  An AWS Lambda function (with the `live-lambda` layer) is invoked in the cloud.
3.  The Go extension in the Lambda captures the invocation event.
4.  The Go extension sends the event payload and request ID over the AppSync WebSocket.
5.  The local `live-lambda` server, subscribed to the appropriate topic, receives the message.
6.  The local server identifies and executes your local handler code (e.g., `myLocalHandler(event, context)`).
7.  Your local code runs, performs its logic, and returns a result (or throws an error).
8.  The local server takes this result/error and sends it back over the AppSync WebSocket to the Go extension.
9.  The Go extension provides this result/error to the Lambda runtime environment, completing the proxied invocation.
10. The local server logs the interaction.

## Future Considerations

-   **Hot Module Replacement (HMR)**: For automatically reloading handler code changes without restarting the server.
-   **Multiple Handler Support**: A more robust way to map incoming requests to different local handler files/functions if the system is designed to proxy for multiple Lambda functions.
-   **Enhanced Mocking**: Providing more comprehensive mock objects for Lambda context and AWS SDK services.
