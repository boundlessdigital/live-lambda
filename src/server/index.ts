import 'colors'
import { AppSyncEventWebSocketClient } from '@boundlessdigital/aws-appsync-events-websockets-client'
import { APPSYNC_EVENTS_API_NAMESPACE } from '../constants.js'

interface ServerConfig {
  region: string
  http: string
  realtime: string
  layer_arn: string
  profile?: string // Add profile
}

export async function serve(config: ServerConfig): Promise<void> {
  console.log('Starting LiveLambda server...'.yellow)

  const client = new AppSyncEventWebSocketClient(config)

  const requests_channel = `/${APPSYNC_EVENTS_API_NAMESPACE}/requests`

  await client.connect()

  await client.subscribe(requests_channel, async (data) => {
    // Load lambda code
    // Grab permissions

    const parsed_data = JSON.parse(data)
    console.log(`Received data in proxy server ${requests_channel}:`.cyan)
    console.log(parsed_data)

    const request_id = parsed_data.request_id
    const response = await execute_handler(parsed_data)

    const response_channel = `/${APPSYNC_EVENTS_API_NAMESPACE}/response/${request_id}`
    await client.publish(response_channel, [response])
    console.log(`Published response to proxy server ${response_channel}:`.cyan)
    console.log(response)
  })

  // await runtime.changee(async (path) => {

  //   await relaod_module(path)

  // })
}

async function execute_handler(request: object) {
  let response = {
    tag: 'processed through lambda proxy',
    request
  }
  return response
}
