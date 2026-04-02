import { AppSyncEventWebSocketClient } from '@boundlessdigital/aws-appsync-events-websockets-client'
import { fromIni, fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { APPSYNC_EVENTS_API_NAMESPACE } from '../constants.js'
import { execute_handler } from './runtime.js'
import { logger } from '../lib/logger.js'
import type { TerminalDisplay } from '../lib/display/types.js'

import type { ServerConfig, RegionalServerConfig } from './types.js'

type CredentialProvider = () => Promise<{
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}>

const RECONNECT_DELAY_MS = 2_000
const MAX_RECONNECT_DELAY_MS = 30_000

// Mutex to serialize handler execution. execute_handler mutates process.env
// (injects Lambda role credentials), which can corrupt concurrent operations
// like AppSync publish signing if they read from process.env.
let handler_lock: Promise<void> = Promise.resolve()

function with_lock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = handler_lock
  let resolve_lock: () => void
  handler_lock = new Promise<void>((r) => { resolve_lock = r })
  return prev.then(fn).finally(() => resolve_lock!())
}

export async function serve(config: ServerConfig): Promise<void> {
  logger.start('Starting LiveLambda server...')

  const { configs, display, profile } = config
  const aws_profile = profile ?? process.env.AWS_PROFILE

  if (configs.length === 0) {
    throw new Error('No regional server configs provided')
  }

  // Create a credential provider that caches resolved credentials but refreshes
  // when they're near expiration. This isolates AppSync signing from process.env
  // mutations during handler execution (Lambda role assumption).
  const base_provider = aws_profile
    ? fromIni({ profile: aws_profile })
    : fromNodeProviderChain()

  let cached_credentials = await base_provider()
  logger.info(`Resolved developer credentials: ${cached_credentials.accessKeyId.substring(0, 10)}...`)

  const REFRESH_BUFFER_MS = 5 * 60 * 1000 // refresh 5 minutes before expiry

  const refreshing_credential_provider: CredentialProvider = async () => {
    const expiration = cached_credentials.expiration
    if (expiration && Date.now() > expiration.getTime() - REFRESH_BUFFER_MS) {
      logger.info('Developer credentials near expiry — refreshing...')
      try {
        cached_credentials = await base_provider()
        logger.info(`Refreshed developer credentials: ${cached_credentials.accessKeyId.substring(0, 10)}...`)
      } catch (error) {
        logger.error(`Failed to refresh credentials: ${error}`)
      }
    }
    return cached_credentials
  }

  await Promise.all(
    configs.map((regional_config) =>
      connect_region(regional_config, refreshing_credential_provider, display)
    )
  )

  logger.ready(`Server ready — connected to ${configs.length} region(s).`)
}

async function connect_region(
  regional_config: RegionalServerConfig,
  credential_provider: CredentialProvider,
  display?: TerminalDisplay
): Promise<void> {
  const { region } = regional_config
  const requests_channel = `/${APPSYNC_EVENTS_API_NAMESPACE}/requests`
  let reconnect_delay = RECONNECT_DELAY_MS

  async function connect_and_subscribe() {
    const client = new AppSyncEventWebSocketClient({
      ...regional_config,
      credentials: credential_provider,
      debug: !display,
      auto_reconnect: false,
      on_error: (error: unknown) => {
        logger.error(`[${region}] WebSocket error: ${JSON.stringify(error)}`)
      },
      on_close: (event: unknown) => {
        const close_event = event as { code?: number; reason?: string }
        logger.warn(`[${region}] WebSocket closed: code=${close_event?.code}, reason=${close_event?.reason}`)
        schedule_reconnect()
      }
    })

    await client.connect()
    logger.info(`[${region}] Connected to AppSync WebSocket`)

    await client.subscribe(requests_channel, (payload: unknown) => {
      logger.debug(`[${region}] Received request on ${requests_channel}`)
      handle_request(client, payload as string, display)
    })
    logger.info(`[${region}] Subscribed to ${requests_channel}`)

    reconnect_delay = RECONNECT_DELAY_MS
    return client
  }

  function schedule_reconnect() {
    logger.info(`[${region}] Reconnecting in ${reconnect_delay / 1000}s...`)
    setTimeout(async () => {
      try {
        await connect_and_subscribe()
        logger.ready(`[${region}] Reconnected.`)
      } catch (error) {
        logger.error(`[${region}] Reconnection failed: ${error}`)
        reconnect_delay = Math.min(reconnect_delay * 2, MAX_RECONNECT_DELAY_MS)
        schedule_reconnect()
      }
    }, reconnect_delay)
  }

  await connect_and_subscribe()
}

async function handle_request(
  client: AppSyncEventWebSocketClient,
  payload: string,
  display?: TerminalDisplay
): Promise<void> {
  return with_lock(async () => {
  let request_id: string | undefined
  try {
    const parsed = JSON.parse(payload)
    request_id = parsed.request_id
    const { context, event_payload: event } = parsed
    logger.debug(`Processing request: ${request_id}`)

    const response = await execute_handler(event, context, display)
    logger.debug(`Handler returned response for request: ${request_id}`)

    const response_channel = `/${APPSYNC_EVENTS_API_NAMESPACE}/response/${request_id}`
    // Ensure the response is a valid JSON value — undefined/null produces
    // invalid JSON strings that AppSync rejects during publish validation.
    await client.publish(response_channel, [response ?? null])
    logger.debug(`Published response to ${response_channel}`)
  } catch (error) {
    logger.error(`Error in handle_request: ${error}`)

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
  })
}
