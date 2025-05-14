// /Users/sidney/boundless/live-lambda/dev/infrastructure/lambda/live-lambda.layer.ts

import { AppSyncClient, PublishCommand } from '@aws-sdk/client-appsync';
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import WebSocket from 'ws'; // Using 'ws' library for WebSocket client

// Define a timeout for waiting for the response from the local server
const RESPONSE_TIMEOUT_MS = 25000; // 25 seconds, Lambda max is often 30s

interface AppSyncConnectionParams {
  url: string;
  headers: {
    host: string;
    'X-Amz-Date': string;
    Authorization: string;
  };
}

interface OriginalLambdaContext {
  // Define relevant properties from AWS Lambda context if needed by the original handler
  functionName?: string;
  functionVersion?: string;
  invokedFunctionArn?: string;
  memoryLimitInMB?: string;
  awsRequestId?: string;
  logGroupName?: string;
  logStreamName?: string;
  getRemainingTimeInMillis?(): number;
  // Add other context properties if your original handlers use them
}

// Helper function to build signed AppSync WebSocket connection URL
const build_appsync_ws_url_and_headers = async (
  appsyncRealtimeUrl: string, // e.g., wss://<id>.appsync-realtime-api.<region>.amazonaws.com/graphql
  awsRegion: string,
  appsyncHost: string // e.g., <id>.appsync-realtime-api.<region>.amazonaws.com
): Promise<AppSyncConnectionParams> => {
  const endpoint = new URL(appsyncRealtimeUrl);
  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region: awsRegion,
    service: 'appsync',
    sha256: Sha256,
  });

  const request = {
    method: 'GET', // For WebSocket connection, method isn't as critical as headers
    hostname: endpoint.hostname,
    path: endpoint.pathname,
    headers: {
      host: endpoint.hostname,
    },
    protocol: endpoint.protocol,
    body: '', // Empty body for GET
  };

  const signedRequest = await signer.sign(request);

  // AppSync WebSocket needs headers in the connection URL query parameters (base64 encoded)
  const connectionParams = {
    header: signedRequest.headers, // These are the headers to use for the HTTP publish later too
    payload: {}, // Empty payload for connection
  };
  
  const base64EncodedConnectionParams = Buffer.from(JSON.stringify(connectionParams.header)).toString('base64');
  const url = `${appsyncRealtimeUrl}?header=${base64EncodedConnectionParams}&payload=e30=`; // e30= is base64 of {}

  return {
    url,
    headers: signedRequest.headers as any, // For HTTP publish later
  };
};


const sign_and_publish_event = async (
    appsyncApiId: string,
    awsRegion: string,
    channelNamespace: string,
    functionLogicalId: string,
    channelSuffix: string, // e.g., 'request' or a unique response ID
    data: any,
    appsyncHostForHttp: string // e.g. <id>.appsync-api.<region>.amazonaws.com
) => {
    const client = new AppSyncClient({ region: awsRegion });
    const channelName = `${channelNamespace}/${functionLogicalId}/${channelSuffix}`;
    
    console.log(`Publishing to AppSync channel: ${channelName}`);

    // The AppSync HTTP Event API endpoint structure
    const appsyncHttpApiUrl = `https://${appsyncHostForHttp}/event/namespaces/${channelNamespace}/channels/${functionLogicalId}/${channelSuffix}`;


    const signer = new SignatureV4({
        credentials: defaultProvider(),
        region: awsRegion,
        service: 'appsync',
        sha256: Sha256,
    });

    const url = new URL(appsyncHttpApiUrl);

    const requestToBeSigned = {
        method: 'POST',
        hostname: url.hostname,
        path: url.pathname,
        protocol: url.protocol,
        headers: {
            'Content-Type': 'application/json',
            host: url.hostname, 
        },
        body: JSON.stringify(data),
    };

    const signedRequest = await signer.sign(requestToBeSigned);

    try {
        const response = await fetch(appsyncHttpApiUrl, {
            method: 'POST',
            headers: signedRequest.headers,
            body: JSON.stringify(data),
        });

        const responseBody = await response.text(); // Use text() first to see raw response
        console.log(`AppSync publish status: ${response.status}, body: ${responseBody}`);
        if (!response.ok) {
            throw new Error(`AppSync publish failed: ${response.status} - ${responseBody}`);
        }
        return JSON.parse(responseBody); // Or handle as needed
    } catch (error) {
        console.error('Error publishing to AppSync:', error);
        throw error;
    }
};


