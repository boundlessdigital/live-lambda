# Programmatic API (`docs/programmatic-api.md`)

The `live-lambda` package exports a programmatic API that lets consuming applications start the development server directly, with full control over the terminal display.

## Exports

```typescript
import {
  LiveLambda,       // CDK construct for infrastructure setup
  serve,            // Start the local development server
  SpinnerDisplay,   // Built-in animated terminal display (extensible)
} from 'live-lambda'

import type {
  TerminalDisplay,  // Interface for custom display implementations
  ServerConfig,     // Configuration for serve()
} from 'live-lambda'
```

## Quick Start

### Using the built-in display

```typescript
import { serve, SpinnerDisplay } from 'live-lambda'

const display = new SpinnerDisplay()

await serve({
  region: 'us-east-1',
  http: 'xxx.appsync-api.us-east-1.amazonaws.com',
  realtime: 'xxx.appsync-realtime-api.us-east-1.amazonaws.com',
  layer_arn: 'arn:aws:lambda:us-east-1:123456789:layer:LiveLambdaLayer:1',
  profile: 'my-aws-profile',
  display,
})
```

### Without a display (logging only)

```typescript
import { serve } from 'live-lambda'

// Omit `display` — the server uses pino JSON logging instead
await serve({
  region: 'us-east-1',
  http: '...',
  realtime: '...',
  layer_arn: '...',
})
```

## ServerConfig

| Property    | Type               | Required | Description                                                    |
| ----------- | ------------------ | -------- | -------------------------------------------------------------- |
| `region`    | `string`           | Yes      | AWS region (e.g. `us-east-1`)                                  |
| `http`      | `string`           | Yes      | AppSync HTTP host (e.g. `xxx.appsync-api.us-east-1.amazonaws.com`) |
| `realtime`  | `string`           | Yes      | AppSync realtime host (e.g. `xxx.appsync-realtime-api.us-east-1.amazonaws.com`) |
| `layer_arn` | `string`           | Yes      | ARN of the deployed LiveLambda layer                           |
| `profile`   | `string`           | No       | AWS CLI profile name for credential resolution                 |
| `display`   | `TerminalDisplay`  | No       | Custom display implementation. Omit for pino JSON logging.     |

## TerminalDisplay Interface

The `TerminalDisplay` interface defines the contract for all display implementations. Implement this to build a completely custom display.

```typescript
interface TerminalDisplay {
  /** Start tracking a long-running operation (shows spinner) */
  start_operation(label: string): void

  /** Rename an in-progress operation */
  update_operation(old_label: string, new_label: string): void

  /** Mark an operation as successfully completed */
  complete_operation(label: string): void

  /** Mark an operation as failed */
  fail_operation(label: string, message?: string): void

  /** Display an informational message */
  info(message: string): void

  /** Display a warning message */
  warn(message: string): void

  /** Display an error message */
  error(message: string): void

  /** Write a raw line of text (used for request result summaries) */
  line(message: string): void

  /** Write a key-value output pair (used for stack outputs, URLs, etc.) */
  output(key: string, value: string): void

  /** Pause rendering (used during handler execution to capture console output) */
  pause(): void

  /** Resume rendering (flushes lines accumulated during pause) */
  resume(): void

  /** Stop the display entirely and clean up resources */
  stop(): void
}
```

### Method lifecycle during a request

When a Lambda invocation is proxied, the display methods are called in this order:

1. `start_operation("Processing WebLambda → POST /tasks")` — spinner starts
2. `update_operation(...)` — label may update as handler details are resolved
3. `pause()` — console output capture begins
4. Handler's `console.log/warn/error` calls are intercepted and forwarded as `line()` calls
5. `resume()` — console capture ends, buffered lines flush
6. `complete_operation(...)` or `fail_operation(...)` — spinner stops
7. `line(...)` — formatted result summary with status code and timing
8. `line('')` — blank line for visual separation between requests

### Display behavior when omitted

When `display` is not provided in `ServerConfig`:
- The AppSync WebSocket client runs in debug mode (full pino JSON logging)
- Handler console output goes to stdout/stderr normally
- No spinner or formatted request tracking

## SpinnerDisplay

`SpinnerDisplay` is the built-in display that renders an animated Braille spinner to stderr with ANSI colors. It handles:

- Animated spinner frames while operations are in progress
- Automatic elapsed time tracking per operation
- Pause/resume buffering during handler execution
- TTY detection (spinner only renders when connected to a terminal)

### Constructor

```typescript
const display = new SpinnerDisplay()              // writes to process.stderr
const display = new SpinnerDisplay(custom_stream)  // writes to a custom stream
```

### Extending SpinnerDisplay

All internal properties and methods are `protected`, so you can subclass `SpinnerDisplay` to customize any aspect of its behavior.

#### Example: Custom line formatting

