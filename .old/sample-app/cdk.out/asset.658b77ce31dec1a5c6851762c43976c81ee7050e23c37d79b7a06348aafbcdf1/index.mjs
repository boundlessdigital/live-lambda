import { fileURLToPath } from 'url';\nimport { dirname, join } from 'path';\nconst __filename = fileURLToPath(import.meta.url);\nconst __dirname = dirname(__filename);\nimport { Buffer } from 'buffer'; global.Buffer = Buffer;

// tunnel/src/lambda-proxy/handler.ts
var handler = async (event, context) => {
  console.log("LAMBDA PROXY: Event received:", JSON.stringify(event, null, 2));
  console.log("LAMBDA PROXY: Context received:", JSON.stringify(context, null, 2));
  const appsync_event_api_url = process.env.APPSYNC_EVENT_API_URL;
  const appsync_channel_namespace = process.env.APPSYNC_CHANNEL_NAMESPACE;
  const region = process.env.AWS_REGION;
  if (!appsync_event_api_url || !appsync_channel_namespace || !region) {
    console.error("LAMBDA PROXY: Missing required environment variables for AppSync publishing.");
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "LAMBDA PROXY: Configuration error." }),
      headers: { "Content-Type": "application/json" }
    };
  }
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "LAMBDA PROXY WAS DEFINITELY INVOKED!",
      invoked_function_arn: context.invokedFunctionArn,
      event_received: event
    }),
    headers: { "Content-Type": "application/json" }
  };
};
export {
  handler
};
