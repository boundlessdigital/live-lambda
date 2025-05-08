import { HttpRequest } from '@aws-sdk/protocol-http';
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Handler } from 'aws-lambda';
import { URL } from 'url'; // For parsing URL
import { randomUUID } from 'crypto'; // For unique invocation ID if needed

// Retrieve environment variables with fallbacks or assertions for critical ones
const aws_region_env = process.env.AWS_REGION || 'us-west-1';
const appsync_event_api_url_env = process.env.APPSYNC_EVENT_API_URL;
// const appsync_channel_namespace_env = process.env.APPSYNC_CHANNEL_NAMESPACE; // No longer needed for fixed channel
// const local_instance_id_for_proxy_env = process.env.LOCAL_INSTANCE_ID_FOR_PROXY || 'localInstance_01'; // No longer needed for fixed channel

const FIXED_PUBLISH_CHANNEL = 'liveLambda/tunnel';

// All top-level consts that depend on env vars that might not be set at import time
// should be initialized inside the handler or functions that are called by the handler.

async function sign_and_publish_event(
  channel_name: string,
  event_payload: any,
  appsync_api_url_param: string, 
  region_param: string 
) {
  console.log(`Attempting to publish to channel: ${channel_name}`);
  console.log(`Event payload: ${JSON.stringify(event_payload)}`);

  const { defaultProvider } = await import('@aws-sdk/credential-provider-node');
  const credential_provider = defaultProvider();

  const signer = new SignatureV4({
    credentials: credential_provider,
    region: region_param, // Use passed region
    service: 'appsync',
    sha256: Sha256,
  });

  const parsed_url = new URL(appsync_api_url_param); // Use passed URL

  const request_body_object = {
    channel: channel_name,
    events: [JSON.stringify(event_payload)],
  };
  const stringified_request_body = JSON.stringify(request_body_object);

  const request_to_sign = new HttpRequest({
    method: 'POST',
    protocol: parsed_url.protocol,
    hostname: parsed_url.hostname,
    path: parsed_url.pathname,
    headers: {
      'Content-Type': 'application/json',
      host: parsed_url.hostname,
      'Content-Length': Buffer.byteLength(stringified_request_body).toString(),
    },
    body: stringified_request_body,
  });

  try {
    console.log('[DEBUG] Request to sign (pre-signature):', {
      method: request_to_sign.method,
      protocol: request_to_sign.protocol,
      hostname: request_to_sign.hostname,
      path: request_to_sign.path,
      headers: request_to_sign.headers,
      bodyPreview: stringified_request_body.substring(0, 200) + (stringified_request_body.length > 200 ? '...' : ''),
    });

    const signed_request = await signer.sign(request_to_sign);

    console.log('[DEBUG] Signed request headers:', signed_request.headers);

    console.log(
      `Attempting to send request to ${parsed_url.protocol}//${parsed_url.hostname}${parsed_url.pathname}...`,
    );

    const response = await fetch(appsync_api_url_param, {
      method: 'POST',
      headers: signed_request.headers as any, // Type assertion for fetch headers
      body: stringified_request_body,
    });

    const response_body_text = await response.text();
    console.log('--- AppSync Response ---');
    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log(`Body: ${response_body_text}`);

    if (!response.ok) {
      console.error('[FAILURE] Failed to publish event.');
      try {
        const parsed_error = JSON.parse(response_body_text);
        console.error('Parsed error details:', parsed_error);
        return { success: false, statusCode: response.status, error: parsed_error };
      } catch (e) {
        console.error('Failed to parse error response body:', e);
        return { success: false, statusCode: response.status, error: response_body_text };
      }
    }
    console.log('[SUCCESS] Event published successfully.');
    return { success: true, statusCode: response.status, body: response_body_text };
  } catch (error: any) {
    console.error('Error during sign and publish process:', error);
    return { success: false, statusCode: 500, error: error.message || error };
  }
}

// Corrected Handler type annotation
export const handler: Handler<APIGatewayProxyEventV2, APIGatewayProxyResultV2> = async (event, context) => {
  console.log('Stub Lambda invoked');
  console.log('Incoming Event (first 200 chars):', JSON.stringify(event).substring(0,200));
  // console.log('Context:', JSON.stringify(context, null, 2)); // Keep if needed

  // Moved environment variable check inside the handler
  if (!appsync_event_api_url_env) { // APPSYNC_CHANNEL_NAMESPACE no longer strictly needed here for fixed channel
    console.error(
      'Missing required environment variables: APPSYNC_EVENT_API_URL',
    );
    return {
      statusCode: 500,
      body: JSON.stringify({
        error:
          'Lambda proxy misconfiguration: missing APPSYNC_EVENT_API_URL environment variable',
      }),
    };
  }

  const invocation_id = context.awsRequestId || randomUUID();

  // Use the fixed channel name for publishing the invocation request
  const request_publish_channel_name = FIXED_PUBLISH_CHANNEL;
  
  const invocation_payload = {
    invocationId: invocation_id,
    event: event,       // The actual event received by the stub Lambda
    context: context    // The context object of the stub Lambda's invocation
  };
  
  console.log(`Attempting to publish invocation to: ${request_publish_channel_name}`);
  console.log(`Invocation Payload (event part, first 200 chars): ${JSON.stringify(invocation_payload.event).substring(0,200)}`);
  
  const publish_result = await sign_and_publish_event(
    request_publish_channel_name, 
    invocation_payload,
    appsync_event_api_url_env, 
    aws_region_env 
  );

  if (publish_result.success) {
    console.log(`Successfully published invocation ${invocation_id} to ${request_publish_channel_name}`);
    return {
      statusCode: 200, // Or 202 if you prefer for accepted
      body: JSON.stringify({
        message: "Stub Lambda successfully processed and published the event for local dev server.",
        invocationId: invocation_id,
        publishedToChannel: request_publish_channel_name,
        // appsyncResponse: publish_result.body // Potentially too verbose
      }),
    };
  } else {
    console.error(`Failed to publish invocation ${invocation_id} to ${request_publish_channel_name}`);
    return {
      statusCode: 500, 
      body: JSON.stringify({
        message: "Stub Lambda FAILED to publish the event for local dev server.",
        invocationId: invocation_id,
        targetChannel: request_publish_channel_name,
        errorDetails: publish_result.error,
        appsyncStatusCode: publish_result.statusCode,
      }),
    };
  }
};
