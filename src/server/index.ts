import 'colors'
import { AppSyncEventWebSocketClient } from '@boundlessdigital/aws-appsync-events-websockets-client'
import { APPSYNC_EVENTS_API_NAMESPACE } from '../constants.js'
import * as runtime from './runtime.js'
import * as path from 'node:path'

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
    const parsed_data = JSON.parse(data)
    console.log(`Received data in proxy server ${requests_channel}:`.cyan)
    console.log(parsed_data)

    const request_id = parsed_data.request_id
    // const response = await execute_handler(parsed_data)
    const response = { response: 'Hello World' }

    const response_channel = `/${APPSYNC_EVENTS_API_NAMESPACE}/response/${request_id}`
    await client.publish(response_channel, [response])
    console.log(`Published response to proxy server ${response_channel}:`.cyan)
    console.log(response)
  })
}

// Define the expected structure of the request from the AppSync subscription
interface ProxiedLambdaInvocation {
  request_id: string // The request_id for AppSync response channel
  target_function_name: string // Deployed name of the Lambda function (e.g., MyStack-MyFunction-Resource-XYZ)
  event_payload: any // The actual event payload for the Lambda
  // lambda_context?: any; // Optional: if the original AWS Lambda context is also sent
}

// async function execute_handler(request: ProxiedLambdaInvocation): Promise<any> {
//   const { target_function_name, event_payload, request_id } = request

//   // Determine manifest path. Assumes server runs from project root where cdk.out is.
//   const project_root_dir = process.cwd()
//   const manifest_path = path.join(project_root_dir, 'cdk.out', 'outputs.json')

//   console.log(
//     `[Server] Executing handler for ${target_function_name} using manifest ${manifest_path}`
//       .blue
//   )

//   try {
//     const { handler, mapping_entry } = await runtime.load_handler(
//       target_function_name,
//       manifest_path
//     )

//     // runtime.load_handler throws if not found, so handler and mapping_entry should be valid here.

//     const local_context = runtime.create_local_handler_context(
//       target_function_name, // For context.functionName
//       event_payload, // For potential context.awsRequestId extraction
//       mapping_entry // For role_arn and project_root
//     )

//     console.log(
//       `[Server] Invoking local handler for ${target_function_name} with event:`
//         .gray,
//       event_payload
//     )
//     console.log(
//       `[Server] Local context for ${target_function_name}:`.gray,
//       local_context
//     )
//     const result = await handler(event_payload, local_context)
//     console.log(
//       `[Server] Local handler for ${target_function_name} completed. Result:`
//         .green,
//       result
//     )
//     return result
//   } catch (error: any) {
//     console.error(
//       `[Server] Error executing handler for ${target_function_name}:`.red,
//       error
//     )
//     // Format error similar to how AWS Lambda would
//     return {
//       errorType: error.name || 'Error',
//       errorMessage:
//         error.message || 'An unknown error occurred during local execution.',
//       stackTrace: error.stack ? error.stack.split('\n') : undefined,
//       request_id_processed: request_id // Include for traceability
//     }
//   }
// }
