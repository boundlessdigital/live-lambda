export interface KeypressListenerOptions {
  on_toggle_verbose: () => void
}

export class KeypressListener {
  private active = false
  private options: KeypressListenerOptions

  constructor(options: KeypressListenerOptions) {
    this.options = options
  }

  start(): void {
    if (!process.stdin.isTTY || this.active) return

    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', this.handle_key)
    this.active = true
  }

  stop(): void {
    if (!this.active) return

    process.stdin.removeListener('data', this.handle_key)
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false)
    }
    process.stdin.pause()
    this.active = false
  }

  private handle_key = (key: string): void => {
    // Ctrl+C — raw mode swallows it, so re-emit as SIGINT
    if (key === '\x03') {
      process.emit('SIGINT', 'SIGINT')
      return
    }

    if (key === 'v' || key === 'V') {
      this.options.on_toggle_verbose()
    }
  }
}
