import { AppSyncEventWebSocketClient } from '@boundlessdigital/aws-appsync-events-websockets-client'
import { APPSYNC_EVENTS_API_NAMESPACE } from '../constants.js'
import { execute_handler } from './runtime.js'
import { logger } from '../lib/logger.js'

import { ServerConfig } from './types.js'

export async function serve(config: ServerConfig): Promise<void> {
  logger.start('Starting LiveLambda server...')

  const client = new AppSyncEventWebSocketClient({
    ...config,
    debug: true,
    on_error: (error: any) => {
      logger.error(`WebSocket error: ${JSON.stringify(error)}`)
    },
    on_close: (event: any) => {
      logger.warn(`WebSocket closed: code=${event?.code}, reason=${event?.reason}`)
    }
  })

  const requests_channel = `/${APPSYNC_EVENTS_API_NAMESPACE}/requests`

  await client.connect()
  logger.info('Connected to AppSync WebSocket')

  await client.subscribe(requests_channel, (payload: string) => {
    logger.info(`Received request on ${requests_channel}`)
    handle_request(client, payload)
  })
  logger.info(`Subscribed to ${requests_channel}`)

  logger.ready('Server ready.')
}

async function handle_request(
  client: AppSyncEventWebSocketClient,
  payload: string
): Promise<any> {
  try {
    const { request_id, context, event_payload: event } = JSON.parse(payload)
    logger.info(`Processing request: ${request_id}`)

    const response = await execute_handler(event, context)
    logger.info(`Handler returned response for request: ${request_id}`)

    const response_channel = `/${APPSYNC_EVENTS_API_NAMESPACE}/response/${request_id}`
    await client.publish(response_channel, [response])
    logger.info(`Published response to ${response_channel}`)
  } catch (error) {
    logger.error(`Error in handle_request: ${error}`)
  }
}
