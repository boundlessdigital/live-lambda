import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import type { TerminalDisplay } from '../../lib/display/index.js'
import type { IoMessage, IoRequest, ToolkitAction, IoMessageLevel, IoMessageCode } from '@aws-cdk/toolkit-lib'

// Mock the base class before importing CustomIoHost.
// vi.mock factories are hoisted, so we cannot reference external variables.
// Instead, we put vi.fn() stubs on the prototype and grab references after import.
vi.mock('@aws-cdk/toolkit-lib', () => {
  class MockNonInteractiveIoHost {
    constructor(_props?: unknown) {
      // no-op
    }
  }
  ;(MockNonInteractiveIoHost.prototype as any).notify = vi.fn().mockResolvedValue(undefined)
  ;(MockNonInteractiveIoHost.prototype as any).requestResponse = vi.fn()
  return {
    NonInteractiveIoHost: MockNonInteractiveIoHost
  }
})

vi.mock('../../lib/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import { CustomIoHost } from './iohost.js'
import { NonInteractiveIoHost } from '@aws-cdk/toolkit-lib'

// Grab references to the prototype mocks after the module is loaded
const mock_super_notify = (NonInteractiveIoHost.prototype as any).notify as Mock
const mock_super_request_response = (NonInteractiveIoHost.prototype as any).requestResponse as Mock

function create_mock_display(): TerminalDisplay & { [K in keyof TerminalDisplay]: Mock } {
  return {
    start_operation: vi.fn(),
    update_operation: vi.fn(),
    complete_operation: vi.fn(),
    fail_operation: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    line: vi.fn(),
    output: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn()
  }
}

function create_message(overrides: Partial<IoMessage<unknown>> = {}): IoMessage<unknown> {
  return {
    time: new Date(),
    level: 'info' as IoMessageLevel,
    action: 'deploy' as ToolkitAction,
    message: '',
    data: undefined,
    ...overrides
  }
}

function create_request<D = unknown, R = unknown>(
  overrides: Partial<IoRequest<D, R>> = {}
): IoRequest<D, R> {
  return {
    time: new Date(),
    level: 'info' as IoMessageLevel,
    action: 'deploy' as ToolkitAction,
    message: '',
    data: undefined as D,
    code: 'CDK_TOOLKIT_I0000' as IoMessageCode,
    defaultResponse: undefined as R,
    ...overrides
  }
}

describe('CustomIoHost', () => {
  let display: ReturnType<typeof create_mock_display>
  let host: CustomIoHost
  let mock_stream: { isTTY: boolean, write: Mock }

  beforeEach(() => {
    vi.clearAllMocks()
    // Re-set default implementations after clearAllMocks resets them
    mock_super_notify.mockResolvedValue(undefined)

    display = create_mock_display()
    mock_stream = { isTTY: true, write: vi.fn() }

    host = new CustomIoHost({ display })
    // Replace the private stream with our mock
    ;(host as any).stream = mock_stream
  })

  // ─── Constructor ───────────────────────────────────────────────────────

  describe('constructor', () => {
    it('should default verbose to false', () => {
      const h = new CustomIoHost({ display })
      expect(h.is_verbose).toBe(false)
    })

    it('should accept verbose=true', () => {
      const h = new CustomIoHost({ display, verbose: true })
      expect(h.is_verbose).toBe(true)
    })

    it('should store the display reference', () => {
      const h = new CustomIoHost({ display })
      // Verify display is used by calling a method that delegates to display
      h.cleanup()
      expect(display.stop).toHaveBeenCalled()
    })
  })

  // ─── is_verbose ────────────────────────────────────────────────────────

  describe('is_verbose', () => {
    it('should return false when constructed without verbose', () => {
      expect(host.is_verbose).toBe(false)
    })

    it('should return true when constructed with verbose=true', () => {
      const h = new CustomIoHost({ display, verbose: true })
      expect(h.is_verbose).toBe(true)
    })

    it('should reflect changes after toggle_verbose', () => {
      expect(host.is_verbose).toBe(false)
      host.toggle_verbose()
      expect(host.is_verbose).toBe(true)
      host.toggle_verbose()
      expect(host.is_verbose).toBe(false)
    })
  })

  // ─── toggle_verbose ────────────────────────────────────────────────────

  describe('toggle_verbose', () => {
    it('should pause display when going verbose', () => {
      host.toggle_verbose() // false -> true
      expect(display.pause).toHaveBeenCalledOnce()
    })

    it('should switch to alt screen when going verbose on TTY', () => {
      host.toggle_verbose()
      expect(mock_stream.write).toHaveBeenCalledWith('\x1b[?1049h\x1b[H')
    })

    it('should not write alt screen escape when not TTY', () => {
      mock_stream.isTTY = false
      host.toggle_verbose()
      expect(mock_stream.write).not.toHaveBeenCalled()
    })

    it('should replay message buffer on alt screen', async () => {
      // Buffer some messages first
      await host.notify(create_message({ message: 'line one' }))
      await host.notify(create_message({ message: 'line two' }))

      host.toggle_verbose() // false -> true

      // ALT_SCREEN_ON + two buffer lines
      const write_calls = mock_stream.write.mock.calls.map((c: unknown[]) => c[0])
      expect(write_calls).toContain('line one\n')
      expect(write_calls).toContain('line two\n')
    })

    it('should not replay buffer when not TTY', async () => {
      mock_stream.isTTY = false
      await host.notify(create_message({ message: 'buffered' }))

      host.toggle_verbose()

      expect(mock_stream.write).not.toHaveBeenCalled()
    })

    it('should switch off alt screen when going non-verbose on TTY', () => {
      host.toggle_verbose() // false -> true
      mock_stream.write.mockClear()

      host.toggle_verbose() // true -> false
      expect(mock_stream.write).toHaveBeenCalledWith('\x1b[?1049l')
    })

    it('should resume display when going non-verbose', () => {
      host.toggle_verbose() // false -> true
      host.toggle_verbose() // true -> false
      expect(display.resume).toHaveBeenCalledOnce()
    })

    it('should not write alt screen off when going non-verbose on non-TTY', () => {
      mock_stream.isTTY = false
      host.toggle_verbose() // false -> true
      host.toggle_verbose() // true -> false
      expect(mock_stream.write).not.toHaveBeenCalled()
    })
  })

  // ─── notify ────────────────────────────────────────────────────────────

  describe('notify', () => {
    it('should buffer all messages', async () => {
      await host.notify(create_message({ message: 'msg1' }))
      await host.notify(create_message({ message: 'msg2' }))

      const buffer = (host as any).message_buffer as string[]
      expect(buffer).toEqual(['msg1', 'msg2'])
    })

    it('should call super.notify when verbose', async () => {
      const verbose_host = new CustomIoHost({ display, verbose: true })
      ;(verbose_host as any).stream = mock_stream

      const msg = create_message({ message: 'test' })
      await verbose_host.notify(msg)

      expect(mock_super_notify).toHaveBeenCalledWith(msg)
    })

    it('should not call super.notify when not verbose', async () => {
      const msg = create_message({ message: 'test' })
      await host.notify(msg)

      expect(mock_super_notify).not.toHaveBeenCalled()
    })

    // ─── Error routing ──────────────────────────────────

    it('should route error messages to display.error()', async () => {
      await host.notify(create_message({
        level: 'error',
        message: 'Something went wrong'
      }))

      expect(display.error).toHaveBeenCalledWith('Something went wrong')
    })

    it('should not route error messages to other display methods', async () => {
      await host.notify(create_message({
        level: 'error',
        message: 'Error msg'
      }))

      expect(display.warn).not.toHaveBeenCalled()
      expect(display.start_operation).not.toHaveBeenCalled()
      expect(display.complete_operation).not.toHaveBeenCalled()
    })

    // ─── Warning routing ────────────────────────────────

    it('should route warn messages to display.warn()', async () => {
      await host.notify(create_message({
        level: 'warn',
        message: 'Careful here'
      }))

      expect(display.warn).toHaveBeenCalledWith('Careful here')
    })

    it('should not route warn messages to other display methods', async () => {
      await host.notify(create_message({
        level: 'warn',
        message: 'Warning msg'
      }))

      expect(display.error).not.toHaveBeenCalled()
      expect(display.start_operation).not.toHaveBeenCalled()
    })

    // ─── Deploying detection ────────────────────────────

    it('should detect deploying pattern and call start_operation with Deploying prefix', async () => {
      await host.notify(create_message({
        message: 'MyStack: deploying... [1/3]',
        action: 'deploy'
      }))

      expect(display.start_operation).toHaveBeenCalledWith('Deploying MyStack')
    })

    it('should detect deploying pattern with deploy action and use Deploying prefix', async () => {
      await host.notify(create_message({
        message: 'MyStack: deploying... [2/5]',
        action: 'deploy'
      }))

      expect(display.start_operation).toHaveBeenCalledWith('Deploying MyStack')
    })

    it('should detect deploying pattern with destroy action and use Destroying prefix', async () => {
      await host.notify(create_message({
        message: 'MyStack: deploying... [1/2]',
        action: 'destroy'
      }))

      expect(display.start_operation).toHaveBeenCalledWith('Destroying MyStack')
    })

    it('should track deploying stacks for later completion', async () => {
      await host.notify(create_message({
        message: 'TestStack: deploying... [1/1]',
        action: 'deploy'
      }))

      const deploying = (host as any).deploying_stacks as Map<string, string>
      expect(deploying.get('TestStack')).toBe('Deploying TestStack')
    })

    // ─── Success (checkmark) detection ──────────────────

    it('should detect success pattern and call complete_operation for known stack', async () => {
      // First deploy
      await host.notify(create_message({
        message: 'MyStack: deploying... [1/1]',
        action: 'deploy'
      }))

      display.start_operation.mockClear()

      // Then success
      await host.notify(create_message({
        message: ' \u2705  MyStack'
      }))

      expect(display.complete_operation).toHaveBeenCalledWith('Deploying MyStack')
    })

    it('should remove stack from deploying_stacks after completion', async () => {
      await host.notify(create_message({
        message: 'MyStack: deploying... [1/1]',
        action: 'deploy'
      }))
      await host.notify(create_message({
        message: ' \u2705  MyStack'
      }))

      const deploying = (host as any).deploying_stacks as Map<string, string>
      expect(deploying.has('MyStack')).toBe(false)
    })

    it('should detect success for unknown stack (no prior deploying message)', async () => {
      await host.notify(create_message({
        message: ' \u2705  BootstrapStack'
      }))

      expect(display.complete_operation).toHaveBeenCalledWith('BootstrapStack')
    })

    it('should detect success with "(no changes)" suffix', async () => {
      await host.notify(create_message({
        message: ' \u2705  MyStack (no changes)'
      }))

      expect(display.complete_operation).toHaveBeenCalledWith('MyStack')
    })

    // ─── Failure (cross mark) detection ─────────────────

    it('should detect failure pattern and call fail_operation for known stack', async () => {
      await host.notify(create_message({
        message: 'FailStack: deploying... [1/1]',
        action: 'deploy'
      }))
      await host.notify(create_message({
        message: '\u274c FailStack'
      }))

      expect(display.fail_operation).toHaveBeenCalledWith('Deploying FailStack', '\u274c FailStack')
    })

    it('should detect failure for unknown stack', async () => {
      await host.notify(create_message({
        message: '\u274c UnknownStack'
      }))

      expect(display.fail_operation).toHaveBeenCalledWith('UnknownStack', '\u274c UnknownStack')
    })

    it('should remove stack from deploying_stacks after failure', async () => {
      await host.notify(create_message({
        message: 'FailStack: deploying... [1/1]',
        action: 'deploy'
      }))
      await host.notify(create_message({
        message: '\u274c FailStack'
      }))

      const deploying = (host as any).deploying_stacks as Map<string, string>
      expect(deploying.has('FailStack')).toBe(false)
    })

    // ─── Output routing ─────────────────────────────────

    it('should show LiveLambda outputs via display.output()', async () => {
      await host.notify(create_message({
        level: 'result',
        message: 'LiveLambdaStack.EventApiEndpoint = https://example.com/graphql'
      }))

      expect(display.output).toHaveBeenCalledWith('EventApiEndpoint', 'https://example.com/graphql')
    })

    it('should show EventApi outputs via display.output()', async () => {
      await host.notify(create_message({
        level: 'result',
        message: 'AppSyncStack.EventApiId = abc123def'
      }))

      expect(display.output).toHaveBeenCalledWith('EventApiId', 'abc123def')
    })

    it('should extract the last segment of dotted key for display', async () => {
      await host.notify(create_message({
        level: 'result',
        message: 'some.nested.LiveLambdaKey = value123'
      }))

      expect(display.output).toHaveBeenCalledWith('LiveLambdaKey', 'value123')
    })

    it('should suppress non-LiveLambda/EventApi outputs', async () => {
      await host.notify(create_message({
        level: 'result',
        message: 'SomeOtherStack.SomeOutput = some-value'
      }))

      expect(display.output).not.toHaveBeenCalled()
    })

    it('should suppress Stack ARN result lines', async () => {
      await host.notify(create_message({
        level: 'result',
        message: 'LiveLambdaStack.Stack ARN = arn:aws:cloudformation:us-east-1:123:stack/MyStack'
      }))

      // Stack ARN lines are excluded even if they contain LiveLambda
      expect(display.output).not.toHaveBeenCalled()
    })

    it('should handle output values containing equals signs', async () => {
      await host.notify(create_message({
        level: 'result',
        message: 'Stack.LiveLambdaConfig = key=val=other'
      }))

      expect(display.output).toHaveBeenCalledWith('LiveLambdaConfig', 'key=val=other')
    })

    // ─── Timing suppression ─────────────────────────────

    it('should suppress Synthesis time lines', async () => {
      await host.notify(create_message({
        level: 'result',
        message: 'Synthesis time: 3.45s'
      }))

      expect(display.info).not.toHaveBeenCalled()
      expect(display.output).not.toHaveBeenCalled()
    })

    it('should suppress Total time lines', async () => {
      await host.notify(create_message({
        level: 'result',
        message: 'Total time: 120.5s'
      }))

      expect(display.info).not.toHaveBeenCalled()
      expect(display.output).not.toHaveBeenCalled()
    })

    it('should suppress Bootstrap time lines', async () => {
      await host.notify(create_message({
        level: 'result',
        message: 'Bootstrap time: 15.2s'
      }))

      expect(display.info).not.toHaveBeenCalled()
      expect(display.output).not.toHaveBeenCalled()
    })

    // ─── CDK internals suppression ──────────────────────

    it('should suppress info-level CDK internal messages', async () => {
      await host.notify(create_message({
        level: 'info',
        message: 'Building asset abc123...'
      }))

      expect(display.info).not.toHaveBeenCalled()
      expect(display.start_operation).not.toHaveBeenCalled()
    })

    it('should suppress debug-level CDK messages', async () => {
      await host.notify(create_message({
        level: 'debug',
        message: 'some debug info'
      }))

      expect(display.info).not.toHaveBeenCalled()
    })
  })

  // ─── requestResponse ───────────────────────────────────────────────────

  describe('requestResponse', () => {
    it('should auto-approve CDK_TOOLKIT_I5060 code by returning defaultResponse', async () => {
      const request = create_request({
        code: 'CDK_TOOLKIT_I5060' as IoMessageCode,
        message: 'Do you wish to deploy these changes?',
        defaultResponse: 'approved'
      })

      const result = await host.requestResponse(request)
      expect(result).toBe('approved')
    })

    it('should not call super.requestResponse for CDK_TOOLKIT_I5060', async () => {
      const request = create_request({
        code: 'CDK_TOOLKIT_I5060' as IoMessageCode,
        message: 'Some prompt',
        defaultResponse: 'yes'
      })

      await host.requestResponse(request)
      expect(mock_super_request_response).not.toHaveBeenCalled()
    })

    it('should auto-approve messages containing "security" keyword', async () => {
      const request = create_request({
        code: 'CDK_TOOLKIT_I9999' as IoMessageCode,
        message: 'This deployment includes security-relevant changes',
        defaultResponse: 'no'
      })

      const result = await host.requestResponse(request)
      expect(result).toBe(true)
    })

    it('should auto-approve messages containing "iam" keyword', async () => {
      const request = create_request({
        code: 'CDK_TOOLKIT_I9999' as IoMessageCode,
        message: 'IAM Statement Changes detected',
        defaultResponse: 'no'
      })

      const result = await host.requestResponse(request)
      expect(result).toBe(true)
    })

    it('should auto-approve messages containing "auth" keyword', async () => {
      const request = create_request({
        code: 'CDK_TOOLKIT_I9999' as IoMessageCode,
        message: 'Changes to auth configuration detected',
        defaultResponse: 'no'
      })

      const result = await host.requestResponse(request)
      expect(result).toBe(true)
    })

    it('should auto-approve messages containing "permissions" keyword', async () => {
      const request = create_request({
        code: 'CDK_TOOLKIT_I9999' as IoMessageCode,
        message: 'Permissions boundary changes',
        defaultResponse: 'no'
      })

      const result = await host.requestResponse(request)
      expect(result).toBe(true)
    })

    it('should match security keywords case-insensitively', async () => {
      const request = create_request({
        code: 'CDK_TOOLKIT_I9999' as IoMessageCode,
        message: 'SECURITY group changes',
        defaultResponse: 'no'
      })

      const result = await host.requestResponse(request)
      expect(result).toBe(true)
    })

    it('should delegate non-matching requests to super.requestResponse', async () => {
      const expected_response = 'super-response'
      mock_super_request_response.mockResolvedValue(expected_response)

      const request = create_request({
        code: 'CDK_TOOLKIT_I1234' as IoMessageCode,
        message: 'Do you want to proceed with this change?',
        defaultResponse: 'default'
      })

      const result = await host.requestResponse(request)
      expect(mock_super_request_response).toHaveBeenCalledWith(request)
      expect(result).toBe(expected_response)
    })
  })

  // ─── cleanup ───────────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('should stop display when not verbose', () => {
      host.cleanup()
      expect(display.stop).toHaveBeenCalledOnce()
    })

    it('should not stop display when verbose', () => {
      const verbose_host = new CustomIoHost({ display, verbose: true })
      verbose_host.cleanup()
      expect(display.stop).not.toHaveBeenCalled()
    })
  })

  // ─── Edge cases and integration ────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle multiple stacks deploying and completing independently', async () => {
      await host.notify(create_message({
        message: 'StackA: deploying... [1/2]',
        action: 'deploy'
      }))
      await host.notify(create_message({
        message: 'StackB: deploying... [2/2]',
        action: 'deploy'
      }))

      expect(display.start_operation).toHaveBeenCalledTimes(2)
      expect(display.start_operation).toHaveBeenCalledWith('Deploying StackA')
      expect(display.start_operation).toHaveBeenCalledWith('Deploying StackB')

      await host.notify(create_message({ message: ' \u2705  StackB' }))
      expect(display.complete_operation).toHaveBeenCalledWith('Deploying StackB')

      await host.notify(create_message({ message: ' \u2705  StackA' }))
      expect(display.complete_operation).toHaveBeenCalledWith('Deploying StackA')
    })

    it('should route message before checking verbose for super.notify', async () => {
      // Even in non-verbose mode, route_message should be called
      await host.notify(create_message({
        level: 'error',
        message: 'an error in non-verbose mode'
      }))

      expect(display.error).toHaveBeenCalledWith('an error in non-verbose mode')
      expect(mock_super_notify).not.toHaveBeenCalled()
    })

    it('should handle result level messages without equals sign gracefully', async () => {
      // result-level message without '=' is not an output line, just suppressed
      await host.notify(create_message({
        level: 'result',
        message: 'Outputs:'
      }))

      expect(display.output).not.toHaveBeenCalled()
    })

    it('should handle failure with detailed error message', async () => {
      await host.notify(create_message({
        message: 'DeployStack: deploying... [1/1]',
        action: 'deploy'
      }))

      const failure_text = '\u274c DeployStack failed: CREATE_FAILED - Resource handler returned error'
      await host.notify(create_message({
        message: failure_text
      }))

      expect(display.fail_operation).toHaveBeenCalledWith('Deploying DeployStack', failure_text)
    })
  })
})
