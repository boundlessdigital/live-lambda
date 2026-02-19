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

    // line is called once for the result line, but NOT for details
    expect(display.line).toHaveBeenCalledTimes(1)
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
})
