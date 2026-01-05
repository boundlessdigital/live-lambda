import {
  NonInteractiveIoHost,
  NonInteractiveIoHostProps,
  IoMessage, // Included for potential direct use or future overrides
  IoRequest  // Included for potential direct use or future overrides
} from '@aws-cdk/toolkit-lib';
import { logger } from '../../lib/logger.js';

export class CustomIoHost extends NonInteractiveIoHost {
  constructor(props?: NonInteractiveIoHostProps) {
    super(props);
    logger.debug('CustomIoHost initialized');
  }

  // Override notify to add custom logging before calling the base implementation.
  public async notify(msg: IoMessage<unknown>): Promise<void> {
    // Example: You could add custom logging or filtering here if needed.
    // console.log(`[CustomIoHost NOTIFY] Level: ${msg.level}, Message: ${msg.message}`);
    
    // Call the base class's notify method to get default console output behavior.
    await super.notify(msg);
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
