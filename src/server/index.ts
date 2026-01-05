import { AppSyncEventWebSocketClient } from '@boundlessdigital/aws-appsync-events-websockets-client'
import { APPSYNC_EVENTS_API_NAMESPACE } from '../constants.js'
import { execute_handler } from './runtime.js'
import { logger } from '../lib/logger.js'

import { ServerConfig } from './types.js'

export async function serve(config: ServerConfig): Promise<void> {
  logger.start('Starting LiveLambda server...')

  const client = new AppSyncEventWebSocketClient(config)

  const requests_channel = `/${APPSYNC_EVENTS_API_NAMESPACE}/requests`

  await client.connect()

  await client.subscribe(requests_channel, (payload) =>
    handle_request(client, payload)
  )
}

async function handle_request(
  client: AppSyncEventWebSocketClient,
  payload: string
): Promise<any> {
  const { request_id, context, event_payload: event } = JSON.parse(payload)

  const response = await execute_handler(event, context)

  const response_channel = `/${APPSYNC_EVENTS_API_NAMESPACE}/response/${request_id}`
  await client.publish(response_channel, [response])
}
