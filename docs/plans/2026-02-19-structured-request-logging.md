# Structured Request Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace scattered logger.info() calls with progressive, spinner-integrated request display — one compact line per invocation at default verbosity, full lifecycle detail in verbose mode, handler console output intercepted to prevent spinner glitches.

**Architecture:** A `RequestTracker` class drives the SpinnerDisplay through request lifecycle phases (resolving → assuming role → loading → executing → complete/fail). Event type detection parses Lambda events into human-readable labels. Console interception patches console.log/warn/error during handler execution to route through the display system.

**Tech Stack:** TypeScript, vitest, existing SpinnerDisplay/TerminalDisplay system

---

### Task 1: Extend TerminalDisplay interface with update_operation

**Files:**
- Modify: `src/lib/display/types.ts`
- Modify: `src/lib/display/spinner_display.ts`
- Create: `src/lib/display/spinner_display.test.ts`

**Step 1: Write the failing test**

Create `src/lib/display/spinner_display.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SpinnerDisplay } from './spinner_display.js'

describe('SpinnerDisplay', () => {
  let display: SpinnerDisplay
  let stream: { write: ReturnType<typeof vi.fn>, isTTY: boolean }

  beforeEach(() => {
    stream = { write: vi.fn(), isTTY: true }
    display = new SpinnerDisplay(stream as any)
  })

  describe('update_operation', () => {
    it('should update active operation label preserving start time', () => {
      display.start_operation('Old Label')
      display.update_operation('Old Label', 'New Label')
      display.complete_operation('New Label')

      const output = stream.write.mock.calls.map((c: any[]) => c[0]).join('')
      expect(output).toContain('New Label')
      expect(output).not.toContain('Old Label')
    })

    it('should no-op when old label does not exist', () => {
      display.update_operation('Nonexistent', 'New Label')
      display.complete_operation('New Label')

      // Should not throw, complete_operation on unknown label is a no-op
      const output = stream.write.mock.calls.map((c: any[]) => c[0]).join('')
      expect(output).not.toContain('New Label')
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/sidney/boundless/live-lambda-project/live-lambda && pnpm exec vitest run src/lib/display/spinner_display.test.ts`
Expected: FAIL — `update_operation` does not exist on SpinnerDisplay

**Step 3: Add update_operation to TerminalDisplay interface**

In `src/lib/display/types.ts`, add to the interface:

```typescript
update_operation(old_label: string, new_label: string): void
```

**Step 4: Implement update_operation in SpinnerDisplay**

In `src/lib/display/spinner_display.ts`, add method:

```typescript
update_operation(old_label: string, new_label: string): void {
  const entry = this.active.get(old_label)
  if (!entry) return
  this.active.delete(old_label)
  this.active.set(new_label, entry)
}
```

**Step 5: Run test to verify it passes**

Run: `cd /Users/sidney/boundless/live-lambda-project/live-lambda && pnpm exec vitest run src/lib/display/spinner_display.test.ts`
Expected: PASS

**Step 6: Run full test suite**

Run: `cd /Users/sidney/boundless/live-lambda-project/live-lambda && pnpm test`
Expected: All 167+ tests pass

**Step 7: Commit**

```bash
git add src/lib/display/types.ts src/lib/display/spinner_display.ts src/lib/display/spinner_display.test.ts
git commit -m "feat: add update_operation to TerminalDisplay interface and SpinnerDisplay"
```

---

### Task 2: Event type detection

**Files:**
- Create: `src/server/event_detection.ts`
- Create: `src/server/event_detection.test.ts`

**Step 1: Write the failing tests**

