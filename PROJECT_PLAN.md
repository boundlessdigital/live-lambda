# Project: Live Lambda for CDK (`live-lambda-cdk`)

## 1. High-Level Overall Goals

-   **Enable Rapid Local Development:** Allow developers using AWS CDK to test their Lambda functions locally with changes reflected almost instantly, without requiring a full `cdk deploy` for every code modification.
-   **Cloud-Parity Experience:** Ensure the local execution environment closely mirrors the deployed AWS Lambda environment, particularly concerning event payloads, context objects, and IAM permissions.
-   **Seamless Integration:** Provide a developer-friendly experience that integrates smoothly with the existing CDK workflow.
-   **Core Functionality First:** Focus on delivering the core proxying and local execution mechanism, then iterate on enhancements.

## 2. Key Components

*   **`live-lambda-cdk-construct`** (CDK Construct Library - to be part of `tunnel` or a new package):
    *   A custom CDK L2/L3 construct that users will add to their CDK stacks.
    *   Responsible for provisioning the necessary AWS infrastructure (e.g., AppSync API, Stub Lambda IAM Role).
    *   Modifies specified Lambda functions in the CDK app during a "dev" deployment to replace them with a "Stub Lambda."
*   **`Stub Lambda`** (AWS Lambda Function):
    *   A lightweight Lambda function deployed by the `live-lambda-cdk-construct`.
    *   Its sole purpose is to receive an invocation (event, context), forward it to the local development machine via the communication channel, await a response, and then return that response to the original caller.
    *   It will run with the IAM permissions defined by the user for their original Lambda function.
*   **`Communication Channel`** (AWS AppSync with WebSocket):
    *   An AWS AppSync GraphQL API configured for real-time messaging using WebSockets.
    *   Used for bi-directional communication between the `Stub Lambda` in AWS and the `Local Tunnel Client` on the developer's machine.
*   **`live-lambda-cdk-tunnel`** (Local Tunnel Client - CLI Tool - likely the main part of the `tunnel` package):
    *   A command-line tool that developers run on their local machine.
    *   Connects to the `Communication Channel` (AppSync WebSocket).
    *   Listens for invocation requests from `Stub Lambdas`.
    *   Executes the *actual* user's Lambda function code locally using the received event and context.
    *   Sends the local function's response (or error) back through the `Communication Channel` to the `Stub Lambda`.
    *   Manages local state, function handler mapping, and provides feedback to the developer.
*   **`sample-app`** (CDK Project):
    *   A sample AWS CDK application used to test and demonstrate the `live-lambda-cdk` functionality.
    *   Will include one or more Lambda functions that can be "live-enabled."

## 3. Step-by-Step Outline, Components, and Verifications

### Phase 1: Core Communication & Local Execution (Proof of Concept)
*Goal: Establish basic communication between a local process and a simulated AWS environment.*

-   [ ] **Step 1.1: Setup Testing Framework for `tunnel` package.**
    *   **Component:** `tunnel` package.
    *   **Action:** Install and configure a testing framework (e.g., Jest or Vitest).
    *   **Verification:** Run a simple placeholder test to confirm the framework is operational.
-   [ ] **Step 1.2: Develop Mock WebSocket Server.**
    *   **Component:** `tunnel` package (for testing).
    *   **Action:** Create a simple mock WebSocket server that the local tunnel client can connect to. This server will simulate AppSync for early development.
    *   **Verification:** Local client can connect to and exchange basic messages with the mock server.
-   [ ] **Step 1.3: Implement Basic Local Tunnel Client - Connection.**
    *   **Component:** `live-lambda-cdk-tunnel` (CLI).
    *   **Action:** Develop the CLI to connect to the (mock) WebSocket server. Implement connection logic, basic error handling, and logging.
    *   **Verification:** CLI successfully connects to the mock WebSocket server and logs connection status.
-   [ ] **Step 1.4: Implement Basic Local Function Execution.**
    *   **Component:** `live-lambda-cdk-tunnel`.
    *   **Action:** Create a mechanism within the tunnel client to dynamically load and execute a specified local TypeScript/JavaScript Lambda handler function (e.g., from `sample-app`). Simulate receiving an event/context payload.
    *   **Verification:** Tunnel client can successfully invoke a local Lambda handler with a mock event/context and capture its response or error. Test with a simple `console.log` and return value.
