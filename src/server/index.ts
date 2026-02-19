import { AppSyncEventWebSocketClient } from '@boundlessdigital/aws-appsync-events-websockets-client'
import { APPSYNC_EVENTS_API_NAMESPACE } from '../constants.js'
import { execute_handler } from './runtime.js'
import { logger } from '../lib/logger.js'
import type { TerminalDisplay } from '../lib/display/types.js'

import { ServerConfig } from './types.js'

const RECONNECT_DELAY_MS = 2_000
const MAX_RECONNECT_DELAY_MS = 30_000

export async function serve(config: ServerConfig): Promise<void> {
  logger.start('Starting LiveLambda server...')

  const requests_channel = `/${APPSYNC_EVENTS_API_NAMESPACE}/requests`
  const { display } = config
  let reconnect_delay = RECONNECT_DELAY_MS

  async function connect_and_subscribe() {
    const client = new AppSyncEventWebSocketClient({
      ...config,
      debug: !display,
      on_error: (error: any) => {
        logger.error(`WebSocket error: ${JSON.stringify(error)}`)
      },
      on_close: (event: any) => {
        logger.warn(`WebSocket closed: code=${event?.code}, reason=${event?.reason}`)
        schedule_reconnect()
      }
    })

    await client.connect()
    logger.info('Connected to AppSync WebSocket')

    await client.subscribe(requests_channel, (payload: string) => {
      logger.debug(`Received request on ${requests_channel}`)
      handle_request(client, payload, display)
    })
    logger.info(`Subscribed to ${requests_channel}`)

    // Reset delay on successful connection
    reconnect_delay = RECONNECT_DELAY_MS
    return client
  }

  function schedule_reconnect() {
    logger.info(`Reconnecting in ${reconnect_delay / 1000}s...`)
    setTimeout(async () => {
      try {
        await connect_and_subscribe()
        logger.ready('Reconnected.')
      } catch (error) {
        logger.error(`Reconnection failed: ${error}`)
        reconnect_delay = Math.min(reconnect_delay * 2, MAX_RECONNECT_DELAY_MS)
        schedule_reconnect()
      }
    }, reconnect_delay)
  }

  await connect_and_subscribe()
  logger.ready('Server ready.')
}

async function handle_request(
  client: AppSyncEventWebSocketClient,
  payload: string,
  display?: TerminalDisplay
): Promise<any> {
  let request_id: string | undefined
  try {
    const parsed = JSON.parse(payload)
    request_id = parsed.request_id
    const { context, event_payload: event } = parsed
    logger.debug(`Processing request: ${request_id}`)

    const response = await execute_handler(event, context, display)
    logger.debug(`Handler returned response for request: ${request_id}`)

    const response_channel = `/${APPSYNC_EVENTS_API_NAMESPACE}/response/${request_id}`
    await client.publish(response_channel, [response])
    logger.debug(`Published response to ${response_channel}`)
  } catch (error) {
    logger.error(`Error in handle_request: ${error}`)

    // Always publish an error response so the Go extension doesn't hang
    // waiting for a response that never comes (which causes curl to hang).
    if (request_id) {
      const error_message = error instanceof Error ? error.message : String(error)
      const error_response = {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: error_message })
      }
      try {
        const response_channel = `/${APPSYNC_EVENTS_API_NAMESPACE}/response/${request_id}`
        await client.publish(response_channel, [error_response])
      } catch (publish_error) {
        logger.error(`Failed to publish error response: ${publish_error}`)
      }
    }
  }
}
