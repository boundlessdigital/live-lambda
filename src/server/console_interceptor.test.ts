import { describe, it, expect, vi, beforeEach } from 'vitest'
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
