import 'colors';
import { AppSyncEventWebSocketClient, AppSyncWebSocketClientOptions } from './websocket';
import amplifyOutputs from '../../amplify_outputs.json'; // Import the JSON file

async function main_logic(): Promise<void> {
  console.log('Starting AppSync WebSocket Client test...'.yellow);

  const httpUrl = amplifyOutputs.API.Events.endpoint;
  const region = amplifyOutputs.API.Events.region;

  // Derive realtimeUrl from httpUrl
  let realtimeUrl = httpUrl.replace('https://', 'wss://');
  realtimeUrl = realtimeUrl.replace('appsync-api', 'appsync-realtime-api');
  if (realtimeUrl.endsWith('/event')) { // Ensure we correctly append /realtime if path is just /event
    realtimeUrl = realtimeUrl + '/realtime';
  } else if (!realtimeUrl.includes('/event/realtime')) {
    // This case might occur if the endpoint format changes unexpectedly.
    // For now, we assume /event is the base path for the HTTP endpoint.
    console.warn('Unexpected AppSync HTTP endpoint format, realtime URL derivation might be incorrect.'.yellow);
    realtimeUrl = realtimeUrl.replace(/\/event([/?#]|$)/, '/event/realtime$1'); 
  }

  console.log(`Using HTTP URL: ${httpUrl}`.grey);
  console.log(`Using Realtime URL: ${realtimeUrl}`.grey);
  console.log(`Using Region: ${region}`.grey);
  if (amplifyOutputs.API.Events.defaultAuthMode === 'apiKey') {
    console.warn(
      'amplify_outputs.json specifies apiKey auth mode. This client currently uses IAM for connection & operations.'.yellow
    );
  }

  const endpointConfig: AppSyncWebSocketClientOptions['endpointConfig'] = {
    realtimeUrl: realtimeUrl,
    httpUrl: httpUrl,
    region: region,
    // profile: 'your-aws-profile' // Optional: specify if not using default or environment credentials
  };

  const client = new AppSyncEventWebSocketClient({ endpointConfig });

  const testChannel = `default/cliTestChannel/${Date.now()}`;
  let subscriptionId: string | undefined;

  try {
    console.log(`Attempting to connect to ${endpointConfig.realtimeUrl}...`.cyan);
    await client.connect();
    console.log('Successfully connected to WebSocket.'.green);

    console.log(`Subscribing to channel: ${testChannel}`.cyan);
    subscriptionId = await client.subscribe(testChannel, (data) => {
      console.log(`Received data on ${testChannel}:`.magenta, JSON.stringify(data, null, 2));
    });
    console.log(`Successfully subscribed to ${testChannel} with ID: ${subscriptionId}`.green);

    // Wait a moment for subscription to be fully established on the backend
    await new Promise(resolve => setTimeout(resolve, 2000));

    const testEvent = { message: 'Hello from live-lambda CLI!', timestamp: new Date().toISOString() };
    console.log(`Publishing event to ${testChannel}:`.cyan, JSON.stringify(testEvent, null, 2));
    await client.publish(testChannel, [testEvent]);
    console.log(`Successfully published event to ${testChannel}.`.green);

    // Wait a moment to ensure message is received by subscriber if testing loopback
    await new Promise(resolve => setTimeout(resolve, 2000));

  } catch (error) {
    console.error('Error during WebSocket operations:'.red, error);
  } finally {
    if (subscriptionId) {
      try {
        console.log(`Unsubscribing from ${testChannel} (ID: ${subscriptionId})...`.cyan);
        await client.unsubscribe(subscriptionId);
        console.log(`Successfully unsubscribed from ${testChannel}.`.green);
      } catch (unsubError) {
        console.error(`Error unsubscribing from ${testChannel}:`.red, unsubError);
      }
    }
    if (client.is_connected) { 
        console.log('Disconnecting WebSocket client...'.cyan);
        await client.disconnect();
        console.log('WebSocket client disconnected.'.green);
    } else {
        console.log('WebSocket client was not connected or already disconnected.'.yellow);
    }
    console.log('Test finished.'.yellow);
  }
}

main_logic().catch((err) => {
  console.error('Critical error in main execution:'.red, err);
  process.exit(1);
});