-   [ ] **Step 1.5: Integrate Local Client with Mock WebSocket for Request/Response.**
    *   **Component:** `live-lambda-cdk-tunnel`, Mock WebSocket Server.
    *   **Action:**
        *   Mock server sends a "Lambda invocation" message (containing mock event, context, function identifier).
        *   Tunnel client receives the message, executes the corresponding local function.
        *   Tunnel client sends the local function's result back to the mock server.
    *   **Verification:** End-to-end flow works with the mock server: message received, local function runs, response sent back and received by mock server.

### Phase 2: AWS Infrastructure & Stub Lambda (CDK Construct)
*Goal: Set up the actual AWS-side infrastructure and the stub Lambda.*

-   [ ] **Step 2.1: Design and Implement `live-lambda-cdk-construct`.**
    *   **Component:** `live-lambda-cdk-construct` (new CDK construct library, or part of `tunnel`).
    *   **Action:**
        *   Define the construct's API (how users will add it to their CDK app and specify which functions to make "live").
        *   Implement logic to provision the AppSync API (for WebSocket communication).
        *   Implement logic to provision an IAM Role for the Stub Lambda (initially, it might just need AppSync publish permissions).
    *   **Verification:** `cdk synth` produces the expected CloudFormation for AppSync. `cdk deploy` successfully creates the AppSync API.
