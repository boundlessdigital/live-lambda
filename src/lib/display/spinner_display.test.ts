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

      // The completion line (containing the checkmark) should reference the new label
      const writes = stream.write.mock.calls.map((c: any[]) => c[0])
      const completion_line = writes.find((w: string) => w.includes('\u2714'))
      expect(completion_line).toBeDefined()
      expect(completion_line).toContain('New Label')
      expect(completion_line).not.toContain('Old Label')
    })

    it('should no-op when old label does not exist', () => {
      display.update_operation('Nonexistent', 'New Label')

      // No operation was started, so active map should be empty
      // and no spinner or completion lines should reference the label
      const writes = stream.write.mock.calls.map((c: any[]) => c[0])
      const spinner_lines = writes.filter((w: string) => w.includes('New Label'))
      expect(spinner_lines).toHaveLength(0)
    })
  })
})
