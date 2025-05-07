import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'

interface ResponseBody {
  message: string
  input?: APIGatewayProxyEventV2
}

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  console.log('Event received:', JSON.stringify(event, null, 2))

  const response_body: ResponseBody = {
    message: 'Hello from your Lambda Function URL!',
    // Uncomment to see the event in the response for debugging
    // input: event,
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(response_body),
  }
}