Create `src/server/event_detection.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { detect_event_label } from './event_detection.js'

describe('detect_event_label', () => {
  it('should detect API Gateway HTTP event', () => {
    const event = {
      requestContext: {
        http: { method: 'POST', path: '/tasks' }
      }
    }
    expect(detect_event_label(event)).toBe('POST /tasks')
  })

  it('should detect API Gateway HTTP event with long path', () => {
    const event = {
      requestContext: {
        http: { method: 'GET', path: '/api/v1/users/123/tasks' }
      }
    }
    expect(detect_event_label(event)).toBe('GET /api/v1/users/123/tasks')
  })

  it('should detect SQS event', () => {
    const event = {
      Records: [{ eventSource: 'aws:sqs', body: '{}' }]
    }
    expect(detect_event_label(event)).toBe('SQS Message')
  })

  it('should detect DynamoDB Stream event', () => {
    const event = {
      Records: [{ eventSource: 'aws:dynamodb', dynamodb: {} }]
    }
    expect(detect_event_label(event)).toBe('DynamoDB Stream')
  })

  it('should detect SNS event', () => {
    const event = {
      Records: [{ Sns: { Message: 'hello' } }]
    }
    expect(detect_event_label(event)).toBe('SNS Notification')
  })

  it('should detect EventBridge event', () => {
    const event = {
      source: 'test-app',
      'detail-type': 'task.created',
      detail: {}
    }
    expect(detect_event_label(event)).toBe('EventBridge: task.created')
  })

  it('should detect S3 event', () => {
    const event = {
      Records: [{ eventSource: 'aws:s3', s3: {} }]
    }
    expect(detect_event_label(event)).toBe('S3 Event')
  })

  it('should detect EventBridge Scheduler event (no Records, no requestContext)', () => {
    const event = { scheduled: true }
    expect(detect_event_label(event)).toBe('Invocation')
  })

  it('should return Invocation for unknown event shapes', () => {
    expect(detect_event_label({})).toBe('Invocation')
    expect(detect_event_label(null)).toBe('Invocation')
    expect(detect_event_label('string')).toBe('Invocation')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/sidney/boundless/live-lambda-project/live-lambda && pnpm exec vitest run src/server/event_detection.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `src/server/event_detection.ts`:

```typescript
export function detect_event_label(event: unknown): string {
  if (!event || typeof event !== 'object') return 'Invocation'

  const e = event as Record<string, any>

  // API Gateway HTTP API v2
  if (e.requestContext?.http?.method && e.requestContext?.http?.path) {
    return `${e.requestContext.http.method} ${e.requestContext.http.path}`
  }

  // Record-based events
  const record = e.Records?.[0]
  if (record) {
    if (record.eventSource === 'aws:sqs') return 'SQS Message'
    if (record.eventSource === 'aws:dynamodb') return 'DynamoDB Stream'
    if (record.eventSource === 'aws:s3') return 'S3 Event'
    if (record.Sns) return 'SNS Notification'
  }

  // EventBridge
  if (e.source && e['detail-type']) {
    return `EventBridge: ${e['detail-type']}`
  }

  return 'Invocation'
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/sidney/boundless/live-lambda-project/live-lambda && pnpm exec vitest run src/server/event_detection.test.ts`
Expected: PASS — all 9 tests

**Step 5: Commit**

```bash
git add src/server/event_detection.ts src/server/event_detection.test.ts
git commit -m "feat: add Lambda event type detection for display labels"
```

---

### Task 3: Console interceptor

**Files:**
- Create: `src/server/console_interceptor.ts`
- Create: `src/server/console_interceptor.test.ts`

**Step 1: Write the failing tests**

Create `src/server/console_interceptor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { with_console_intercept } from './console_interceptor.js'
import type { TerminalDisplay } from '../lib/display/types.js'

describe('with_console_intercept', () => {
  let display: TerminalDisplay
  let info_calls: string[]
  let warn_calls: string[]
  let error_calls: string[]

  beforeEach(() => {
    info_calls = []
    warn_calls = []
    error_calls = []
    display = {
      start_operation: vi.fn(),
      complete_operation: vi.fn(),
      fail_operation: vi.fn(),
      update_operation: vi.fn(),
      info: vi.fn((msg: string) => info_calls.push(msg)),
      warn: vi.fn((msg: string) => warn_calls.push(msg)),
      error: vi.fn((msg: string) => error_calls.push(msg)),
      output: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn()
    }
  })

  it('should route console.log to display.info during execution', async () => {
    await with_console_intercept(display, async () => {
      console.log('hello from handler')
    })
    expect(info_calls).toContain('hello from handler')
  })

  it('should route console.warn to display.warn during execution', async () => {
    await with_console_intercept(display, async () => {
      console.warn('warning from handler')
    })
    expect(warn_calls).toContain('warning from handler')
  })

  it('should route console.error to display.error during execution', async () => {
    await with_console_intercept(display, async () => {
      console.error('error from handler')
    })
    expect(error_calls).toContain('error from handler')
  })

  it('should restore original console methods after execution', async () => {
    const original_log = console.log
    await with_console_intercept(display, async () => {})
    expect(console.log).toBe(original_log)
  })

  it('should restore console methods even if fn throws', async () => {
    const original_log = console.log
    await expect(
      with_console_intercept(display, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(console.log).toBe(original_log)
  })

  it('should return the result of the wrapped function', async () => {
    const result = await with_console_intercept(display, async () => 42)
    expect(result).toBe(42)
  })

  it('should handle multiple arguments by joining with space', async () => {
    await with_console_intercept(display, async () => {
      console.log('count:', 3, 'items')
    })
    expect(info_calls).toContain('count: 3 items')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/sidney/boundless/live-lambda-project/live-lambda && pnpm exec vitest run src/server/console_interceptor.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `src/server/console_interceptor.ts`:

```typescript
import type { TerminalDisplay } from '../lib/display/types.js'

export async function with_console_intercept<T>(
  display: TerminalDisplay,
  fn: () => Promise<T>
): Promise<T> {
  const original_log = console.log
  const original_warn = console.warn
  const original_error = console.error

  const format = (...args: unknown[]) =>
    args.map(a => typeof a === 'string' ? a : String(a)).join(' ')

  console.log = (...args: unknown[]) => display.info(format(...args))
  console.warn = (...args: unknown[]) => display.warn(format(...args))
  console.error = (...args: unknown[]) => display.error(format(...args))

  try {
    return await fn()
  } finally {
    console.log = original_log
    console.warn = original_warn
    console.error = original_error
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/sidney/boundless/live-lambda-project/live-lambda && pnpm exec vitest run src/server/console_interceptor.test.ts`
Expected: PASS — all 7 tests

**Step 5: Commit**

```bash
git add src/server/console_interceptor.ts src/server/console_interceptor.test.ts
git commit -m "feat: add console interceptor to route handler output through display"
```

---

### Task 4: RequestTracker class

**Files:**
- Create: `src/server/request_tracker.ts`
- Create: `src/server/request_tracker.test.ts`

**Step 1: Write the failing tests**

Create `src/server/request_tracker.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RequestTracker } from './request_tracker.js'
import type { TerminalDisplay } from '../lib/display/types.js'

function make_display() {
  return {
    start_operation: vi.fn(),
    complete_operation: vi.fn(),
    fail_operation: vi.fn(),
    update_operation: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    output: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn()
  } satisfies TerminalDisplay
}

describe('RequestTracker', () => {
  let display: ReturnType<typeof make_display>

  beforeEach(() => {
    display = make_display()
  })

  it('should start a spinner operation on creation', () => {
    new RequestTracker(display, {
      function_name: 'WebLambda',
      event_label: 'POST /tasks'
    })
    expect(display.start_operation).toHaveBeenCalledWith('WebLambda → POST /tasks')
  })

  it('should update spinner phase via update_operation', () => {
    const tracker = new RequestTracker(display, {
      function_name: 'WebLambda',
      event_label: 'POST /tasks'
    })
    tracker.phase('assuming role')
    expect(display.update_operation).toHaveBeenCalledWith(
      'WebLambda → POST /tasks',
      'WebLambda → POST /tasks (assuming role...)'
    )
  })

  it('should chain phases updating from previous label', () => {
    const tracker = new RequestTracker(display, {
      function_name: 'WebLambda',
      event_label: 'POST /tasks'
    })
    tracker.phase('assuming role')
    tracker.phase('loading handler')
    expect(display.update_operation).toHaveBeenLastCalledWith(
      'WebLambda → POST /tasks (assuming role...)',
      'WebLambda → POST /tasks (loading handler...)'
    )
  })

  it('should complete with formatted result line', () => {
    const tracker = new RequestTracker(display, {
      function_name: 'WebLambda',
      event_label: 'POST /tasks'
    })
    tracker.complete(200)

    // Should remove the spinner operation
    expect(display.complete_operation).toHaveBeenCalled()
    // Should write the result line
    expect(display.info).toHaveBeenCalledWith(
      expect.stringContaining('WebLambda → POST /tasks')
    )
    expect(display.info).toHaveBeenCalledWith(
      expect.stringContaining('200')
    )
  })

  it('should complete without status code', () => {
    const tracker = new RequestTracker(display, {
      function_name: 'StreamLambda',
      event_label: 'DynamoDB Stream'
    })
    tracker.complete()

    expect(display.info).toHaveBeenCalledWith(
      expect.stringContaining('StreamLambda → DynamoDB Stream')
    )
  })

  it('should collect and emit detail lines on complete when verbose', () => {
    const tracker = new RequestTracker(display, {
      function_name: 'WebLambda',
      event_label: 'POST /tasks',
      verbose: true
    })
    tracker.detail('src/code/web.handler.ts → handler')
    tracker.detail('Role: some-role-arn')
    tracker.complete(200)

    // Should output detail lines
    expect(display.output).toHaveBeenCalledWith('↳', 'src/code/web.handler.ts → handler')
    expect(display.output).toHaveBeenCalledWith('↳', 'Role: some-role-arn')
  })

  it('should NOT emit detail lines when not verbose', () => {
    const tracker = new RequestTracker(display, {
      function_name: 'WebLambda',
      event_label: 'POST /tasks',
      verbose: false
    })
    tracker.detail('src/code/web.handler.ts → handler')
    tracker.complete(200)

    expect(display.output).not.toHaveBeenCalled()
  })

  it('should fail with error message', () => {
    const tracker = new RequestTracker(display, {
      function_name: 'WebLambda',
      event_label: 'POST /tasks'
    })
    tracker.fail(new Error('Cannot read property'))

    // Should remove the spinner operation
    expect(display.fail_operation).toHaveBeenCalled()
    // Should write the error line
    expect(display.error).toHaveBeenCalledWith(
      expect.stringContaining('WebLambda → POST /tasks')
    )
  })

  it('should fail with string error', () => {
    const tracker = new RequestTracker(display, {
      function_name: 'WebLambda',
      event_label: 'POST /tasks'
    })
    tracker.fail('something went wrong')

    expect(display.error).toHaveBeenCalledWith(
      expect.stringContaining('something went wrong')
    )
  })

  it('should include elapsed time in complete line', async () => {
    const tracker = new RequestTracker(display, {
      function_name: 'WebLambda',
      event_label: 'POST /tasks'
    })

    // Small delay to ensure measurable time
    await new Promise(resolve => setTimeout(resolve, 10))
    tracker.complete(200)

    const info_call = display.info.mock.calls[0][0] as string
    // Should contain a time measurement like "12ms" or "0ms"
    expect(info_call).toMatch(/\d+ms/)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/sidney/boundless/live-lambda-project/live-lambda && pnpm exec vitest run src/server/request_tracker.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `src/server/request_tracker.ts`:

```typescript
import type { TerminalDisplay } from '../lib/display/types.js'

const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const RESET = '\x1b[0m'

export interface RequestTrackerInfo {
  function_name: string
  event_label: string
  verbose?: boolean
}

export class RequestTracker {
  private display: TerminalDisplay
  private function_name: string
  private event_label: string
  private verbose: boolean
  private details: string[] = []
  private start_time: number
  private current_label: string

  constructor(display: TerminalDisplay, info: RequestTrackerInfo) {
    this.display = display
    this.function_name = info.function_name
    this.event_label = info.event_label
    this.verbose = info.verbose ?? false
    this.start_time = Date.now()

    this.current_label = `${this.function_name} → ${this.event_label}`
    this.display.start_operation(this.current_label)
  }

  phase(description: string): void {
    const new_label = `${this.function_name} → ${this.event_label} (${description}...)`
    this.display.update_operation(this.current_label, new_label)
    this.current_label = new_label
  }

  detail(text: string): void {
    this.details.push(text)
  }

  complete(status_code?: number): void {
    // Remove the spinner
    this.display.complete_operation(this.current_label)

    const elapsed = Date.now() - this.start_time
    const status = status_code !== undefined
      ? `  ${this.color_status(status_code)}`
      : ''
    const line = `${CYAN}←${RESET} ${this.function_name} → ${this.event_label}${status}  ${DIM}${elapsed}ms${RESET}`
    this.display.info(line)

    if (this.verbose) {
      for (const d of this.details) {
        this.display.output('↳', d)
      }
    }
  }

  fail(error: Error | string): void {
    const elapsed = Date.now() - this.start_time
    const message = error instanceof Error ? error.message : error

    // Remove the spinner
    this.display.fail_operation(this.current_label)

    const line = `${RED}✖${RESET} ${this.function_name} → ${this.event_label}  ${DIM}${elapsed}ms${RESET}`
    this.display.error(line)
    this.display.error(`  ↳ ${message}`)

    if (this.verbose) {
      for (const d of this.details) {
        this.display.output('↳', d)
      }
    }
  }

  private color_status(code: number): string {
    if (code >= 200 && code < 300) return `${GREEN}${code}${RESET}`
    if (code >= 400) return `${RED}${code}${RESET}`
    return `${code}`
  }
}

/**
 * Derive a short display name from a Lambda function ARN and outputs.json prefix.
 * Given prefix like "WebLambdaConstructFunction", extract "WebLambda" by removing
 * common suffixes added by CDK constructs.
 */
export function short_function_name(prefix: string): string {
  return prefix
    .replace(/ConstructFunction$/, '')
    .replace(/Function$/, '')
    .replace(/Lambda$/, '')
    || prefix
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/sidney/boundless/live-lambda-project/live-lambda && pnpm exec vitest run src/server/request_tracker.test.ts`
Expected: PASS — all 11 tests

**Step 5: Add tests for short_function_name**

Add to `src/server/request_tracker.test.ts`:

```typescript
import { RequestTracker, short_function_name } from './request_tracker.js'

describe('short_function_name', () => {
  it('should strip ConstructFunction suffix', () => {
    expect(short_function_name('WebLambdaConstructFunction')).toBe('WebLambda')
  })

  it('should strip Function suffix', () => {
    expect(short_function_name('StreamLambdaFunction')).toBe('StreamLambda')
  })

  it('should strip Lambda suffix', () => {
    expect(short_function_name('SchedulerLambda')).toBe('Scheduler')
  })

  it('should return prefix as-is when no known suffix', () => {
    expect(short_function_name('MyHandler')).toBe('MyHandler')
  })

  it('should not return empty string', () => {
    expect(short_function_name('Lambda')).toBe('Lambda')
  })
})
```

**Step 6: Run test to verify it passes**

Run: `cd /Users/sidney/boundless/live-lambda-project/live-lambda && pnpm exec vitest run src/server/request_tracker.test.ts`
Expected: PASS — all 16 tests

**Step 7: Commit**

```bash
git add src/server/request_tracker.ts src/server/request_tracker.test.ts
git commit -m "feat: add RequestTracker for progressive request display"
```

---

### Task 5: Wire it all together — refactor runtime.ts and index.ts

**Files:**
- Modify: `src/server/runtime.ts`
- Modify: `src/server/index.ts`
- Modify: `src/server/types.ts`
- Modify: `src/cli/main.ts`
- Modify: `src/server/index.test.ts`
- Modify: `src/server/runtime.test.ts`

This is the integration task. It touches multiple files to connect the new components.

**Step 1: Extend ServerConfig to include display**

In `src/server/types.ts`, add:

```typescript
import type { TerminalDisplay } from '../lib/display/types.js'

// Add to ServerConfig:
display?: TerminalDisplay
```

**Step 2: Update runtime.ts to accept and use RequestTracker**

Key changes to `src/server/runtime.ts`:

- Import `RequestTracker` and `with_console_intercept`
- `execute_handler` accepts optional `RequestTracker`
- `execute_module_handler` accepts optional `RequestTracker`
- Replace `logger.info(...)` calls with `tracker?.phase(...)` and `tracker?.detail(...)`
- Keep `logger.debug(...)` for detailed info (always available in verbose/alt-screen)
- `resolve_handler_from_outputs` returns `display_name` (the short prefix) alongside handler info
- Wrap `handler(event, context)` in `with_console_intercept()` when display is available

Specific replacements in `execute_module_handler`:

| Current | New |
|---------|-----|
| `logger.info('Using TypeScript source for ...')` | `tracker?.phase('loading handler')` + `tracker?.detail('path → export')` |
| `logger.info('Loading TypeScript source: ...')` | (already covered by phase above) |
| `logger.info('Resolved handler for ... (compiled)')` | `tracker?.phase('loading handler')` + `tracker?.detail(...)` |

Add new tracker calls:
- Before `lambda_client.send(GetFunctionConfiguration)`: `tracker?.phase('resolving config')`
- Before `fromTemporaryCredentials()`: `tracker?.phase('assuming role')`
- After creds obtained: `tracker?.detail('Role: ' + config.Role)`
- Before esbuild.build: `tracker?.phase('transforming TypeScript')`
- After esbuild: `tracker?.detail('esbuild: Xms')`
- Before handler call: `tracker?.phase('executing')`

**Step 3: Update index.ts to create and drive RequestTracker**

Key changes to `src/server/index.ts`:

- Import `RequestTracker`, `short_function_name`, `detect_event_label`
- `serve()` reads `config.display`
- `handle_request` creates a `RequestTracker` (if display is available)
- Passes tracker to `execute_handler`
- On success: extract status code from response (if `response?.statusCode`), call `tracker.complete(status_code)`
- On error: call `tracker.fail(error)`
- Replace `logger.info('Received request...')`, `logger.info('Processing request...')`, `logger.info('Handler returned...')`, `logger.info('Published response...')` with `logger.debug(...)` — the tracker handles user-facing output

The `execute_handler` function signature changes:

```typescript
export async function execute_handler(
  event: APIGatewayProxyEventV2,
  context: LambdaContext,
  tracker?: RequestTracker
)
```

And passes `tracker` to `execute_module_handler`.

**Step 4: Update main.ts to pass display into serve config**

In `src/cli/main.ts`, in `run_dev`:

```typescript
const config = extract_server_config(deployment, stack_names)
await serve({ ...config, display })
```

**Step 5: Update existing tests**

`src/server/index.test.ts` — the mock for `execute_handler` needs to accept the optional third argument. The existing tests should pass since the tracker is optional. If any tests assert specific `logger.info` calls, update those to `logger.debug`.

`src/server/runtime.test.ts` — the mock setup may need adjustment for the new tracker parameter. Since tracker is optional and tests don't pass one, existing behavior should be preserved. Update any test expectations that check for `logger.info` calls that now become `logger.debug`.

**Step 6: Run the full test suite**

Run: `cd /Users/sidney/boundless/live-lambda-project/live-lambda && pnpm test`
Expected: All tests pass (167+ tests, likely a few more from new test files)

**Step 7: Build**

Run: `cd /Users/sidney/boundless/live-lambda-project/live-lambda && pnpm run build`
Expected: Clean build with no TypeScript errors

**Step 8: Commit**

```bash
git add src/server/runtime.ts src/server/index.ts src/server/types.ts src/cli/main.ts src/server/index.test.ts src/server/runtime.test.ts
git commit -m "feat: wire RequestTracker into server lifecycle for structured request logging"
```

---

### Task 6: Integration test with test-cdk-lambda

This is a manual verification task, not automated tests.

**Step 1: Build live-lambda**

Run: `cd /Users/sidney/boundless/live-lambda-project/live-lambda && pnpm run build`

**Step 2: Start dev server**

Run: `cd /Users/sidney/boundless/live-lambda-project/test-cdk-lambda && pnpm run dev`

Expected terminal output (deploy phase should look the same as before):
```
✔ CDK environment already bootstrapped, skipping.
⠹ Deploying test-cdk-lambda-dev-QueueStack...
✔ Deploying test-cdk-lambda-dev-QueueStack (X.Xs)
...
✔ Server ready — listening for Lambda invocations
```

**Step 3: Test HTTP endpoint**

```bash
curl -s -X POST <WebLambdaUrl>/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Test structured logging","workspace_id":"ws1"}'
```

Expected terminal output:
```
⠹ WebLambda → POST /tasks (resolving config...)
⠹ WebLambda → POST /tasks (assuming role...)
⠹ WebLambda → POST /tasks (loading handler...)
⠹ WebLambda → POST /tasks (executing...)
← WebLambda → POST /tasks  200  142ms
```

**Step 4: Test verbose mode**

Press `v` to toggle verbose, send another request, verify detail lines appear.

**Step 5: Verify handler console.log appears cleanly**

Check that any `console.log` from handler code appears indented between the spinner and the result line, not overlapping the spinner.

**Step 6: No commit needed — this is verification only**
