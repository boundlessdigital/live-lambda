import 'colors'
import { AppSyncEventWebSocketClient } from '../websocket'

interface ServerConfig {
  region: string
  http: string
  realtime: string
}

export async function serve(config: ServerConfig): Promise<void> {
  console.log('Starting AppSync WebSocket Client...'.yellow)

  const client = new AppSyncEventWebSocketClient(config)

  const testChannel = `live-lambda/${Date.now()}`
  let subscriptionId: string | undefined

  try {
    await client.connect()

    subscriptionId = await client.subscribe(testChannel, (data) => {
      console.log(
        `Received data on ${testChannel}:`.magenta,
        JSON.stringify(data, null, 2)
      )
    })

    const testEvent = {
      message: 'Hello from live-lambda CLI!',
      timestamp: new Date().toISOString()
    }

    await client.publish(testChannel, [testEvent])
    console.log(`Successfully published event to ${testChannel}.`.green)

    // Wait a moment to ensure message is received by subscriber if testing loopback
    await new Promise((resolve) => setTimeout(resolve, 2000))
  } catch (error) {
    console.error('Error during WebSocket operations:'.red, error)
  } finally {
    if (subscriptionId) {
      try {
        console.log(
          `Unsubscribing from ${testChannel} (ID: ${subscriptionId})...`.cyan
        )
        await client.unsubscribe(subscriptionId)
        console.log(`Successfully unsubscribed from ${testChannel}.`.green)
      } catch (unsubError) {
        console.error(
          `Error unsubscribing from ${testChannel}:`.red,
          unsubError
        )
      }
    }
    if (client.is_connected) {
      console.log('Disconnecting WebSocket client...'.cyan)
      await client.disconnect()
      console.log('WebSocket client disconnected.'.green)
    } else {
      console.log(
        'WebSocket client was not connected or already disconnected.'.yellow
      )
    }
    console.log('Test finished.'.yellow)
  }
}
