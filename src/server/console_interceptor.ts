import { format } from 'util'
import type { TerminalDisplay } from '../lib/display/types.js'

export async function with_console_intercept<T>(
  display: TerminalDisplay,
  fn: () => Promise<T>
): Promise<T> {
  const original_log = console.log
  const original_warn = console.warn
  const original_error = console.error

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
