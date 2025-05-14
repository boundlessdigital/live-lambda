import { ViteDevServer } from 'vite';
import { createClient, Client, SubscribePayload } from 'graphql-ws'; // Using graphql-ws for subscriptions
import { generateAuthInfo, SignedRequest } from '../../shared/signing'; // Assuming this is the path and function, and SignedRequest type
import { executeLambdaHandler } from './lambda-executor';
import WebSocket from 'ws'; // Import ws library for custom WebSocket implementation
import { LambdaManifest, AppSyncEvent } from './types';
import { config } from './config'; // Added import

let gqlClient: Client | null = null;

// Helper function to build connection parameters
async function _buildConnectionParams(
  appSyncRealtimeEndpointWss: string,
  appSyncHost: string,
  awsRegion: string
): Promise<{ headers: Record<string, string> } | undefined> { 
  try {
    const signedRequest: SignedRequest = await generateAuthInfo(
      appSyncRealtimeEndpointWss, // Use passed param
      awsRegion, // Use passed param
      { query: '', variables: {} },
      'wss'
    );

    const authHeaders: Record<string, string> = {
      host: appSyncHost, // Use passed param
      Authorization: signedRequest.headers.Authorization,
      'X-Amz-Date': signedRequest.headers['X-Amz-Date'],
    };
    if (signedRequest.headers['X-Amz-Security-Token']) {
      authHeaders['X-Amz-Security-Token'] = signedRequest.headers['X-Amz-Security-Token'];
    }
    return { headers: authHeaders };
  } catch (error) {
    console.error('Error generating auth info for AppSync connection:', error);
    return undefined; // Indicate failure
  }
}

// Helper function to process incoming AppSync events
async function _processAppSyncEvent(
  eventData: AppSyncEvent,
  lambdaManifest: LambdaManifest,
  viteServer: ViteDevServer
): Promise<void> {
  if (!eventData || !eventData.lambdaLogicalId) {
    console.warn('Received empty or malformed data from AppSync subscription:', eventData);
    return;
  }

  console.log(`[${eventData.awsRequestId}] Received event for Lambda: ${eventData.lambdaLogicalId}`);

  const manifestEntry = lambdaManifest[eventData.lambdaLogicalId];
  if (manifestEntry) {
    try {
      const result = await executeLambdaHandler(
        viteServer,
        manifestEntry,
        eventData.eventPayload,
        eventData.awsRequestId
      );
      console.log(`[${eventData.awsRequestId}] Handler for ${eventData.lambdaLogicalId} returned:`, result);
      // TODO: Optionally send response back via another AppSync channel if needed
    } catch (executionError) {
      console.error(`[${eventData.awsRequestId}] Error executing handler for ${eventData.lambdaLogicalId}:`, executionError);
      // TODO: Optionally send error back via AppSync
    }
  } else {
    console.warn(`[${eventData.awsRequestId}] No manifest entry found for Lambda: ${eventData.lambdaLogicalId}. Event not processed.`);
  }
}

// Helper function to set up the AppSync subscription
async function _handleAppSyncSubscription(
  currentGqlClient: Client,
  lambdaManifest: LambdaManifest,
  viteServer: ViteDevServer
) {
  const APPSYNC_PROXY_REQUEST_NAMESPACE = config.appSync.proxyRequestNamespace;
  console.log(`Subscribing to AppSync channel namespace: ${APPSYNC_PROXY_REQUEST_NAMESPACE}`);

  const subscriptionQuery = `subscription OnLambdaEvent {
    subscribeToLambdaEvents(channelNamespace: "${APPSYNC_PROXY_REQUEST_NAMESPACE}") {
      awsRequestId
      lambdaLogicalId
      eventPayload
      lambdaContext
    }
  }`;

  try {
    const unsubscribe = currentGqlClient.subscribe(
      {
        query: subscriptionQuery,
      } as SubscribePayload, // Cast to SubscribePayload if needed by graphql-ws version
      {
        next: async (data) => {
          // @ts-ignore - data structure from AppSync might be nested
          const eventData = data.data?.subscribeToLambdaEvents as AppSyncEvent;
          await _processAppSyncEvent(eventData, lambdaManifest, viteServer);
        },
        error: (error) => {
          console.error('AppSync subscription error:', error);
        },
        complete: () => {
          console.log('AppSync subscription completed.');
        },
      }
    );
    console.log(`Subscribed to AppSync channel namespace '${APPSYNC_PROXY_REQUEST_NAMESPACE}'. Waiting for events...`);
    // To stop subscription: if (unsubscribe) unsubscribe(); -> manage this if needed for dynamic unsubscriptions
  } catch (err) {
    console.error('Failed to start AppSync subscription:', err);
  }
}

export async function initializeAppSyncClient(
  lambdaManifest: LambdaManifest,
  viteServer: ViteDevServer,
  appSyncRealtimeEndpointWss: string,
  appSyncHost: string,
  awsRegion: string
) {
  if (!appSyncRealtimeEndpointWss || !appSyncHost || !awsRegion) { // Region check is implicit in config loading
    console.error('AppSync URL, host, or AWS region not provided via config. Cannot connect.');
    return;
  }

  console.log(`Initializing AppSync client for URL: ${appSyncRealtimeEndpointWss}`);

  const connectionParamsObject = await _buildConnectionParams(
    appSyncRealtimeEndpointWss,
    appSyncHost,
    awsRegion
  ); // No args needed
  if (!connectionParamsObject) {
    console.error('Could not build connection parameters for AppSync. Client will not be initialized.');
    return;
  }

  gqlClient = createClient({
    url: appSyncRealtimeEndpointWss,
    webSocketImpl: WebSocket,
    connectionParams: () => Promise.resolve(connectionParamsObject), // Ensure it's a function returning a Promise or the object directly
    shouldRetry: () => true,
    keepAlive: 12000,
    on: {
      connected: (socket) => {
        console.log('AppSync WebSocket connected!');
        // Now that we are connected, set up the subscription
        if (gqlClient) { // Ensure gqlClient is not null (it should be set by now)
            _handleAppSyncSubscription(gqlClient, lambdaManifest, viteServer);
        }
      },
      error: (err) => console.error('AppSync WebSocket error:', err),
      closed: (event) => console.log('AppSync WebSocket closed:', event),
    }
  });
}

export function closeAppSyncClient() {
  if (gqlClient) {
    console.log('Closing AppSync client connection...');
    gqlClient.terminate();
    gqlClient = null;
  }
}
