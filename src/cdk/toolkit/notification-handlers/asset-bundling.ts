import { IoMessage } from '@aws-cdk/toolkit-lib'
import 'colors'
import { HandlingResult, NotificationHandler } from './base.js'

const ANSI_REGEX = new RegExp(
  [
    '[\\u001B\\u009B][[]()#;?]*.{0,2}(?:(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?[\\u0007]',
    '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))'
  ].join('|'),
  'g'
)

function strip_ansi(str: string): string {
  return str.replace(ANSI_REGEX, '')
}

export class AssetBundlingHandler implements NotificationHandler {
  private current_bundling_asset: { id: string; startTime: number } | null =
    null

  public handle(msg: IoMessage<unknown>): HandlingResult {
    // The CDK pipes all output from the bundling process (e.g., esbuild)
    // into notifications with the same code and a level of 'error', even for success messages.
    // We must rely on string matching the message content.
    const is_bundling_message =
      msg.code === 'CDK_ASSEMBLY_E1002' && msg.action === 'assembly'

    if (!is_bundling_message) {
      return 'ignored'
    }

    const clean_message = strip_ansi(msg.message)

    const start_match = clean_message.match(/^Bundling asset (.*)\.\.\./)
    if (start_match) {
      const asset_id = start_match[1]
      // Assuming sequential bundling, if a new one starts, the old one is orphaned.
      this.current_bundling_asset = { id: asset_id, startTime: Date.now() }
      console.log(`Bundling asset ${asset_id}...`.cyan)
      return 'handled'
    }

    // The success message from esbuild doesn't contain the asset ID,
    // so we associate it with the currently active bundling process.
    const success_match = clean_message.match(/^⚡ Done in \d+m?s/)
    if (success_match && this.current_bundling_asset) {
      const duration = (
        (Date.now() - this.current_bundling_asset.startTime) /
        1000
      ).toFixed(2)
      console.log(`  ✅ Done in ${duration}s`.green)
      this.current_bundling_asset = null // Reset for the next asset.
      return 'handled'
    }

    // If we are in the middle of a bundling process, suppress all other messages
    // as they are intermediate output from the bundling tool (e.g., file sizes).
    if (this.current_bundling_asset) {
      return 'handled'
    }

    return 'ignored'
  }
}
