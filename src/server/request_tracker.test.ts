import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RequestTracker, short_function_name } from './request_tracker.js'
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
    line: vi.fn(),
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

    expect(display.complete_operation).toHaveBeenCalled()
    expect(display.line).toHaveBeenCalledWith(
      expect.stringContaining('WebLambda → POST /tasks')
    )
    expect(display.line).toHaveBeenCalledWith(
      expect.stringContaining('200')
    )
  })

  it('should complete without status code', () => {
    const tracker = new RequestTracker(display, {
      function_name: 'StreamLambda',
      event_label: 'DynamoDB Stream'
    })
    tracker.complete()

    expect(display.line).toHaveBeenCalledWith(
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

    expect(display.line).toHaveBeenCalledWith('  ↳ src/code/web.handler.ts → handler')
    expect(display.line).toHaveBeenCalledWith('  ↳ Role: some-role-arn')
  })

  it('should NOT emit detail lines when not verbose', () => {
    const tracker = new RequestTracker(display, {
      function_name: 'WebLambda',
      event_label: 'POST /tasks',
      verbose: false
    })
    tracker.detail('src/code/web.handler.ts → handler')
    tracker.complete(200)

    // line is called for the result line + trailing blank line, but NOT for details
    expect(display.line).toHaveBeenCalledTimes(2)
  })

  it('should fail with error message', () => {
    const tracker = new RequestTracker(display, {
      function_name: 'WebLambda',
      event_label: 'POST /tasks'
    })
    tracker.fail(new Error('Cannot read property'))

    expect(display.fail_operation).toHaveBeenCalled()
    expect(display.line).toHaveBeenCalledWith(
      expect.stringContaining('WebLambda → POST /tasks')
    )
  })

  it('should fail with string error', () => {
    const tracker = new RequestTracker(display, {
      function_name: 'WebLambda',
      event_label: 'POST /tasks'
    })
    tracker.fail('something went wrong')

    expect(display.line).toHaveBeenCalledWith(
      expect.stringContaining('something went wrong')
    )
  })

  it('should emit trailing blank line after complete for visual separation', () => {
    const tracker = new RequestTracker(display, {
      function_name: 'WebLambda',
      event_label: 'POST /tasks'
    })
    tracker.complete(200)

    const last_call = display.line.mock.calls[display.line.mock.calls.length - 1]
    expect(last_call[0]).toBe('')
  })

  it('should emit trailing blank line after fail for visual separation', () => {
    const tracker = new RequestTracker(display, {
      function_name: 'WebLambda',
      event_label: 'POST /tasks'
    })
    tracker.fail(new Error('boom'))

    const last_call = display.line.mock.calls[display.line.mock.calls.length - 1]
    expect(last_call[0]).toBe('')
  })

  it('should include elapsed time in complete line', async () => {
    const tracker = new RequestTracker(display, {
      function_name: 'WebLambda',
      event_label: 'POST /tasks'
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    tracker.complete(200)

    const line_call = display.line.mock.calls[0][0] as string
    expect(line_call).toMatch(/\d+ms/)
  })

  describe('color_status branches', () => {
    const GREEN = '\x1b[32m'
    const RED = '\x1b[31m'
    const RESET = '\x1b[0m'

    it('should color 200 status green', () => {
      const tracker = new RequestTracker(display, {
        function_name: 'WebLambda',
        event_label: 'GET /health'
      })
      tracker.complete(200)

      const line_call = display.line.mock.calls[0][0] as string
      expect(line_call).toContain(`${GREEN}200${RESET}`)
    })

    it('should color 201 status green', () => {
      const tracker = new RequestTracker(display, {
        function_name: 'WebLambda',
        event_label: 'POST /items'
      })
      tracker.complete(201)

      const line_call = display.line.mock.calls[0][0] as string
      expect(line_call).toContain(`${GREEN}201${RESET}`)
    })

    it('should color 204 status green', () => {
      const tracker = new RequestTracker(display, {
        function_name: 'WebLambda',
        event_label: 'DELETE /items/1'
      })
      tracker.complete(204)

      const line_call = display.line.mock.calls[0][0] as string
      expect(line_call).toContain(`${GREEN}204${RESET}`)
    })

    it('should color 400 status red', () => {
      const tracker = new RequestTracker(display, {
        function_name: 'WebLambda',
        event_label: 'POST /items'
      })
      tracker.complete(400)

      const line_call = display.line.mock.calls[0][0] as string
      expect(line_call).toContain(`${RED}400${RESET}`)
    })

    it('should color 404 status red', () => {
      const tracker = new RequestTracker(display, {
        function_name: 'WebLambda',
        event_label: 'GET /missing'
      })
      tracker.complete(404)

      const line_call = display.line.mock.calls[0][0] as string
      expect(line_call).toContain(`${RED}404${RESET}`)
    })

    it('should color 500 status red', () => {
      const tracker = new RequestTracker(display, {
        function_name: 'WebLambda',
        event_label: 'GET /crash'
      })
      tracker.complete(500)

      const line_call = display.line.mock.calls[0][0] as string
      expect(line_call).toContain(`${RED}500${RESET}`)
    })

    it('should NOT color 301 redirect status', () => {
      const tracker = new RequestTracker(display, {
        function_name: 'WebLambda',
        event_label: 'GET /old-path'
      })
      tracker.complete(301)

      const line_call = display.line.mock.calls[0][0] as string
      // Should contain raw "301" without GREEN or RED wrapping
      expect(line_call).toContain('301')
      expect(line_call).not.toContain(`${GREEN}301${RESET}`)
      expect(line_call).not.toContain(`${RED}301${RESET}`)
    })

    it('should NOT color 302 redirect status', () => {
      const tracker = new RequestTracker(display, {
        function_name: 'WebLambda',
        event_label: 'GET /redirect'
      })
      tracker.complete(302)

      const line_call = display.line.mock.calls[0][0] as string
      expect(line_call).toContain('302')
      expect(line_call).not.toContain(`${GREEN}302${RESET}`)
      expect(line_call).not.toContain(`${RED}302${RESET}`)
    })
  })

  describe('verbose details on fail', () => {
    it('should emit detail lines after error line when verbose is true', () => {
      const tracker = new RequestTracker(display, {
        function_name: 'WebLambda',
        event_label: 'POST /tasks',
        verbose: true
      })
      tracker.detail('Handler: src/handlers/web.ts')
      tracker.detail('Role: arn:aws:iam::123:role/MyRole')
      tracker.fail(new Error('Handler threw'))

      // fail emits: result line, error message line, detail lines, blank line
      expect(display.line).toHaveBeenCalledWith('  ↳ Handler: src/handlers/web.ts')
      expect(display.line).toHaveBeenCalledWith('  ↳ Role: arn:aws:iam::123:role/MyRole')
    })

    it('should NOT emit detail lines on fail when verbose is false', () => {
      const tracker = new RequestTracker(display, {
        function_name: 'WebLambda',
        event_label: 'POST /tasks',
        verbose: false
      })
      tracker.detail('Handler: src/handlers/web.ts')
      tracker.fail(new Error('Handler threw'))

      // fail emits: result line, error message line, blank line = 3 calls
      // no detail lines
      expect(display.line).toHaveBeenCalledTimes(3)
    })

    it('should NOT emit detail lines on fail when verbose is not set (defaults to false)', () => {
      const tracker = new RequestTracker(display, {
        function_name: 'WebLambda',
        event_label: 'POST /tasks'
      })
      tracker.detail('Handler: src/handlers/web.ts')
      tracker.fail(new Error('Handler threw'))

      expect(display.line).toHaveBeenCalledTimes(3)
    })
  })

  describe('fail includes elapsed time', () => {
    it('should include elapsed time in fail line', async () => {
      const tracker = new RequestTracker(display, {
        function_name: 'WebLambda',
        event_label: 'POST /tasks'
      })

      await new Promise(resolve => setTimeout(resolve, 10))
      tracker.fail(new Error('timeout'))

      const line_call = display.line.mock.calls[0][0] as string
      expect(line_call).toMatch(/\d+ms/)
    })

    it('should show non-zero elapsed time in fail line', async () => {
      const tracker = new RequestTracker(display, {
        function_name: 'WebLambda',
        event_label: 'POST /tasks'
      })

      await new Promise(resolve => setTimeout(resolve, 50))
      tracker.fail('connection refused')

      const line_call = display.line.mock.calls[0][0] as string
      // Extract the number before "ms" and verify it's >= 10 (some tolerance)
      const match = line_call.match(/(\d+)ms/)
      expect(match).not.toBeNull()
      expect(Number(match![1])).toBeGreaterThanOrEqual(10)
    })
  })
})

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

  it('should return empty string as-is', () => {
    expect(short_function_name('')).toBe('')
  })

  it('should return "Function" as-is since stripping would produce empty string', () => {
    expect(short_function_name('Function')).toBe('Function')
  })

  it('should strip Function suffix from "ConstructFunction" yielding "Construct"', () => {
    // ConstructFunction matches /ConstructFunction$/ but yields empty, so falls through
    // to /Function$/ which yields "Construct" (non-empty), so returns "Construct"
    expect(short_function_name('ConstructFunction')).toBe('Construct')
  })
})
