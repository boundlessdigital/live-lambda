// app/code/listener.handler.ts
var handler = async (event) => {
  console.log("Listener Lambda invoked with SQS event");
  console.log(`Received ${event.Records.length} message(s).`);
  for (const record of event.Records) {
    console.log("--- SQS Message Record ---");
    console.log("Message ID:", record.messageId);
    console.log("Receipt Handle:", record.receiptHandle);
    console.log("Body (first 200 chars):", record.body.substring(0, 200));
    try {
      const messagePayload = JSON.parse(record.body);
      console.log("Parsed Message Payload:", messagePayload);
    } catch (e) {
      console.error("Failed to parse message body as JSON:", e);
    }
    console.log("--- End SQS Message Record ---");
  }
  return {
    statusCode: 200,
    // For SQS, a successful return (or no error) marks messages as processed
    body: JSON.stringify({
      message: "Listener Lambda processed SQS event successfully"
    })
  };
};
export {
  handler
};
//# sourceMappingURL=index.mjs.map
