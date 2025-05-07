// backend/handlers/my-url-handler.ts
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
var sqs_client = new SQSClient({});
async function handler(event) {
  console.log("Event received:", JSON.stringify(event, null, 2));
  const sqs_queue_url = process.env.SQS_QUEUE_URL;
  let sqs_send_status = "SQS_QUEUE_URL not configured or message not sent.";
  if (sqs_queue_url) {
    try {
      const message_body_content = {
        event_path: event.rawPath,
        query_params: event.queryStringParameters,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        message: "Hello from MyUrlLambda, triggering SQS processing!"
      };
      const send_command = new SendMessageCommand({
        QueueUrl: sqs_queue_url,
        MessageBody: JSON.stringify(message_body_content)
        // MessageGroupId: 'my-message-group', // Required for FIFO queues
        // MessageDeduplicationId: event.requestContext.requestId, // Required for FIFO queues, good for idempotency
      });
      const send_result = await sqs_client.send(send_command);
      console.log("Message sent to SQS successfully:", send_result.MessageId);
      sqs_send_status = `Message sent to SQS, ID: ${send_result.MessageId}`;
    } catch (error) {
      console.error("Error sending message to SQS:", error);
      sqs_send_status = `Error sending to SQS: ${error.message}`;
    }
  } else {
    console.warn("SQS_QUEUE_URL environment variable is not set. Cannot send message.");
  }
  const response_body = {
    message: "Hello from your Lambda Function URL!",
    sqs_send_status
    // Uncomment to see the event in the response for debugging
    // input: event,
  };
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(response_body)
  };
}
export {
  handler
};
//# sourceMappingURL=index.mjs.map
