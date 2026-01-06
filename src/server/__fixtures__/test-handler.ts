import type { APIGatewayProxyEventV2, Context } from 'aws-lambda'

export const handler = async (event: APIGatewayProxyEventV2, context: Context) => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Hello from test handler',
      received_event: event,
      function_name: context.functionName
    })
  }
}

export const async_handler = async (event: APIGatewayProxyEventV2) => {
  // Simulate async work
  await new Promise(resolve => setTimeout(resolve, 10))
  return {
    statusCode: 201,
    body: JSON.stringify({ async: true, path: event.rawPath })
  }
}

export const error_handler = async () => {
  throw new Error('Intentional test error')
}

export const returning_undefined = async () => {
  // Handler that returns nothing
}

// Non-function export to test validation
export const not_a_handler = 'I am a string, not a function'
