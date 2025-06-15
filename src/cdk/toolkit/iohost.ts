import 'colors'
import {
  IoMessage,
  IoRequest,
  NonInteractiveIoHost,
  NonInteractiveIoHostProps
} from '@aws-cdk/toolkit-lib'
import {
  AssetBundlingHandler,
  NotificationHandler
} from './notification-handlers/index.js'

const SECURITY_PROMPT_REQUIRED_APPROVALS_CODE = 'CDK_TOOLKIT_I5060'

export class CustomIoHost extends NonInteractiveIoHost {
  private handlers: NotificationHandler[]

  constructor(props?: NonInteractiveIoHostProps) {
    super(props)
    this.handlers = [new AssetBundlingHandler()]
  }

  public async notify(msg: IoMessage<unknown>): Promise<void> {
    for (const handler of this.handlers) {
      const result = handler.handle(msg)
      if (result === 'handled') {
        return // Message was handled and should be suppressed.
      }
      if (result === 'passthrough') {
        // Message was handled, but original should still be printed.
        // We break to prevent other handlers from processing it, and then fall through to super.notify.
        break
      }
      // if result is 'ignored', we continue to the next handler.
    }

    // For all other messages, or for 'passthrough' cases, use the default behavior.
    await super.notify(msg)
  }

  public async requestResponse<T, U>(request: IoRequest<T, U>): Promise<U> {
    if (request.code === SECURITY_PROMPT_REQUIRED_APPROVALS_CODE) {
      return request.defaultResponse // Disables the message --require-approval\" is enabled and stack includes security-sensitive updates."
    }

    // console.log(`Received request: ${request.message}`)
    // console.log(JSON.stringify(request, null, 2))
    return super.requestResponse(request)
  }
  //   public async requestResponse<DataType, ResponseType>(
  //     request: IoRequest<DataType, ResponseType>
  //   ): Promise<ResponseType> {
  //     // Check if the request message contains keywords indicative of a security approval prompt
  //     const messageContent = request.message.toLowerCase()
  //     const isSecurityPrompt = SECURITY_PROMPT_KEYWORDS.some((keyword) =>
  //       messageContent.includes(keyword.toLowerCase())
  //     )

  //     if (isSecurityPrompt) {
  //       const approvalLogMessage = `Auto-approving security sensitive changes: ${
  //         request.message.split('\n')[0] // Log the first line of the prompt
  //       }`
  //       // Use the inherited notify method to log this action
  //       await super.notify({
  //         code: 'CDK_LIVELAMBDA_I0001', // Conforms to CDK's expected pattern for info messages
  //         level: 'info',
  //         action: 'AUTO_APPROVE_INFO', // Added missing 'action' property
  //         message: approvalLogMessage,
  //         time: new Date(),
  //         data: undefined
  //       })
  //       // For security prompts that expect a 'y' or true.
  //       // The actual type of ResponseType for this specific prompt is typically boolean or string ('y').
  //       return true as unknown as ResponseType
  //     }

  //     // For all other requests, delegate to the default behavior of NonInteractiveIoHost
  //     return super.requestResponse(request)
  //   }

  // We don't need to override notify if we just want default behavior for notifications
  // public async notify(msg: IoMessage<unknown>): Promise<void> {
  //   // If you wanted custom notification handling, you'd do it here.
  //   // Otherwise, just call super.notify or remove this override to inherit.
  //   return super.notify(msg);
  // }
}
