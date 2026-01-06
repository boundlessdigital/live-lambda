import {
  NonInteractiveIoHost,
  NonInteractiveIoHostProps,
  IoMessage,
  IoRequest
} from '@aws-cdk/toolkit-lib'
import { logger } from '../../lib/logger.js'

export class CustomIoHost extends NonInteractiveIoHost {
  constructor(props?: NonInteractiveIoHostProps) {
    super(props)
    logger.debug('CustomIoHost initialized')
  }

  // Override requestResponse to auto-approve security prompts
  public async requestResponse<DataType, ResponseType>(
    request: IoRequest<DataType, ResponseType>
  ): Promise<ResponseType> {
    const SECURITY_PROMPT_REQUIRED_APPROVALS_CODE = 'CDK_TOOLKIT_I5060'
    const SECURITY_PROMPT_KEYWORDS = ['security', 'iam', 'auth', 'permissions']

    if (request.code === SECURITY_PROMPT_REQUIRED_APPROVALS_CODE) {
      return request.defaultResponse
    }

    const messageContent = typeof request.message === 'string' ? request.message.toLowerCase() : ''
    const isSecurityPrompt = SECURITY_PROMPT_KEYWORDS.some((keyword) =>
      messageContent.includes(keyword.toLowerCase())
    )

    if (isSecurityPrompt) {
      const approvalLogMessage = `Auto-approving security sensitive changes: ${
        (typeof request.message === 'string' ? request.message.split('\n')[0] : 'Unknown security prompt')
      }`
      logger.info(approvalLogMessage)
      return true as unknown as ResponseType
    }

    return super.requestResponse(request)
  }

  public cleanup() {
    logger.debug('CustomIoHost cleaned up')
  }
}
