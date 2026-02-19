export interface TerminalDisplay {
  start_operation(label: string): void
  update_operation(old_label: string, new_label: string): void
  complete_operation(label: string): void
  fail_operation(label: string, message?: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string): void
  line(message: string): void
  output(key: string, value: string): void
  pause(): void
  resume(): void
  stop(): void
}
