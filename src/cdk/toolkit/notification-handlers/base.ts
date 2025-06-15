import { IoMessage } from '@aws-cdk/toolkit-lib'

export type HandlingResult = 'handled' | 'passthrough' | 'ignored'

/**
 * Defines the interface for a handler that can process CDK notifications.
 */
export interface NotificationHandler {
  /**
   * Processes a notification message.
   * @param msg The IoMessage to process.
   * @returns A HandlingResult indicating how the message was processed.
   *          - 'handled': The message was fully handled and should be suppressed.
   *          - 'passthrough': The handler acted, but the original message should still be printed.
   *          - 'ignored': The handler did not act on this message.
   */
  handle(msg: IoMessage<unknown>): HandlingResult
}
