import {
  NonInteractiveIoHost,
  NonInteractiveIoHostProps,
  IoMessage,
  IoRequest
} from '@aws-cdk/toolkit-lib'
import type { TerminalDisplay } from '../../lib/display/index.js'
import { logger } from '../../lib/logger.js'

const ALT_SCREEN_ON = '\x1b[?1049h\x1b[H'
const ALT_SCREEN_OFF = '\x1b[?1049l'

export interface CustomIoHostProps extends NonInteractiveIoHostProps {
  verbose?: boolean
  display: TerminalDisplay
}

export class CustomIoHost extends NonInteractiveIoHost {
  private verbose: boolean
  private display: TerminalDisplay
  private deploying_stacks = new Map<string, string>()
  private message_buffer: string[] = []
  private stream: NodeJS.WriteStream

  constructor(props: CustomIoHostProps) {
    super(props)
    this.verbose = props.verbose ?? false
    this.display = props.display
    this.stream = process.stderr
  }

  get is_verbose(): boolean {
    return this.verbose
  }

  toggle_verbose(): void {
    this.verbose = !this.verbose
    if (this.verbose) {
      // Pause spinner, switch to alt screen, replay buffer
      this.display.pause()
      if (this.stream.isTTY) {
        this.stream.write(ALT_SCREEN_ON)
        for (const text of this.message_buffer) {
          this.stream.write(text + '\n')
        }
      }
    } else {
      // Switch back to main screen (terminal restores it), resume spinner
      if (this.stream.isTTY) {
        this.stream.write(ALT_SCREEN_OFF)
      }
      this.display.resume()
    }
  }

  public async notify(msg: IoMessage<unknown>): Promise<void> {
    // Always buffer for alt screen replay
    this.message_buffer.push(msg.message)

    // Always route for display state tracking (updates spinner active/completed state)
    this.route_message(msg)

    // In verbose mode, also show raw CDK output on alt screen
    if (this.verbose) {
      await super.notify(msg)
    }
  }

  public async requestResponse<DataType, ResponseType>(
    request: IoRequest<DataType, ResponseType>
  ): Promise<ResponseType> {
    const SECURITY_PROMPT_REQUIRED_APPROVALS_CODE = 'CDK_TOOLKIT_I5060'
    const SECURITY_PROMPT_KEYWORDS = ['security', 'iam', 'auth', 'permissions']

    if (request.code === SECURITY_PROMPT_REQUIRED_APPROVALS_CODE) {
      return request.defaultResponse
    }

    const message_content = typeof request.message === 'string' ? request.message.toLowerCase() : ''
    const is_security_prompt = SECURITY_PROMPT_KEYWORDS.some((keyword) =>
      message_content.includes(keyword.toLowerCase())
    )

    if (is_security_prompt) {
      logger.debug(`Auto-approving security changes: ${request.message.split('\n')[0]}`)
      return true as unknown as ResponseType
    }

    return super.requestResponse(request)
  }

  public cleanup() {
    if (!this.verbose) {
      this.display.stop()
    }
    logger.debug('CustomIoHost cleaned up')
  }

  private route_message(msg: IoMessage<unknown>) {
    const text = msg.message

    // Always show errors
    if (msg.level === 'error') {
      this.display.error(text)
      return
    }

    // Always show warnings
    if (msg.level === 'warn') {
      this.display.warn(text)
      return
    }

    // Detect stack deployment start: "StackName: deploying... [1/2]"
    const deploying_match = text.match(/^(\S+): deploying\.\.\.\s*\[(\d+)\/(\d+)\]/)
    if (deploying_match) {
      const stack_name = deploying_match[1]
      const action = msg.action === 'destroy' ? 'Destroying' : 'Deploying'
      const label = `${action} ${stack_name}`
      this.deploying_stacks.set(stack_name, label)
      this.display.start_operation(label)
      return
    }

    // Detect stack completion: " ✅  StackName" or " ✅  StackName (no changes)"
    const success_match = text.match(/✅\s+(\S+)/)
    if (success_match) {
      const stack_name = success_match[1]
      const label = this.deploying_stacks.get(stack_name)
      if (label) {
        this.deploying_stacks.delete(stack_name)
        this.display.complete_operation(label)
      } else {
        // Stack completed without a deploying message (e.g. no changes, bootstrap)
        this.display.complete_operation(stack_name)
      }
      return
    }

    // Detect stack failure: "❌" in message
    const failure_match = text.match(/❌\s+(\S+)/)
    if (failure_match) {
      const stack_name = failure_match[1]
      const label = this.deploying_stacks.get(stack_name) ?? stack_name
      this.deploying_stacks.delete(stack_name)
      this.display.fail_operation(label, text)
      return
    }

    // Show key outputs (result level messages with "Outputs:" are followed by key=value lines)
    if (msg.level === 'result' && text.includes('=') && !text.includes('Stack ARN')) {
      const [key, ...rest] = text.split('=')
      const trimmed_key = key.trim()
      const value = rest.join('=').trim()
      // Only show live-lambda specific outputs
      if (trimmed_key.includes('LiveLambda') || trimmed_key.includes('EventApi')) {
        this.display.output(trimmed_key.split('.').pop() ?? trimmed_key, value)
      }
      return
    }

    // Show synthesis and bootstrap timing results
    if (msg.level === 'result' && (text.includes('Synthesis time') || text.includes('Bootstrap time') || text.includes('Total time'))) {
      return // suppress timing lines — we show our own timing
    }

    // Suppress everything else (build, publish, changeset, resource-level events)
    // These are info/debug/trace level CDK internals
  }
}
