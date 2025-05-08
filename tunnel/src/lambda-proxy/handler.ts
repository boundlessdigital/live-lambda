import { Handler, Context, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

// This is the handler for the Lambda function that acts as a proxy when live lambda mode is active.
// It logs the incoming event and context, and returns a hardcoded response.
// In future iterations, this handler will communicate with the local development server
// to get the actual response from the locally running Lambda code.
export const handler: Handler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('LAMBDA PROXY: Event received:', JSON.stringify(event, null, 2))
  console.log('LAMBDA PROXY: Context received:', JSON.stringify(context, null, 2))

  // Return a simple success response indicating the proxy was called.
  // The actual business logic will be executed by the local server in later stages.
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Hello from the LAMBDA PROXY! Your request has been tunnelled (conceptually).',
      original_event: event, // Echo back the event for debugging purposes
    }),
    headers: {
      'Content-Type': 'application/json',
    },
  }
}
