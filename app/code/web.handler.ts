import { APIGatewayProxyEventV2 } from 'aws-lambda'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'

export const handler = async (event: APIGatewayProxyEventV2) => {
  console.log('Web Lambda invoked')
  console.log(
    'Incoming Event (first 200 chars):',
    JSON.stringify(event).substring(0, 200)
  )

  const queueUrl = process.env.QUEUE_URL
  if (!queueUrl) {
    console.error('Missing QUEUE_URL environment variable')
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Missing QUEUE_URL environment variable'
      })
    }
  }

  const sqsClient = new SQSClient({ region: 'us-west-1' })
  const command = new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(event)
  })
  await sqsClient.send(command)

  console.log('Event sent to SQS queue')

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Web Lambda processed the event successfully'
    })
  }
}
