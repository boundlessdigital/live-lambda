import {
  NonInteractiveIoHost,
  NonInteractiveIoHostProps,
  IoMessage, // Included for potential direct use or future overrides
  IoRequest  // Included for potential direct use or future overrides
} from '@aws-cdk/toolkit-lib'
import { logger } from '../../lib/logger.js'
import {
  DeployEventEmitter,
  parse_cdk_message
} from '../../cli/listr-deploy.js'

export class CustomIoHost extends NonInteractiveIoHost {
  private emitter: DeployEventEmitter | null = null
  private suppress_output: boolean = false

  constructor(props?: NonInteractiveIoHostProps) {
    super(props)
    logger.debug('CustomIoHost initialized')
  }

  /**
   * Set the event emitter to route CDK messages to Listr2
   * When set, messages will be parsed and emitted instead of logged to console
   */
  public set_emitter(emitter: DeployEventEmitter | null): void {
    this.emitter = emitter
    this.suppress_output = emitter !== null
  }

  // Override notify to route messages to Listr2 when emitter is set
  public async notify(msg: IoMessage<unknown>): Promise<void> {
    // If we have an emitter, route messages to it instead of console
    if (this.emitter && this.suppress_output) {
      const message_str = typeof msg.message === 'string' ? msg.message : ''
      const parsed = parse_cdk_message({ message: message_str, level: msg.level })

      if (parsed) {
        this.emitter.emit_stack_event(parsed)

        // Complete stack if status indicates completion
        if (parsed.status === 'complete' || parsed.status === 'no_changes') {
          this.emitter.complete_stack(parsed.stack_name, true)
        } else if (parsed.status === 'failed') {
          this.emitter.complete_stack(parsed.stack_name, false)
        }
      } else {
        // Log non-stack messages at debug level
        logger.debug(`[CDK] ${message_str}`)
      }
      return
    }

    // Fall back to default console output
    await super.notify(msg)
  }

  // Override requestResponse to add custom logging before calling the base implementation.
  public async requestResponse<DataType, ResponseType>(
    request: IoRequest<DataType, ResponseType>
  ): Promise<ResponseType> {
    // Example: You could add custom logging or specific request handling here.
    // console.log(`[CustomIoHost REQUEST] Code: ${request.code}, Message: ${request.message}`);

    // For security prompts, if you want to auto-approve as the previous complex version did:
    const SECURITY_PROMPT_REQUIRED_APPROVALS_CODE = 'CDK_TOOLKIT_I5060';
    const SECURITY_PROMPT_KEYWORDS = ['security', 'iam', 'auth', 'permissions'];

    if (request.code === SECURITY_PROMPT_REQUIRED_APPROVALS_CODE) {
      // console.log(`[CustomIoHost] Auto-approving known security prompt: ${request.code}`.yellow);
      return request.defaultResponse;
    }

    const messageContent = typeof request.message === 'string' ? request.message.toLowerCase() : '';
    const isSecurityPrompt = SECURITY_PROMPT_KEYWORDS.some((keyword) =>
      messageContent.includes(keyword.toLowerCase())
    );

    if (isSecurityPrompt) {
      const approvalLogMessage = `Auto-approving security sensitive changes: ${
        (typeof request.message === 'string' ? request.message.split('\n')[0] : 'Unknown security prompt')
      }`;
      logger.info(approvalLogMessage);
      return true as unknown as ResponseType; // Auto-approve
    }
    
    // Call the base class's requestResponse method for all other default behaviors.
    return super.requestResponse(request);
  }

  public cleanup() {
    logger.debug('CustomIoHost cleaned up');
    // No ink_instance to unmount.
    // Add any other cleanup specific to this host if necessary.
  }
}
