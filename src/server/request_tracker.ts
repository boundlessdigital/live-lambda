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
    this.display.complete_operation(this.current_label)

    const elapsed = Date.now() - this.start_time
    const status = status_code !== undefined
      ? `  ${this.color_status(status_code)}`
      : ''
    const line = `${CYAN}←${RESET} ${this.function_name} → ${this.event_label}${status}  ${DIM}${elapsed}ms${RESET}`
    this.display.line(line)

    if (this.verbose) {
      for (const d of this.details) {
        this.display.line(`  ↳ ${d}`)
      }
    }

    this.display.line('')
  }

  fail(error: Error | string): void {
    const elapsed = Date.now() - this.start_time
    const message = error instanceof Error ? error.message : error

    this.display.fail_operation(this.current_label)

    const line = `${RED}✖${RESET} ${this.function_name} → ${this.event_label}  ${DIM}${elapsed}ms${RESET}`
    this.display.line(line)
    this.display.line(`  ↳ ${message}`)

    if (this.verbose) {
      for (const d of this.details) {
        this.display.line(`  ↳ ${d}`)
      }
    }

    this.display.line('')
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
  const suffixes = [/ConstructFunction$/, /Function$/, /Lambda$/]
  for (const suffix of suffixes) {
    const stripped = prefix.replace(suffix, '')
    if (stripped !== prefix && stripped.length > 0) return stripped
  }
  return prefix
}