```typescript
import { SpinnerDisplay } from 'live-lambda'

class VerboseDisplay extends SpinnerDisplay {
  line(message: string): void {
    const timestamp = new Date().toISOString()
    super.line(`[${timestamp}] ${message}`)
  }
}
```

#### Example: Override spinner rendering

```typescript
import { SpinnerDisplay } from 'live-lambda'

const CUSTOM_FRAMES = ['|', '/', '-', '\\']

class CustomSpinnerDisplay extends SpinnerDisplay {
  protected render_spinner(): void {
    if (this.active.size === 0) return

    const frame = CUSTOM_FRAMES[this.frame_index % CUSTOM_FRAMES.length]
    this.frame_index++
    const text = this.build_status_text()

    if (this.stream.isTTY) {
      this.stream.write(`\r\x1b[K${frame} ${text}`)
      this.has_spinner_line = true
    }
  }
}
```

#### Example: Add file logging alongside terminal output

```typescript
import { SpinnerDisplay } from 'live-lambda'
import { appendFileSync } from 'node:fs'

class LoggingDisplay extends SpinnerDisplay {
  private log_path: string

  constructor(log_path: string) {
    super()
    this.log_path = log_path
  }

  line(message: string): void {
    super.line(message)
    if (message.trim()) {
      appendFileSync(this.log_path, `${new Date().toISOString()} ${message}\n`)
    }
  }

  error(message: string): void {
    super.error(message)
    appendFileSync(this.log_path, `${new Date().toISOString()} ERROR: ${message}\n`)
  }
}
```

### Protected members reference

| Member                | Type                                         | Description                                            |
| --------------------- | -------------------------------------------- | ------------------------------------------------------ |
| `stream`              | `NodeJS.WriteStream`                         | Output stream (default: `process.stderr`)              |
| `active`              | `Map<string, { start: number }>`             | Currently active operations with start timestamps      |
| `pending_renders`     | `string[]`                                   | Lines buffered during pause                            |
| `frame_index`         | `number`                                     | Current animation frame counter                        |
| `interval`            | `ReturnType<typeof setInterval> \| null`     | Spinner animation interval                             |
| `paused`              | `boolean`                                    | Whether rendering is currently paused                  |
| `has_spinner_line`    | `boolean`                                    | Whether a spinner line is currently on screen           |
| `ensure_spinning()`   | `void`                                       | Start the spinner interval if not already running      |
| `stop_spinning()`     | `void`                                       | Stop the spinner interval and clear the spinner line   |
| `update_spinner_state()` | `void`                                    | Check if spinner should start/stop based on active ops |
| `render_spinner()`    | `void`                                       | Render one animation frame                             |
| `build_status_text()` | `string`                                     | Build the text shown next to the spinner               |
| `write_permanent(text)` | `void`                                     | Clear spinner, write a permanent line, restart spinner |
| `clear_spinner()`     | `void`                                       | Erase the current spinner line from the terminal       |

## Implementing TerminalDisplay from scratch

For a fully custom display (not based on SpinnerDisplay), implement all methods:

```typescript
import type { TerminalDisplay } from 'live-lambda'

class MinimalDisplay implements TerminalDisplay {
  start_operation(label: string): void {
    console.log(`[START] ${label}`)
  }

  update_operation(old_label: string, new_label: string): void {
    console.log(`[UPDATE] ${old_label} -> ${new_label}`)
  }

  complete_operation(label: string): void {
    console.log(`[DONE] ${label}`)
  }

  fail_operation(label: string, message?: string): void {
    console.error(`[FAIL] ${label}${message ? `: ${message}` : ''}`)
  }

  info(message: string): void { console.log(message) }
  warn(message: string): void { console.warn(message) }
  error(message: string): void { console.error(message) }
  line(message: string): void { console.log(message) }
  output(key: string, value: string): void { console.log(`  ${key}: ${value}`) }

  pause(): void { /* no-op */ }
  resume(): void { /* no-op */ }
  stop(): void { /* no-op */ }
}
```

## Integration with CDK apps

A typical consuming application uses both the CDK construct and the programmatic server API:

```typescript
// infrastructure (app.ts)
import { LiveLambda } from 'live-lambda'

const app = new cdk.App()
LiveLambda.install(app, { env, skip_layer: false })
// ... your stacks ...

// development server (dev.ts)
import { serve, SpinnerDisplay } from 'live-lambda'

// Read these from CDK outputs or environment variables
const config = {
  region: process.env.AWS_REGION!,
  http: process.env.APPSYNC_HTTP_ENDPOINT!,
  realtime: process.env.APPSYNC_REALTIME_ENDPOINT!,
  layer_arn: process.env.LIVE_LAMBDA_LAYER_ARN!,
  profile: process.env.AWS_PROFILE,
  display: new SpinnerDisplay(),
}

await serve(config)
```

This gives you full control over how and when the server starts, what display is used, and how configuration is resolved — without using the `live-lambda` CLI at all.
