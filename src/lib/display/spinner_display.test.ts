import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SpinnerDisplay } from './spinner_display.js'

const YELLOW = '\x1b[33m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

function make_stream(is_tty = true) {
  return { write: vi.fn(), isTTY: is_tty } as {
    write: ReturnType<typeof vi.fn>
    isTTY: boolean
  }
}

function get_writes(stream: { write: ReturnType<typeof vi.fn> }): string[] {
  return stream.write.mock.calls.map((c: any[]) => c[0])
}

describe('SpinnerDisplay', () => {
  let display: SpinnerDisplay
  let stream: ReturnType<typeof make_stream>

  beforeEach(() => {
    vi.useFakeTimers()
    stream = make_stream(true)
    display = new SpinnerDisplay(stream as any)
  })

  afterEach(() => {
    display.stop()
    vi.useRealTimers()
  })

  // ---------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------
  describe('constructor', () => {
    it('should use process.stderr as default stream', () => {
      // We can verify by constructing without argument - it shouldn't throw
      const default_display = new SpinnerDisplay()
      default_display.stop()
    })

    it('should use a custom stream when provided', () => {
      const custom_stream = make_stream()
      const custom_display = new SpinnerDisplay(custom_stream as any)
      custom_display.info('hello')
      expect(custom_stream.write).toHaveBeenCalled()
      custom_display.stop()
    })
  })

  // ---------------------------------------------------------------
  // start_operation
  // ---------------------------------------------------------------
  describe('start_operation', () => {
    it('should start the spinner interval on TTY', () => {
      display.start_operation('Deploying')
      // The initial render_spinner call writes immediately
      expect(stream.write).toHaveBeenCalled()
      const writes = get_writes(stream)
      const spinner_write = writes.find(w => w.includes('Deploying'))
      expect(spinner_write).toBeDefined()
    })

    it('should track the operation in active map', () => {
      display.start_operation('Building')
      // Completing should produce the checkmark line, proving it was tracked
      display.complete_operation('Building')
      const writes = get_writes(stream)
      const completion = writes.find(w => w.includes(`${GREEN}\u2714${RESET}`) && w.includes('Building'))
      expect(completion).toBeDefined()
    })

    it('should render spinner frames as time advances', () => {
      display.start_operation('Loading')
      stream.write.mockClear()

      // Advance by one interval (80ms) to trigger next frame
      vi.advanceTimersByTime(80)
      expect(stream.write).toHaveBeenCalled()
      const writes = get_writes(stream)
      // Should contain the operation label in the spinner line
      const spinner_write = writes.find(w => w.includes('Loading'))
      expect(spinner_write).toBeDefined()
    })

    it('should not start spinner when paused', () => {
      display.pause()
      stream.write.mockClear()
      display.start_operation('Paused Op')

      // No spinner rendering should happen
      vi.advanceTimersByTime(200)
      const writes = get_writes(stream)
      const spinner_writes = writes.filter(w => w.includes('Paused Op'))
      expect(spinner_writes).toHaveLength(0)
    })

    it('should not start a second interval if already spinning', () => {
      display.start_operation('First')
      const writes_after_first = stream.write.mock.calls.length
      stream.write.mockClear()

      display.start_operation('Second')
      // The second start_operation should not trigger another immediate render_spinner
      // because ensure_spinning returns early when interval already exists.
      // Only the interval tick should render.
      vi.advanceTimersByTime(80)
      const writes = get_writes(stream)
      // Should contain the latest operation in status text
      const has_second = writes.some(w => w.includes('Second'))
      expect(has_second).toBe(true)
    })
  })

  // ---------------------------------------------------------------
  // update_operation
  // ---------------------------------------------------------------
  describe('update_operation', () => {
    it('should update active operation label preserving start time', () => {
      display.start_operation('Old Label')
      display.update_operation('Old Label', 'New Label')
      display.complete_operation('New Label')

      // The completion line (containing the checkmark) should reference the new label
      const writes = get_writes(stream)
      const completion_line = writes.find((w: string) => w.includes('\u2714'))
      expect(completion_line).toBeDefined()
      expect(completion_line).toContain('New Label')
      expect(completion_line).not.toContain('Old Label')
    })

    it('should no-op when old label does not exist', () => {
      display.update_operation('Nonexistent', 'New Label')

      // No operation was started, so active map should be empty
      // and no spinner or completion lines should reference the label
      const writes = get_writes(stream)
      const spinner_lines = writes.filter((w: string) => w.includes('New Label'))
      expect(spinner_lines).toHaveLength(0)
    })

    it('should preserve the start timestamp for elapsed time calculation', () => {
      vi.setSystemTime(new Date(1000))
      display.start_operation('Original')

      vi.setSystemTime(new Date(3500))
      display.update_operation('Original', 'Updated')
      display.complete_operation('Updated')

      const writes = get_writes(stream)
      const completion = writes.find(w => w.includes(`${GREEN}\u2714${RESET}`) && w.includes('Updated'))
      expect(completion).toBeDefined()
      // Elapsed should be ~2.5s
      expect(completion).toContain('2.5s')
    })

    it('should not leave the old label active after update', () => {
      display.start_operation('Old')
      display.update_operation('Old', 'New')

      // Completing old label should be a no-op (no elapsed time in output)
      stream.write.mockClear()
      display.complete_operation('Old')

      const writes = get_writes(stream)
      // Should still produce a completion line but without elapsed time since entry is gone
      const completion = writes.find(w => w.includes(`${GREEN}\u2714${RESET}`) && w.includes('Old'))
      expect(completion).toBeDefined()
      expect(completion).not.toContain('(')  // no elapsed time parenthetical
    })
  })

  // ---------------------------------------------------------------
  // complete_operation
  // ---------------------------------------------------------------
  describe('complete_operation', () => {
    it('should write a green checkmark line', () => {
      display.start_operation('Deploy')
      stream.write.mockClear()
      display.complete_operation('Deploy')

      const writes = get_writes(stream)
      const completion = writes.find(w => w.includes(`${GREEN}\u2714${RESET}`) && w.includes('Deploy'))
      expect(completion).toBeDefined()
    })

    it('should include elapsed time in completion line', () => {
      vi.setSystemTime(new Date(0))
      display.start_operation('Build')

      vi.setSystemTime(new Date(2300))
      display.complete_operation('Build')

      const writes = get_writes(stream)
      const completion = writes.find(w => w.includes(`${GREEN}\u2714${RESET}`))
      expect(completion).toContain('2.3s')
    })

    it('should remove the operation from active tracking', () => {
      display.start_operation('Task A')
      display.complete_operation('Task A')
      stream.write.mockClear()

      // Advance timers - no spinner should render since no active ops
      vi.advanceTimersByTime(200)
      const writes = get_writes(stream)
      const spinner_writes = writes.filter(w => w.includes('Task A'))
      expect(spinner_writes).toHaveLength(0)
    })

    it('should stop spinner when last operation completes', () => {
      display.start_operation('Only Task')
      stream.write.mockClear()
      display.complete_operation('Only Task')

      // Clear writes from completion, then advance time
      stream.write.mockClear()
      vi.advanceTimersByTime(200)

      // No more spinner frames should be written
      expect(stream.write).not.toHaveBeenCalled()
    })

    it('should keep spinner running when other operations remain', () => {
      display.start_operation('Task A')
      display.start_operation('Task B')
      display.complete_operation('Task A')
      stream.write.mockClear()

      vi.advanceTimersByTime(80)
      const writes = get_writes(stream)
      // Spinner should still render with Task B
      const spinner_write = writes.find(w => w.includes('Task B'))
      expect(spinner_write).toBeDefined()
    })

    it('should buffer the line when paused', () => {
      display.start_operation('Paused Task')
      display.pause()
      stream.write.mockClear()

      display.complete_operation('Paused Task')

      // Nothing written directly while paused
      expect(stream.write).not.toHaveBeenCalled()

      // Resume should flush the buffered line
      display.resume()
      const writes = get_writes(stream)
      const completion = writes.find(w => w.includes(`${GREEN}\u2714${RESET}`) && w.includes('Paused Task'))
      expect(completion).toBeDefined()
    })

    it('should handle completing a non-existent operation gracefully', () => {
      display.complete_operation('Never Started')
      const writes = get_writes(stream)
      // Should still write a completion line, just without elapsed time
      const completion = writes.find(w => w.includes(`${GREEN}\u2714${RESET}`) && w.includes('Never Started'))
      expect(completion).toBeDefined()
      expect(completion).not.toContain('(')
    })
  })

  // ---------------------------------------------------------------
  // fail_operation
  // ---------------------------------------------------------------
  describe('fail_operation', () => {
    it('should write a red cross line', () => {
      display.start_operation('Deploy')
      stream.write.mockClear()
      display.fail_operation('Deploy')

      const writes = get_writes(stream)
      const fail_line = writes.find(w => w.includes(`${RED}\u2716${RESET}`) && w.includes('Deploy'))
      expect(fail_line).toBeDefined()
    })

    it('should include the error message when provided', () => {
      display.start_operation('Build')
      stream.write.mockClear()
      display.fail_operation('Build', 'compilation failed')

      const writes = get_writes(stream)
      const fail_line = writes.find(w => w.includes(`${RED}\u2716${RESET}`))
      expect(fail_line).toContain('Build: compilation failed')
    })

    it('should use only the label when no message provided', () => {
      display.start_operation('Build')
      stream.write.mockClear()
      display.fail_operation('Build')

      const writes = get_writes(stream)
      const fail_line = writes.find(w => w.includes(`${RED}\u2716${RESET}`))
      expect(fail_line).toContain('Build')
      expect(fail_line).not.toContain(':')
    })

    it('should remove the operation from active tracking', () => {
      display.start_operation('Task')
      display.fail_operation('Task')
      stream.write.mockClear()

      vi.advanceTimersByTime(200)
      // No spinner frames expected
      const writes = get_writes(stream)
      const spinner_writes = writes.filter(w => w.includes('Task'))
      expect(spinner_writes).toHaveLength(0)
    })

    it('should stop spinner when last operation fails', () => {
      display.start_operation('Only Task')
      display.fail_operation('Only Task')
      stream.write.mockClear()

      vi.advanceTimersByTime(200)
      expect(stream.write).not.toHaveBeenCalled()
    })

    it('should buffer the line when paused', () => {
      display.start_operation('Task')
      display.pause()
      stream.write.mockClear()

      display.fail_operation('Task', 'timeout')

      expect(stream.write).not.toHaveBeenCalled()

      display.resume()
      const writes = get_writes(stream)
      const fail_line = writes.find(w => w.includes(`${RED}\u2716${RESET}`) && w.includes('timeout'))
      expect(fail_line).toBeDefined()
    })
  })

  // ---------------------------------------------------------------
  // info
  // ---------------------------------------------------------------
  describe('info', () => {
    it('should write with dim info icon prefix', () => {
      display.info('some information')
      const writes = get_writes(stream)
      const info_line = writes.find(w => w.includes(`${DIM}\u2139${RESET}`) && w.includes('some information'))
      expect(info_line).toBeDefined()
    })

    it('should write with newline', () => {
      display.info('msg')
      const writes = get_writes(stream)
      const info_write = writes.find(w => w.includes('\u2139'))
      expect(info_write).toMatch(/\n$/)
    })

    it('should buffer when paused', () => {
      display.pause()
      stream.write.mockClear()

      display.info('buffered info')
      expect(stream.write).not.toHaveBeenCalled()

      display.resume()
      const writes = get_writes(stream)
      const info_line = writes.find(w => w.includes('buffered info'))
      expect(info_line).toBeDefined()
    })
  })

  // ---------------------------------------------------------------
  // warn
  // ---------------------------------------------------------------
  describe('warn', () => {
    it('should write with yellow warning icon prefix', () => {
      display.warn('something risky')
      const writes = get_writes(stream)
      const warn_line = writes.find(w => w.includes(`${YELLOW}\u26A0${RESET}`) && w.includes('something risky'))
      expect(warn_line).toBeDefined()
    })

    it('should buffer when paused', () => {
      display.pause()
      stream.write.mockClear()

      display.warn('buffered warning')
      expect(stream.write).not.toHaveBeenCalled()

      display.resume()
      const writes = get_writes(stream)
      const warn_line = writes.find(w => w.includes('buffered warning'))
      expect(warn_line).toBeDefined()
    })
  })

  // ---------------------------------------------------------------
  // error
  // ---------------------------------------------------------------
  describe('error', () => {
    it('should write with red cross icon prefix', () => {
      display.error('something broke')
      const writes = get_writes(stream)
      const error_line = writes.find(w => w.includes(`${RED}\u2716${RESET}`) && w.includes('something broke'))
      expect(error_line).toBeDefined()
    })

    it('should buffer when paused', () => {
      display.pause()
      stream.write.mockClear()

      display.error('buffered error')
      expect(stream.write).not.toHaveBeenCalled()

      display.resume()
      const writes = get_writes(stream)
      const error_line = writes.find(w => w.includes('buffered error'))
      expect(error_line).toBeDefined()
    })
  })

  // ---------------------------------------------------------------
  // line
  // ---------------------------------------------------------------
  describe('line', () => {
    it('should write raw text with newline', () => {
      display.line('raw text here')
      const writes = get_writes(stream)
      expect(writes).toContain('raw text here\n')
    })

    it('should buffer when paused', () => {
      display.pause()
      stream.write.mockClear()

      display.line('buffered line')
      expect(stream.write).not.toHaveBeenCalled()

      display.resume()
      const writes = get_writes(stream)
      expect(writes).toContain('buffered line\n')
    })
  })

  // ---------------------------------------------------------------
  // output
  // ---------------------------------------------------------------
  describe('output', () => {
    it('should write key: value format with indentation', () => {
      display.output('Region', 'us-east-1')
      const writes = get_writes(stream)
      const output_line = writes.find(w => w.includes('  Region: us-east-1'))
      expect(output_line).toBeDefined()
    })

    it('should write with newline', () => {
      display.output('Key', 'Value')
      const writes = get_writes(stream)
      const output_write = writes.find(w => w.includes('Key: Value'))
      expect(output_write).toMatch(/\n$/)
    })

    it('should buffer when paused', () => {
      display.pause()
      stream.write.mockClear()

      display.output('Stack', 'MyStack')
      expect(stream.write).not.toHaveBeenCalled()

      display.resume()
      const writes = get_writes(stream)
      const output_line = writes.find(w => w.includes('  Stack: MyStack'))
      expect(output_line).toBeDefined()
    })
  })

  // ---------------------------------------------------------------
  // pause
  // ---------------------------------------------------------------
  describe('pause', () => {
    it('should stop the spinner interval', () => {
      display.start_operation('Running')
      stream.write.mockClear()

      display.pause()
      stream.write.mockClear()

      vi.advanceTimersByTime(200)
      // No spinner writes while paused (only the clear_spinner call may occur during pause)
      const writes = get_writes(stream)
      const spinner_writes = writes.filter(w => w.includes('Running'))
      expect(spinner_writes).toHaveLength(0)
    })

    it('should set paused flag so new writes are buffered', () => {
      display.pause()
      stream.write.mockClear()

      display.info('after pause')
      display.warn('warning after pause')
      display.error('error after pause')

      expect(stream.write).not.toHaveBeenCalled()
    })

    it('should clear the spinner line on TTY', () => {
      display.start_operation('Task')
      stream.write.mockClear()

      display.pause()
      const writes = get_writes(stream)
      // Should write \r\x1b[K to clear the spinner line
      const clear_write = writes.find(w => w === '\r\x1b[K')
      expect(clear_write).toBeDefined()
    })
  })

  // ---------------------------------------------------------------
  // resume
  // ---------------------------------------------------------------
  describe('resume', () => {
    it('should flush all buffered lines', () => {
      display.pause()
      display.info('msg 1')
      display.warn('msg 2')
      display.error('msg 3')
      display.line('msg 4')

      stream.write.mockClear()
      display.resume()

      const writes = get_writes(stream)
      expect(writes.some(w => w.includes('msg 1'))).toBe(true)
      expect(writes.some(w => w.includes('msg 2'))).toBe(true)
      expect(writes.some(w => w.includes('msg 3'))).toBe(true)
      expect(writes.some(w => w.includes('msg 4'))).toBe(true)
    })

    it('should flush lines in order', () => {
      display.pause()
      display.line('first')
      display.line('second')
      display.line('third')

      stream.write.mockClear()
      display.resume()

      const writes = get_writes(stream)
      const first_idx = writes.findIndex(w => w.includes('first'))
      const second_idx = writes.findIndex(w => w.includes('second'))
      const third_idx = writes.findIndex(w => w.includes('third'))
      expect(first_idx).toBeLessThan(second_idx)
      expect(second_idx).toBeLessThan(third_idx)
    })

    it('should restart spinner if active operations exist', () => {
      display.start_operation('Running')
      display.pause()
      stream.write.mockClear()

      display.resume()

      // After resume, spinner should re-render. Advance to trigger interval.
      vi.advanceTimersByTime(80)
      const writes = get_writes(stream)
      const spinner_write = writes.find(w => w.includes('Running') && w.includes('\r'))
      expect(spinner_write).toBeDefined()
    })

    it('should not restart spinner if no active operations', () => {
      display.start_operation('Task')
      display.complete_operation('Task')
      display.pause()
      stream.write.mockClear()

      display.resume()
      stream.write.mockClear()

      vi.advanceTimersByTime(200)
      // No spinner should be running
      const writes = get_writes(stream)
      const spinner_writes = writes.filter(w => w.includes('\r\x1b[K'))
      expect(spinner_writes).toHaveLength(0)
    })

    it('should clear the buffer after flushing', () => {
      display.pause()
      display.info('buffered')
      display.resume()
      stream.write.mockClear()

      // Pause and resume again - nothing should flush
      display.pause()
      display.resume()
      const writes = get_writes(stream)
      const buffered_writes = writes.filter(w => w.includes('buffered'))
      expect(buffered_writes).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------
  // stop
  // ---------------------------------------------------------------
  describe('stop', () => {
    it('should stop the spinner interval', () => {
      display.start_operation('Task')
      display.stop()
      stream.write.mockClear()

      vi.advanceTimersByTime(200)
      const writes = get_writes(stream)
      const spinner_writes = writes.filter(w => w.includes('Task'))
      expect(spinner_writes).toHaveLength(0)
    })

    it('should clear active operations', () => {
      display.start_operation('A')
      display.start_operation('B')
      display.stop()
      stream.write.mockClear()

      // Completing after stop should produce no elapsed time (entry gone)
      display.complete_operation('A')
      const writes = get_writes(stream)
      const completion = writes.find(w => w.includes(`${GREEN}\u2714${RESET}`))
      expect(completion).toBeDefined()
      expect(completion).not.toContain('(')
    })

    it('should clear the pending buffer', () => {
      display.pause()
      display.info('should be discarded')
      display.stop()

      stream.write.mockClear()
      display.resume()
      const writes = get_writes(stream)
      const discarded = writes.filter(w => w.includes('should be discarded'))
      expect(discarded).toHaveLength(0)
    })

    it('should clear spinner line on TTY', () => {
      display.start_operation('Task')
      stream.write.mockClear()

      display.stop()
      const writes = get_writes(stream)
      const clear_write = writes.find(w => w === '\r\x1b[K')
      expect(clear_write).toBeDefined()
    })
  })

  // ---------------------------------------------------------------
  // Multiple concurrent operations
  // ---------------------------------------------------------------
  describe('multiple concurrent operations', () => {
    it('should show the latest operation label in spinner', () => {
      display.start_operation('First')
      display.start_operation('Second')
      display.start_operation('Third')
      stream.write.mockClear()

      vi.advanceTimersByTime(80)
      const writes = get_writes(stream)
      const spinner_write = writes.find(w => w.includes('\r'))
      expect(spinner_write).toContain('Third')
    })

    it('should show "+N more" suffix when multiple operations active', () => {
      display.start_operation('First')
      display.start_operation('Second')
      display.start_operation('Third')
      stream.write.mockClear()

      vi.advanceTimersByTime(80)
      const writes = get_writes(stream)
      const spinner_write = writes.find(w => w.includes('\r'))
      expect(spinner_write).toContain('+2 more')
    })

    it('should update count text as operations complete', () => {
      display.start_operation('A')
      display.start_operation('B')
      display.start_operation('C')

      display.complete_operation('C')
      stream.write.mockClear()

      vi.advanceTimersByTime(80)
      const writes = get_writes(stream)
      const spinner_write = writes.find(w => w.includes('\r'))
      // Now B is latest, A is the other => +1 more
      expect(spinner_write).toContain('B')
      expect(spinner_write).toContain('+1 more')
    })

    it('should not show "+N more" with single active operation', () => {
      display.start_operation('Only')
      stream.write.mockClear()

      vi.advanceTimersByTime(80)
      const writes = get_writes(stream)
      const spinner_write = writes.find(w => w.includes('\r'))
      expect(spinner_write).toContain('Only')
      expect(spinner_write).not.toContain('more')
    })

    it('should show elapsed time in seconds', () => {
      vi.setSystemTime(new Date(0))
      display.start_operation('Task')

      vi.setSystemTime(new Date(5000))
      stream.write.mockClear()
      vi.advanceTimersByTime(80)

      const writes = get_writes(stream)
      const spinner_write = writes.find(w => w.includes('Task'))
      expect(spinner_write).toContain('5s')
    })
  })

  // ---------------------------------------------------------------
  // Non-TTY behavior
  // ---------------------------------------------------------------
  describe('non-TTY stream', () => {
    let non_tty_stream: ReturnType<typeof make_stream>
    let non_tty_display: SpinnerDisplay

    beforeEach(() => {
      non_tty_stream = make_stream(false)
      non_tty_display = new SpinnerDisplay(non_tty_stream as any)
    })

    afterEach(() => {
      non_tty_display.stop()
    })

    it('should not render spinner frames', () => {
      non_tty_display.start_operation('Task')
      vi.advanceTimersByTime(500)

      const writes = get_writes(non_tty_stream)
      // No writes should contain carriage return (spinner frames use \r)
      const spinner_writes = writes.filter(w => w.startsWith('\r'))
      expect(spinner_writes).toHaveLength(0)
    })

    it('should still write permanent lines (info, warn, error, complete, fail)', () => {
      non_tty_display.info('info msg')
      non_tty_display.warn('warn msg')
      non_tty_display.error('error msg')
      non_tty_display.start_operation('Task')
      non_tty_display.complete_operation('Task')
      non_tty_display.start_operation('Task2')
      non_tty_display.fail_operation('Task2', 'oops')

      const writes = get_writes(non_tty_stream)
      expect(writes.some(w => w.includes('info msg'))).toBe(true)
      expect(writes.some(w => w.includes('warn msg'))).toBe(true)
      expect(writes.some(w => w.includes('error msg'))).toBe(true)
      expect(writes.some(w => w.includes(`${GREEN}\u2714${RESET}`))).toBe(true)
      expect(writes.some(w => w.includes(`${RED}\u2716${RESET}`))).toBe(true)
    })

    it('should not attempt to clear spinner line', () => {
      non_tty_display.start_operation('Task')
      non_tty_display.complete_operation('Task')

      const writes = get_writes(non_tty_stream)
      const clear_writes = writes.filter(w => w === '\r\x1b[K')
      expect(clear_writes).toHaveLength(0)
    })

    it('should still write line() output', () => {
      non_tty_display.line('plain text')
      const writes = get_writes(non_tty_stream)
      expect(writes).toContain('plain text\n')
    })

    it('should still write output() key-value pairs', () => {
      non_tty_display.output('Region', 'us-west-2')
      const writes = get_writes(non_tty_stream)
      const output_line = writes.find(w => w.includes('  Region: us-west-2'))
      expect(output_line).toBeDefined()
    })
  })

  // ---------------------------------------------------------------
  // Spinner rendering on TTY
  // ---------------------------------------------------------------
  describe('spinner rendering on TTY', () => {
    it('should cycle through spinner frames', () => {
      display.start_operation('Spinning')

      // Collect frames over several intervals
      const frames_seen: string[] = []
      for (let i = 0; i < 12; i++) {
        stream.write.mockClear()
        vi.advanceTimersByTime(80)
        const writes = get_writes(stream)
        const spinner_write = writes.find(w => w.startsWith('\r'))
        if (spinner_write) {
          frames_seen.push(spinner_write)
        }
      }

      // Should have rendered multiple different frames
      expect(frames_seen.length).toBeGreaterThan(0)
      // Verify frames contain the YELLOW color code (spinner frame coloring)
      for (const frame of frames_seen) {
        expect(frame).toContain(YELLOW)
      }
    })

    it('should use carriage return and clear sequence', () => {
      display.start_operation('Task')
      stream.write.mockClear()

      vi.advanceTimersByTime(80)
      const writes = get_writes(stream)
      const spinner_write = writes.find(w => w.startsWith('\r\x1b[K'))
      expect(spinner_write).toBeDefined()
    })

    it('should set has_spinner_line flag when rendering', () => {
      display.start_operation('Task')
      // After rendering, clearing should write \r\x1b[K
      stream.write.mockClear()

      display.info('interrupt')
      const writes = get_writes(stream)
      // First write should be the clear sequence, then the info line
      expect(writes[0]).toBe('\r\x1b[K')
    })

    it('should re-render spinner after writing a permanent line', () => {
      display.start_operation('Background')
      stream.write.mockClear()

      display.info('notification')
      const writes = get_writes(stream)

      // Order: clear spinner, write permanent line, re-render spinner
      const clear_idx = writes.findIndex(w => w === '\r\x1b[K')
      const info_idx = writes.findIndex(w => w.includes('notification'))
      const rerender_idx = writes.findIndex((w, i) => i > info_idx && w.startsWith('\r\x1b[K'))

      expect(clear_idx).toBeLessThan(info_idx)
      expect(rerender_idx).toBeGreaterThan(info_idx)
    })
  })

  // ---------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------
  describe('edge cases', () => {
    it('should handle start then immediate stop', () => {
      display.start_operation('Quick')
      display.stop()

      stream.write.mockClear()
      vi.advanceTimersByTime(200)
      expect(stream.write).not.toHaveBeenCalled()
    })

    it('should handle multiple stops without error', () => {
      display.stop()
      display.stop()
      // Should not throw
    })

    it('should handle resume without prior pause', () => {
      display.resume()
      // Should not throw
    })

    it('should handle pause/resume cycle with no buffered content', () => {
      display.pause()
      stream.write.mockClear()
      display.resume()
      // Nothing should be flushed
      expect(stream.write).not.toHaveBeenCalled()
    })

    it('should handle completing same label twice', () => {
      display.start_operation('Task')
      display.complete_operation('Task')
      stream.write.mockClear()
      display.complete_operation('Task')

      // Second completion should still produce a line but no elapsed time
      const writes = get_writes(stream)
      const completion = writes.find(w => w.includes(`${GREEN}\u2714${RESET}`))
      expect(completion).toBeDefined()
      expect(completion).not.toContain('(')
    })

    it('should handle mixed pause/resume with operations', () => {
      display.start_operation('A')
      display.pause()
      display.complete_operation('A')
      display.start_operation('B')
      display.info('paused info')

      stream.write.mockClear()
      display.resume()

      const writes = get_writes(stream)
      // Should flush completion of A and the info message
      expect(writes.some(w => w.includes(`${GREEN}\u2714${RESET}`) && w.includes('A'))).toBe(true)
      expect(writes.some(w => w.includes('paused info'))).toBe(true)
      // Should restart spinner for B
      vi.advanceTimersByTime(80)
      const later_writes = get_writes(stream)
      expect(later_writes.some(w => w.includes('B'))).toBe(true)
    })
  })
})
