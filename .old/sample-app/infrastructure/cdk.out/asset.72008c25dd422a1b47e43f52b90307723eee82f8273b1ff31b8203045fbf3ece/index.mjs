// backend/handlers/sqs-message-handler.ts
var handler = async (event, context) => {
  console.log(`SQS Event received by function ${context.functionName}:`);
  console.log(JSON.stringify(event, null, 2));
  for (const record of event.Records) {
    const message_id = record.messageId;
    const message_body = record.body;
    console.log(`Processing message ${message_id} with body: ${message_body}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log(`Successfully processed message ${message_id}`);
  }
  console.log("Finished processing all SQS messages in this batch.");
};
export {
  handler
};
//# sourceMappingURL=index.mjs.map
