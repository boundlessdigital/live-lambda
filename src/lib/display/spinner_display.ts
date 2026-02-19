import type { TerminalDisplay } from './types.js'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const INTERVAL_MS = 80

const YELLOW = '\x1b[33m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

export class SpinnerDisplay implements TerminalDisplay {
  private active = new Map<string, { start: number }>()
  private pending_renders: string[] = []
  private frame_index = 0
  private interval: ReturnType<typeof setInterval> | null = null
  private paused = false
  private has_spinner_line = false
  private stream: NodeJS.WriteStream

  constructor(stream?: NodeJS.WriteStream) {
    this.stream = stream ?? process.stderr
  }

  start_operation(label: string): void {
    this.active.set(label, { start: Date.now() })
    if (!this.paused) {
      this.ensure_spinning()
    }
  }

  update_operation(old_label: string, new_label: string): void {
    const entry = this.active.get(old_label)
    if (!entry) return
    this.active.delete(old_label)
    this.active.set(new_label, entry)
  }

  complete_operation(label: string): void {
    const entry = this.active.get(label)
    const elapsed = entry
      ? ` ${DIM}(${((Date.now() - entry.start) / 1000).toFixed(1)}s)${RESET}`
      : ''
    this.active.delete(label)
    const line = `${GREEN}✔${RESET} ${label}${elapsed}`
    if (this.paused) {
      this.pending_renders.push(line)
    } else {
      this.write_permanent(line)
      this.update_spinner_state()
    }
  }

  fail_operation(label: string, message?: string): void {
    this.active.delete(label)
    const text = message ? `${label}: ${message}` : label
    const line = `${RED}✖${RESET} ${text}`
    if (this.paused) {
      this.pending_renders.push(line)
    } else {
      this.write_permanent(line)
      this.update_spinner_state()
    }
  }

  info(message: string): void {
    const line = `${DIM}ℹ${RESET} ${message}`
    if (this.paused) {
      this.pending_renders.push(line)
    } else {
      this.write_permanent(line)
    }
  }

  warn(message: string): void {
    const line = `${YELLOW}⚠${RESET} ${message}`
    if (this.paused) {
      this.pending_renders.push(line)
    } else {
      this.write_permanent(line)
    }
  }

  error(message: string): void {
    const line = `${RED}✖${RESET} ${message}`
    if (this.paused) {
      this.pending_renders.push(line)
    } else {
      this.write_permanent(line)
    }
  }

  output(key: string, value: string): void {
    const line = `  ${key}: ${value}`
    if (this.paused) {
      this.pending_renders.push(line)
    } else {
      this.write_permanent(line)
    }
  }

  pause(): void {
    this.paused = true
    this.stop_spinning()
  }

  resume(): void {
    this.paused = false
    // Flush renders that accumulated while paused
    for (const line of this.pending_renders) {
      this.stream.write(`${line}\n`)
    }
    this.pending_renders = []
    if (this.active.size > 0) {
      this.ensure_spinning()
    }
  }

  stop(): void {
    this.stop_spinning()
    this.active.clear()
    this.pending_renders = []
  }

  // --- Private ---

  private ensure_spinning(): void {
    if (this.interval || this.paused) return
    this.render_spinner()
    this.interval = setInterval(() => this.render_spinner(), INTERVAL_MS)
  }

  private stop_spinning(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    this.clear_spinner()
  }

  private update_spinner_state(): void {
    if (this.active.size === 0) {
      this.stop_spinning()
    } else if (!this.paused) {
      this.ensure_spinning()
    }
  }

  private render_spinner(): void {
    if (this.active.size === 0) return

    const frame = FRAMES[this.frame_index % FRAMES.length]
    this.frame_index++

    const text = this.build_status_text()

    if (this.stream.isTTY) {
      this.stream.write(`\r\x1b[K${YELLOW}${frame}${RESET} ${text}`)
      this.has_spinner_line = true
    }
  }

  private build_status_text(): string {
    const ops = Array.from(this.active.entries())
    if (ops.length === 0) return ''

    const [label, { start }] = ops[ops.length - 1]
    const elapsed_s = Math.floor((Date.now() - start) / 1000)
    const suffix = ops.length > 1
      ? ` ${DIM}(+${ops.length - 1} more)${RESET}`
      : ''
    return `${label} ${DIM}${elapsed_s}s${RESET}${suffix}`
  }

  private write_permanent(text: string): void {
    this.clear_spinner()
    this.stream.write(`${text}\n`)
    if (!this.paused && this.active.size > 0) {
      this.render_spinner()
    }
  }

  private clear_spinner(): void {
    if (this.has_spinner_line && this.stream.isTTY) {
      this.stream.write('\r\x1b[K')
      this.has_spinner_line = false
    }
  }
}
