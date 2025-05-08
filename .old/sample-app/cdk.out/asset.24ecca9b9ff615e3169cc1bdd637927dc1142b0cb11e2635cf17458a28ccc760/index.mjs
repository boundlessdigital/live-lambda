import { createRequire } from 'module'; const require = createRequire(import.meta.url);

// tunnel/dist/lambda-proxy/handler.js
import { SignatureV4 } from "@aws-sdk/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import { URL } from "url";
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
  try {
    const parsed_url = new URL(appsync_event_api_url);
    const hostname = parsed_url.hostname;
    const path = parsed_url.pathname;
    const channel = `/${appsync_channel_namespace}/requests`;
    const appsync_message_payload = {
      id: context.awsRequestId,
      type: "publish",
      channel,
      events: [JSON.stringify(event)]
      // Original event, stringified
    };
    const signer = new SignatureV4({
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN
      },
      // Credentials will be auto-sourced from execution role in Lambda
      region,
      service: "appsync",
      sha256: Sha256
    });
    const request_to_sign = {
      method: "POST",
      hostname,
      path,
      protocol: parsed_url.protocol,
      // Should be https:
      headers: {
        "Content-Type": "application/json",
        host: hostname
        // Important for SigV4
      },
      body: JSON.stringify(appsync_message_payload)
    };
    const signed_request = await signer.sign(request_to_sign);
    console.log("LAMBDA PROXY: Publishing to AppSync channel:", channel);
    const response = await fetch(appsync_event_api_url, {
      method: signed_request.method,
      headers: signed_request.headers,
      // Cast to HeadersInit
      body: signed_request.body
    });
    const response_body = await response.text();
    if (!response.ok) {
      console.error(`LAMBDA PROXY: Failed to publish event to AppSync. Status: ${response.status}, Response: ${response_body}`);
    } else {
      console.log(`LAMBDA PROXY: Successfully published event to AppSync. Status: ${response.status}, Response: ${response_body}`);
    }
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "LAMBDA PROXY: Request processed and attempted to publish to AppSync.",
        publish_status: response.status,
        appsync_response: response_body
      }),
      headers: { "Content-Type": "application/json" }
    };
  } catch (error) {
    console.error("LAMBDA PROXY: Error publishing event to AppSync:", error);
    return {
      statusCode: 500,
      // Or 200 if we don't want to alert the original caller directly of this specific failure
      body: JSON.stringify({
        message: "LAMBDA PROXY: Failed to publish event due to an internal error.",
        error: error instanceof Error ? error.message : String(error)
      }),
      headers: { "Content-Type": "application/json" }
    };
  }
};
export {
  handler
};
//# sourceMappingURL=index.mjs.map