-   [ ] **Step 2.2: Develop the `Stub Lambda` Function.**
    *   **Component:** `Stub Lambda`.
    *   **Action:** Write the Node.js code for the stub Lambda.
        *   It should be able to receive standard Lambda event/context.
        *   It needs to connect to the AppSync API (using AWS SDK v3) and publish the event/context.
        *   It needs to subscribe/listen for a response event from AppSync associated with its invocation.
        *   Return the received response.
        *   Handle timeouts and errors gracefully (e.g., if the local client doesn't respond).
    *   **Verification:**
        *   Manually deploy the Stub Lambda.
        *   Manually invoke it (e.g., via AWS Console) and verify it attempts to publish to AppSync (check AppSync logs/metrics if possible, or add logging to the stub).
-   [ ] **Step 2.3: Integrate `Stub Lambda` into `live-lambda-cdk-construct`.**
    *   **Component:** `live-lambda-cdk-construct`.
    *   **Action:** The construct should deploy the `Stub Lambda` function code and configure it with necessary environment variables (e.g., AppSync endpoint, API key if used).
    *   **Verification:** `cdk deploy` (using the construct in `sample-app`) deploys the stub Lambda correctly.
-   [ ] **Step 2.4: Implement Function Swapping in the Construct.**
    *   **Component:** `live-lambda-cdk-construct`.
    *   **Action:** Add logic to the construct so that when a "dev mode" is active (e.g., via CDK context variable `cdk deploy -c live-lambda:myFunction=true MyStack`), it replaces the user's specified Lambda function's code/handler with the `Stub Lambda`'s code/handler and ensures the stub uses the *original function's IAM role*.
    *   **Verification:** When deploying `sample-app` with "dev mode" for a function, the deployed Lambda for that function is indeed the stub, and it has the original function's IAM permissions.

### Phase 3: End-to-End Integration & IAM
*Goal: Connect all pieces and make it work, including proper IAM credential handling.*

-   [ ] **Step 3.1: Connect Local Tunnel Client to Live AppSync.**
    *   **Component:** `live-lambda-cdk-tunnel`.
    *   **Action:** Modify the client to connect to the real AppSync WebSocket endpoint created by the CDK construct. Implement authentication if AppSync requires it (e.g., IAM auth or API Key).
    *   **Verification:** Local client successfully connects to the live AppSync endpoint.
-   [ ] **Step 3.2: End-to-End Test (No IAM Passthrough Yet).**
    *   **Component:** All components.
    *   **Action:**
        *   Deploy `sample-app` with a "live-enabled" Lambda function using the `live-lambda-cdk-construct`.
        *   Run the `live-lambda-cdk-tunnel` CLI locally, configured to point to the local handler for that function.
        *   Invoke the live-enabled Lambda in AWS (e.g., via API Gateway if set up, or manual invocation).
    *   **Verification:** The request flows from AWS invoker -> Stub Lambda -> AppSync -> Local Tunnel Client -> Local Handler Execution -> AppSync -> Stub Lambda -> AWS invoker. The correct response is received.
-   [ ] **Step 3.3: Design IAM Credential Passing Mechanism.**
    *   **Component:** `Stub Lambda`, `live-lambda-cdk-tunnel`.
    *   **Action:**
        *   The `Stub Lambda`, running with the original function's IAM role, needs to generate temporary credentials (e.g., using `STS:AssumeRole` on its own role, or simply passing its environment credentials if secure enough and short-lived).
        *   These credentials (access key, secret key, session token) need to be securely passed along with the event/context payload to the local client via AppSync.
    *   **Verification:** Theoretical design is sound and considers security implications.
-   [ ] **Step 3.4: Implement IAM Credential Passing & Usage.**
    *   **Component:** `Stub Lambda`, `live-lambda-cdk-tunnel`.
    *   **Action:**
        *   `Stub Lambda`: Implements credential generation and includes them in the payload.
        *   `Local Tunnel Client`: Extracts credentials from the payload and configures the AWS SDK used by the *locally executed user code* to use these temporary credentials.
    *   **Verification:**
        *   Local Lambda code in `sample-app` that tries to access an AWS service (e.g., S3 listBuckets) succeeds if the original Lambda's IAM role has permission, and fails if it doesn't.
        *   Logs on the local client should show which credentials are being used for the AWS SDK.
-   [ ] **Step 3.5: Handler Mapping & Multiple Function Support.**
    *   **Component:** `live-lambda-cdk-tunnel`.
    *   **Action:** Implement a robust way for the local tunnel client to map incoming requests (identified by a function identifier from the stub) to the correct local handler file/function. Allow configuration for multiple "live" functions.
    *   **Verification:** Can run multiple different Lambda functions from `sample-app` in "live" mode simultaneously.

### Phase 4: Refinements, CLI UX, Documentation & Packaging
*Goal: Improve usability, robustness, and prepare for others to use it.*

-   [ ] **Step 4.1: CLI Enhancements.**
    *   **Component:** `live-lambda-cdk-tunnel`.
    *   **Action:** Improve CLI arguments, output logging (verbose/quiet modes), error reporting, configuration options (e.g., path to CDK app, function mappings).
    *   **Verification:** CLI is user-friendly and provides clear feedback.
-   [ ] **Step 4.2: Hot Reloading (Stretch Goal for V1).**
    *   **Component:** `live-lambda-cdk-tunnel`.
    *   **Action:** Explore and implement (if feasible for V1) automatic reloading of local Lambda function code when files change (e.g., using `chokidar` and clearing the `require` cache or re-importing ES modules).
    *   **Verification:** Changes to local Lambda code are picked up by the tunnel client without restarting it.
-   [ ] **Step 4.3: Comprehensive Error Handling & Resilience.**
    *   **Component:** All components.
    *   **Action:** Review and improve error handling across the system (network issues, AppSync errors, local execution errors, credential errors).
    *   **Verification:** System is robust to common failure scenarios and provides informative error messages.
-   [ ] **Step 4.4: Security Review.**
    *   **Component:** All components.
    *   **Action:** Review the credential passing mechanism and AppSync security settings (e.g., auth type, fine-grained access control if needed).
    *   **Verification:** System adheres to security best practices.
-   [ ] **Step 4.5: Documentation.**
    *   **Component:** Project documentation (READMEs).
    *   **Action:** Write clear documentation for:
        *   Setting up and using the `live-lambda-cdk-construct`.
        *   Running and configuring the `live-lambda-cdk-tunnel` CLI.
        *   Architecture overview.
        *   Troubleshooting.
    *   **Verification:** Documentation is clear, comprehensive, and accurate.
-   [ ] **Step 4.6: Packaging & Distribution.**
    *   **Component:** `live-lambda-cdk-construct`, `live-lambda-cdk-tunnel`.
    *   **Action:** Package the CDK construct as an npm library. Package the CLI tool (e.g., as an npm global package or downloadable binary).
    *   **Verification:** Users can easily install and use the components.

## 4. General Considerations & Potential Challenges

*   **Cost:** AppSync usage will incur costs. Need to be mindful of this, especially the "messages processed" and "connection minutes."
*   **Cold Starts for Stub Lambda:** The stub itself might have cold starts, though it should be very quick.
*   **Latency:** There will be added latency due to the proxying. The goal is "fast enough" for development.
*   **ESM vs. CJS:** Handling both module systems for local Lambda execution.
*   **TypeScript Transpilation:** The local tunnel client will need to transpile TypeScript Lambda handlers on the fly or require users to pre-transpile. `tsx` (which you use) can handle this.
*   **Debugging Local Functions:** Users should be able to attach a debugger to the Node.js process running their local Lambda code (managed by the tunnel client).
*   **Mapping Deployed Functions to Local Files:** This requires a clear convention or configuration.
*   **Security of Credential Passing:** This is paramount. Temporary, short-lived credentials are key.
*   **Regional AppSync Endpoints:** The system should correctly use the AppSync endpoint for the AWS region the CDK app is deployed to.
