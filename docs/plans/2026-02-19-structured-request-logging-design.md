# Structured Request Logging

## Goal

Replace scattered `logger.info()` calls during request handling with a progressive, spinner-integrated display. One compact line per request at default verbosity; full lifecycle detail at debug/verbose level. Handler `console.log` output routed through the display to prevent spinner glitches.

## Visual Output

### Normal mode

```
✔ Server ready — listening for Lambda invocations

⠹ WebLambda → POST /tasks (assuming role...)
⠹ WebLambda → POST /tasks (loading handler...)
⠹ WebLambda → POST /tasks (executing...)
  Creating task for workspace ws1...        ← handler console.log
  Task created: task_abc123                 ← handler console.log
← WebLambda → POST /tasks  200  142ms

⠹ StreamLambda → DynamoDB Stream (assuming role...)
← StreamLambda → DynamoDB Stream  200  8ms

← ListenerLambda → SQS Message  200  52ms
```

### Verbose mode (press v)

```
← WebLambda → POST /tasks  200  142ms
  ↳ src/code/web.handler.ts → handler
  ↳ Role: test-cdk-lambda-dev-WebLa-WebLambdaConstructFunctio-xxx
  ↳ esbuild: 24ms
```

### Errors

```
✖ WebLambda → POST /tasks  500  89ms
  ↳ Error: Cannot read property 'id' of undefined
```

## Components

### 1. `RequestTracker` (new: `src/server/request_tracker.ts`)

Tracks a single request lifecycle. Created by `handle_request`, passed into `execute_handler`.

```typescript
interface RequestInfo {
  request_id: string
  function_name: string   // short name derived from ARN (e.g. "WebLambda")
  event_label: string     // "POST /tasks", "SQS Message", "DynamoDB Stream", etc.
  details: string[]       // verbose-mode detail lines collected during execution
}

class RequestTracker {
  constructor(display: TerminalDisplay, info: RequestInfo)

  // Updates the spinner phase text: "WebLambda → POST /tasks (assuming role...)"
  phase(description: string): void

  // Collects a detail line for verbose output (not shown at default level)
  detail(text: string): void

  // Completes: writes "← WebLambda → POST /tasks  200  142ms"
  // If verbose, also writes collected detail lines
  complete(status_code?: number): void

  // Fails: writes "✖ WebLambda → POST /tasks  500  89ms" + error message
  fail(error: Error | string): void
}
```

### 2. Event type detection (new: `src/server/event_detection.ts`)

Parses the incoming Lambda event to produce a human-readable label.

```typescript
function detect_event_label(event: unknown): string
```

Detection rules (in order):
- `event.requestContext?.http` → `{method} {path}` (API Gateway HTTP)
- `event.Records?.[0]?.eventSource === 'aws:sqs'` → `SQS Message`
- `event.Records?.[0]?.eventSource === 'aws:dynamodb'` → `DynamoDB Stream`
- `event.Records?.[0]?.Sns` → `SNS Notification`
- `event.source && event['detail-type']` → `EventBridge: {detail-type}`
- `event.Records?.[0]?.eventSource === 'aws:s3'` → `S3 Event`
- Fallback → `Invocation`

### 3. Function name extraction (in `request_tracker.ts`)

Derive a short display name from the Lambda function ARN or name. The function name from CloudFormation is long (e.g. `test-cdk-lambda-dev-WebLa-WebLambdaConstructFuncti-40UnUcQHs6Ir`). The display name should be the stack's logical construct path from outputs.json (e.g. `WebLambda`).

Approach: when `resolve_handler_from_outputs` finds the matching stack/prefix, return the stack name or construct prefix alongside handler info. The `RequestTracker` uses this for display.

### 4. Extend `TerminalDisplay` interface

Add one method:

```typescript
update_operation(old_label: string, new_label: string): void
```

Replaces the active operation's label so the spinner renders the updated phase text.

### 5. Extend `SpinnerDisplay`

Implement `update_operation`: rename the key in the `active` map, preserving the original start time.

### 6. Console interceptor (new: `src/server/console_interceptor.ts`)

Temporarily patches `console.log`, `console.warn`, `console.error` during handler execution to route output through `display.write_permanent()` (which clears/restores the spinner).

```typescript
function with_console_intercept<T>(
  display: TerminalDisplay,
  fn: () => Promise<T>
): Promise<T>
```

Implementation: saves original console methods, replaces them with display-routed versions, runs `fn()`, restores originals in a finally block. Maps `console.log` → `display.info`, `console.warn` → `display.warn`, `console.error` → `display.error`.

### 7. Refactor `runtime.ts`

- `execute_module_handler` accepts an optional `RequestTracker`
- Replace `logger.info("Using TypeScript source...")` → `tracker.phase("loading handler")` + `tracker.detail("src/code/web.handler.ts → handler")`
- Replace `logger.info("Loading TypeScript source...")` → `tracker.phase("transforming TypeScript")`
- Add `tracker.phase("assuming role")` before credential fetch
- Add `tracker.detail("Role: ...")` after role assumption
- Add `tracker.detail("esbuild: Xms")` after transform
- All current `logger.info()` calls become `logger.debug()` so they only appear in verbose/alt-screen mode
- Wrap `handler(event, context)` call in `with_console_intercept()`

### 8. Refactor `index.ts`

- `handle_request` creates a `RequestTracker` with event detection
- Passes tracker to `execute_handler`
- On success: `tracker.complete(status_code)` — status code extracted from handler response if it looks like an API Gateway response, otherwise omitted
- On error: `tracker.fail(error)`
- Remove all `logger.info()` calls for request lifecycle; keep `logger.debug()` for WebSocket-level details

### 9. Pass display to server

`serve()` already receives `ServerConfig`. Extend it to also accept a `TerminalDisplay` reference so `handle_request` can create trackers that drive the spinner.

## What stays the same

- CDK deploy/destroy spinner flow (CustomIoHost routing)
- Verbose alt-screen toggle (press v)
- `logger.debug()` / `logger.trace()` for deep debugging
- WebSocket connection/reconnection logging

## File changes

| File | Change |
|------|--------|
| `src/server/request_tracker.ts` | New — RequestTracker class |
| `src/server/event_detection.ts` | New — event label detection |
| `src/server/console_interceptor.ts` | New — console patching during handler execution |
| `src/lib/display/types.ts` | Add `update_operation()` to interface |
| `src/lib/display/spinner_display.ts` | Implement `update_operation()` |
| `src/server/runtime.ts` | Accept tracker, replace logger.info → tracker.phase/detail |
| `src/server/index.ts` | Create tracker, drive lifecycle, pass display |
| `src/server/types.ts` | Extend `ServerConfig` with display |
| `src/cli/main.ts` | Pass display into `serve()` config |