export const handler = async (event: any, context: OriginalLambdaContext) => {
  console.log('Live Lambda Layer Wrapper invoked.');
  console.log('Event:', JSON.stringify(event, null, 2));
  // console.log('Context:', JSON.stringify(context, null, 2)); // Be careful with context logging

  const liveLambdaActive = process.env.LIVE_LAMBDA_ACTIVE === 'true';
  const originalHandlerPath = process.env.LIVE_LAMBDA_ORIGINAL_HANDLER_PATH; // e.g., 'index.handler'
  const appsyncApiId = process.env.LIVE_LAMBDA_APPSYNC_API_ID;
  const appsyncChannelNamespace = process.env.LIVE_LAMBDA_APPSYNC_CHANNEL_NAMESPACE;
  const functionLogicalId = process.env.LIVE_LAMBDA_FUNCTION_LOGICAL_ID;
  const awsRegion = process.env.AWS_REGION;

  if (!originalHandlerPath) {
    console.error('LIVE_LAMBDA_ORIGINAL_HANDLER_PATH not set. Cannot proceed.');
    throw new Error('LIVE_LAMBDA_ORIGINAL_HANDLER_PATH not set.');
  }

  if (liveLambdaActive) {
    console.log('Live Lambda mode is ACTIVE.');
    if (!appsyncApiId || !appsyncChannelNamespace || !functionLogicalId || !awsRegion) {
      console.error('One or more AppSync environment variables are not set for live mode.');
      throw new Error('Missing AppSync configuration for live mode.');
    }

    const requestId = context.awsRequestId || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const responseChannelSuffix = `response/${requestId}`;
    const requestChannelSuffix = 'request';
    
    // Derive AppSync hosts (assuming standard CDK output formats or known patterns)
    // For Event APIs:
    // HTTP Publish Endpoint: <api-id>.appsync-api.<region>.amazonaws.com
    // Realtime (WebSocket) Endpoint: <api-id>.appsync-realtime-api.<region>.amazonaws.com
    const appsyncHttpHost = `${appsyncApiId}.appsync-api.${awsRegion}.amazonaws.com`;
    const appsyncRealtimeHost = `${appsyncApiId}.appsync-realtime-api.${awsRegion}.amazonaws.com`;
    const appsyncRealtimeUrl = `wss://${appsyncRealtimeHost}/graphql`;


    return new Promise(async (resolve, reject) => {
      let ws: WebSocket | null = null;
      let timeoutId: NodeJS.Timeout | null = null;

      try {
        console.log(`Attempting to connect to AppSync WebSocket: ${appsyncRealtimeUrl}`);
        const { url: signedWsUrl } = await build_appsync_ws_url_and_headers(
          appsyncRealtimeUrl,
          awsRegion,
          appsyncRealtimeHost
        );
        
        ws = new WebSocket(signedWsUrl, ['graphql-ws']); // 'graphql-ws' is the subprotocol for AppSync

        ws.onopen = async () => {
          console.log('AppSync WebSocket connection established.');

          // 1. Send connection_init message
          ws?.send(JSON.stringify({ type: 'connection_init' }));
          
          // 2. Subscribe to the unique response channel
          const subscriptionId = `sub-${requestId}`;
          const subscribePayload = {
            id: subscriptionId,
            type: 'start',
            payload: {
              data: JSON.stringify({
                query: `subscription OnResponse { onEvent(channel: "${appsyncChannelNamespace}/${functionLogicalId}/${responseChannelSuffix}") }`,
                variables: {}
              }),
              extensions: {
                authorization: { // This needs to be correctly structured for AppSync subscriptions
                  // For IAM auth, the headers are in the WebSocket URL.
                  // This structure might be for API_KEY or OIDC. For IAM, it's often implicit via the signed URL.
                  // Let's assume the signed URL is sufficient for IAM for now.
                  // host: appsyncRealtimeHost, // Already in signed URL
                }
              }
            }
          };
          console.log(`Sending subscription request for channel: ${appsyncChannelNamespace}/${functionLogicalId}/${responseChannelSuffix}`);
          ws?.send(JSON.stringify(subscribePayload));

          // Set timeout for the response
          timeoutId = setTimeout(() => {
            console.error('Timeout waiting for response from local server.');
            ws?.close(1008, "Response timeout"); // 1008: Policy Violation or similar
            reject(new Error('Timeout waiting for response from local server via AppSync.'));
          }, RESPONSE_TIMEOUT_MS);
        };

        ws.onmessage = (message) => {
          console.log('Received message from AppSync WebSocket:', message.data.toString());
          const data = JSON.parse(message.data.toString());

          if (data.type === 'connection_ack') {
            console.log('AppSync WebSocket connection_ack received. Ready to publish.');
            // Now that subscription is likely established (or in progress), publish the event.
            // Note: AppSync Event API uses HTTP POST for publishing, not WebSocket.
            const requestPayload = {
              event,
              // context: simplifiedContext, // Send only necessary, serializable context
              lambda_request_id: context.awsRequestId,
              response_channel_suffix: responseChannelSuffix,
              function_logical_id: functionLogicalId, // For local server to map
            };
            console.log(`Publishing original event to AppSync channel: ${appsyncChannelNamespace}/${functionLogicalId}/${requestChannelSuffix}`);
            sign_and_publish_event(
              appsyncApiId,
              awsRegion,
              appsyncChannelNamespace,
              functionLogicalId,
              requestChannelSuffix,
              requestPayload,
              appsyncHttpHost
            ).catch(publishError => {
                console.error('Failed to publish event to AppSync:', publishError);
                if (timeoutId) clearTimeout(timeoutId);
                ws?.close(1011, "Publish error"); // 1011: Internal Error
                reject(publishError);
            });
            return; // Wait for 'start_ack' or data
          }
          
          if (data.type === 'start_ack') {
            console.log(`Subscription acknowledged for ID: ${data.id}`);
            // Publish could also happen here if we strictly wait for start_ack
          }

          if (data.type === 'data' && data.payload && data.payload.data && data.payload.data.onEvent) {
            console.log('Received data on subscribed channel (response from local server).');
            if (timeoutId) clearTimeout(timeoutId);
            const responseFromLocal = data.payload.data.onEvent; // This should be the actual Lambda response
            ws?.close(1000, "Response received"); // 1000: Normal Closure
            resolve(responseFromLocal);
          } else if (data.type === 'error') {
            console.error('AppSync WebSocket error message:', data.payload);
            if (timeoutId) clearTimeout(timeoutId);
            ws?.close(1011, "AppSync error reported");
            reject(new Error(`AppSync error: ${JSON.stringify(data.payload)}`));
          }
        };

        ws.onerror = (error) => {
          console.error('AppSync WebSocket error:', error.message);
          if (timeoutId) clearTimeout(timeoutId);
          reject(new Error(`AppSync WebSocket error: ${error.message}`));
        };

        ws.onclose = (event) => {
          console.log(`AppSync WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}`);
          if (timeoutId) clearTimeout(timeoutId); // Ensure timeout is cleared
          // If not resolved yet, it means closure was unexpected or due to timeout handled above
          // reject(new Error(`WebSocket closed prematurely. Code: ${event.code}, Reason: ${event.reason}`));
        };

      } catch (err) {
        console.error('Error in live lambda forwarding logic:', err);
        if (timeoutId) clearTimeout(timeoutId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close(1011, "Internal layer error");
        }
        reject(err);
      }
    });

  } else {
    console.log('Live Lambda mode is INACTIVE. Executing original handler.');
    const handlerParts = originalHandlerPath.split('.');
    if (handlerParts.length < 2) {
      console.error(`Invalid original handler format: ${originalHandlerPath}. Expected 'filename.handlerName'.`);
      throw new Error(`Invalid original handler format: ${originalHandlerPath}.`);
    }
    const [modulePath, handlerName] = handlerParts;
    
    // IMPORTANT: The modulePath needs to be resolvable from where this layer code runs.
    // In Lambda, this means the original handler's code must be accessible.
    // This typically works because layers are extracted to /opt, and the function code is elsewhere,
    // but Node.js's `require` can usually find modules if the path is correct relative to the root of the function's code.
    // We assume `modulePath` (e.g., 'index' from 'index.handler') is at the root of the Lambda code package.
    // If your original handlers are in subdirectories (e.g., 'src/handlers/myHandler.handler'),
    // LIVE_LAMBDA_ORIGINAL_HANDLER_PATH should reflect that (e.g., 'src/handlers/myHandler.handler').
    try {
      // process.env.LAMBDA_TASK_ROOT is '/var/task' where the original function code is
      const originalModule = require(process.env.LAMBDA_TASK_ROOT + '/' + modulePath);
      if (typeof originalModule[handlerName] !== 'function') {
        console.error(`Handler '${handlerName}' not found or not a function in module '${modulePath}'.`);
        throw new Error(`Handler '${handlerName}' not found in '${modulePath}'.`);
      }
      console.log(`Executing original handler: ${modulePath}.${handlerName}`);
      return await originalModule[handlerName](event, context);
    } catch (error) {
      console.error(`Error loading or executing original handler '${originalHandlerPath}':`, error);
      throw error;
    }
  }
};