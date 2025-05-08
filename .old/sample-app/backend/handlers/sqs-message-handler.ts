import { SQSEvent, SQSHandler, Context } from 'aws-lambda';

// Remember to keep your function names and variables in snake_case
// as per user preference.
export const handler: SQSHandler = async (event: SQSEvent, context: Context): Promise<void> => {
  console.log(`SQS Event received by function ${context.functionName}:`);
  console.log(JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const message_id = record.messageId;
    const message_body = record.body;
    console.log(`Processing message ${message_id} with body: ${message_body}`);

    // Simulate some processing
    // In a real application, you would do something meaningful with the message_body here
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate async work

    console.log(`Successfully processed message ${message_id}`);
  }
  console.log('Finished processing all SQS messages in this batch.');
};
