import WebSocket from 'ws'
import { SignatureV4 } from '@aws-sdk/signature-v4'
import { Sha256 } from '@aws-crypto/sha256-js'

import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { HttpRequest } from '@aws-sdk/protocol-http'
import { URL } from 'url' // Node.js built-in
import { randomUUID } from 'crypto'

// TODO: It's good practice to import this from your amplify_outputs.json or a config file
// For now, these are placeholders. Replace with your actual AppSync details.
interface AppSyncEndpointConfig {
  realtimeUrl: string // e.g., wss://<id>.appsync-realtime-api.<region>.amazonaws.com/event/realtime
  httpUrl: string // e.g., https://<id>.appsync-api.<region>.amazonaws.com/event
  region: string
  profile?: string // Optional AWS profile
}

interface AppSyncWebSocketClientOptions {
  endpointConfig: AppSyncEndpointConfig
  onData?: (subscriptionId: string, eventData: any) => void
  onError?: (error: any) => void
  onClose?: (event: WebSocket.CloseEvent) => void
  onOpen?: () => void // Callback when connection_ack is received
}

interface WebSocketMessage {
  type: string
  id?: string
  payload?: any // For client-sent messages with GraphQL structure
  event?: any // For server-sent data messages
  connectionTimeoutMs?: number // For connection_ack
  errors?: any[] // For error messages
  channel?: string // For subscribe/publish client messages
  authorization?: Record<string, string> // For subscribe/publish client messages
  events?: string[] // For publish client messages
}

interface OperationCallbacks {
  resolve: (value: any) => void
  reject: (reason?: any) => void
  onData?: (data: any) => void // For ongoing subscription data
}

const credentials = fromNodeProviderChain({
  profile: 'boundless-development'
})

export class AppSyncEventWebSocketClient {
  private socket?: WebSocket
  private clientOptions: AppSyncWebSocketClientOptions
  private operations = new Map<string, OperationCallbacks>()
  private connectionPromise?: Promise<void>
  private connectionResolver?: () => void
  private connectionRejecter?: (reason?: any) => void
  private keepAliveTimeout?: NodeJS.Timeout
  private connectionTimeoutMs: number = 300000 // Default 5 mins, updated by connection_ack
  private sigV4Signer: SignatureV4
  private credentials?: AwsCredentialIdentity

  constructor(options: AppSyncWebSocketClientOptions) {
    this.clientOptions = options
    // Initialize SigV4 signer here, credentials will be loaded in connect

    this.credentials = credentials
    this.sigV4Signer = new SignatureV4({
      service: 'appsync',
      region: this.clientOptions.endpointConfig.region,
      credentials: this.credentials,
      sha256: Sha256
    })
  }

  public get is_connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  private async load_credentials(): Promise<AwsCredentialIdentity> {
    if (!this.credentials) {
      //   const provider = fromNodeProviderChain({
      //     profile: this.clientOptions.endpointConfig.profile
      //   })
      this.credentials = await defaultProvider()()
      if (!this.credentials) {
        throw new Error('Could not load AWS credentials.')
      }
      console.log(this.credentials)
      // Update signer with loaded credentials
      const credentials = async () => {}
      this.sigV4Signer = new SignatureV4({
        service: 'appsync',
        region: this.clientOptions.endpointConfig.region,
        credentials: this.credentials,
        sha256: Sha256
      })
    }
    return this.credentials
  }

  private base_64_url_encode(data: string): string {
    return Buffer.from(data)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }

  private async get_signed_auth_headers_for_connect(): Promise<
    Record<string, string>
  > {
    await this.load_credentials()
    const httpUrl = new URL(this.clientOptions.endpointConfig.httpUrl)

    const requestToSign = new HttpRequest({
      method: 'POST',
      protocol: httpUrl.protocol,
      hostname: httpUrl.hostname,
      path: httpUrl.pathname, // Should be '/event'
      headers: {
        host: httpUrl.hostname,
        'content-type': 'application/json; charset=UTF-8'
        // AppSync Event API for connect expects empty body for signing
      },
      body: '{}' // Empty JSON object as string for the body
    })

    const signedRequest = await this.sigV4Signer.sign(requestToSign)

    const authHeaders: Record<string, string> = {
      accept:
        signedRequest.headers['accept'] || 'application/json, text/javascript',
      'content-encoding':
        signedRequest.headers['content-encoding'] || 'amz-1.0',
      'content-type':
        signedRequest.headers['content-type'] ||
        'application/json; charset=UTF-8',
      host: signedRequest.headers['host'],
      'x-amz-date': signedRequest.headers['x-amz-date'],
      Authorization: signedRequest.headers['authorization']
    }
    if (signedRequest.headers['x-amz-security-token']) {
      authHeaders['x-amz-security-token'] =
        signedRequest.headers['x-amz-security-token']
    }
    if (signedRequest.headers['x-amz-content-sha256']) {
      authHeaders['x-amz-content-sha256'] = signedRequest.headers['x-amz-content-sha256'];
    }
    return authHeaders
  }

  private async get_signed_auth_headers_for_operation(
    requestBody: string
  ): Promise<Record<string, string>> {
    await this.load_credentials() // Ensures credentials are loaded and signer is updated
    const httpUrl = new URL(this.clientOptions.endpointConfig.httpUrl)

    const requestToSign = new HttpRequest({
      method: 'POST',
      protocol: httpUrl.protocol,
      hostname: httpUrl.hostname,
      path: httpUrl.pathname, // Should be '/event'
      headers: {
        host: httpUrl.hostname,
        'content-type': 'application/json; charset=UTF-8'
      },
      body: requestBody
    })

    const signedRequest = await this.sigV4Signer.sign(requestToSign)

    const authHeaders: Record<string, string> = {
      // Per AppSync Event API docs, some headers are constants for the auth object
      accept: 'application/json, text/javascript',
      'content-encoding': 'amz-1.0', // This seems specific to an older example, check if needed for event API.
      // The primary auth object in docs for subscribe/publish only lists x-api-key or iam specific headers.
      // For IAM, it's the standard SigV4 components.
      'content-type': 'application/json; charset=UTF-8',
      host: signedRequest.headers['host'], // This IS required for IAM in the authorization object for subscribe/publish
      'x-amz-date': signedRequest.headers['x-amz-date'],
      Authorization: signedRequest.headers['authorization']
    }
    if (signedRequest.headers['x-amz-security-token']) {
      authHeaders['x-amz-security-token'] =
        signedRequest.headers['x-amz-security-token']
    }
    if (signedRequest.headers['x-amz-content-sha256']) {
      authHeaders['x-amz-content-sha256'] = signedRequest.headers['x-amz-content-sha256'];
    }
    return authHeaders
  }

  public async connect(): Promise<void> {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return this.connectionPromise
    }

    this.connectionPromise = new Promise(async (resolve, reject) => {
      this.connectionResolver = resolve
      this.connectionRejecter = reject

      try {
        const authHeadersForConnect =
          await this.get_signed_auth_headers_for_connect()
        const authHeaderString = this.base_64_url_encode(
          JSON.stringify(authHeadersForConnect)
        )
        const subprotocols = [
          `header-${authHeaderString}`,
          'aws-appsync-event-ws'
        ]

        this.socket = new WebSocket(
          this.clientOptions.endpointConfig.realtimeUrl,
          subprotocols
        )

        this.socket.onopen = () => {
          console.log('WebSocket connection opened, sending connection_init...')
          this.send_message({ type: 'connection_init' })
        }

        this.socket.onmessage = (event: WebSocket.MessageEvent) => {
          this.handle_message(event.data.toString())
        }

        this.socket.onerror = (errorEvent: WebSocket.ErrorEvent) => {
          console.error('WebSocket error:', errorEvent.message)
          this.clientOptions.onError?.(errorEvent.error)
          this.connectionRejecter?.(errorEvent.error)
          this.cleanup_connection()
        }

        this.socket.onclose = (closeEvent: WebSocket.CloseEvent) => {
          console.log(
            `WebSocket closed: code=${closeEvent.code}, reason=${closeEvent.reason}`
          )
          this.clientOptions.onClose?.(closeEvent)
          this.connectionRejecter?.(
            new Error(
              `WebSocket closed: ${closeEvent.code} ${closeEvent.reason}`
            )
          )
          this.cleanup_connection()
        }
      } catch (error) {
        console.error('Error during WebSocket connection setup:', error)
        this.clientOptions.onError?.(error)
        reject(error)
        this.cleanup_connection()
      }
    })
    return this.connectionPromise
  }

  private handle_message(rawMessage: string): void {
    try {
      const message = JSON.parse(rawMessage) as WebSocketMessage
      // console.log('WebSocket message received:', message); // For debugging

      if (this.keepAliveTimeout) {
        clearTimeout(this.keepAliveTimeout)
      }
      this.keepAliveTimeout = setTimeout(() => {
        console.warn('Keep-alive timeout. Closing WebSocket.')
        this.socket?.close(1000, 'Keep-alive timeout')
      }, this.connectionTimeoutMs + 5000) // Add a small buffer

      switch (message.type) {
        case 'connection_ack':
          console.log('AppSync connection acknowledged.')
          if (message.connectionTimeoutMs) {
            this.connectionTimeoutMs = message.connectionTimeoutMs
          }
          this.connectionResolver?.()
          this.clientOptions.onOpen?.()
          break
        case 'ka': // Keep-alive
          // console.log('Keep-alive received.'); // Optional: log keep-alive
          break
        case 'subscribe_success':
        case 'publish_success':
        case 'unsubscribe_success':
          if (message.id) {
            const op = this.operations.get(message.id)
            op?.resolve(message)
            if (message.type !== 'subscribe_success') {
              // Keep subscription ops for data
              this.operations.delete(message.id)
            }
          }
          break
        case 'data':
          if (message.id && message.event) {
            const subOp = this.operations.get(message.id)
            subOp?.onData?.(message.event)
            this.clientOptions.onData?.(message.id, message.event)
          }
          break
        case 'subscribe_error':
        case 'publish_error':
        case 'unsubscribe_error':
        case 'broadcast_error': // This can be an error on an active subscription
          console.error(
            `Error message from AppSync: ${message.type}`,
            message.errors
          )
          if (message.id) {
            const op = this.operations.get(message.id)
            op?.reject(message.errors || new Error(message.type))
            this.operations.delete(message.id)
          }
          this.clientOptions.onError?.(
            message.errors || new Error(message.type)
          )
          break
        default:
          console.warn(
            'Received unhandled WebSocket message type:',
            message.type,
            message
          )
      }
    } catch (error) {
      console.error(
        'Error processing WebSocket message:',
        error,
        'Raw data:',
        rawMessage
      )
      this.clientOptions.onError?.(error)
    }
  }

  private send_message(message: WebSocketMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message))
    } else {
      console.error('WebSocket not open. Cannot send message:', message)
      // Potentially queue the message or throw an error
      throw new Error('WebSocket is not open.')
    }
  }

  private cleanup_connection(): void {
    if (this.keepAliveTimeout) {
      clearTimeout(this.keepAliveTimeout)
      this.keepAliveTimeout = undefined
    }
    this.operations.forEach((op) =>
      op.reject(new Error('WebSocket connection closed or failed.'))
    )
    this.operations.clear()
    this.connectionPromise = undefined
    this.connectionResolver = undefined
    this.connectionRejecter = undefined
    this.credentials = undefined // Reset credentials for next connect attempt
  }

  public async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket) {
        if (this.socket.readyState === WebSocket.OPEN) {
          console.log('Closing WebSocket connection...')
          this.operations.forEach(async (op, id) => {
            // Attempt to unsubscribe from active subscriptions
            // This assumes your subscribe operations are identifiable or you have a list
            // For simplicity, this example doesn't explicitly track subscription types for auto-unsubscribe
            // but a real implementation might want to send 'unsubscribe' messages here.
            console.log(`Cleaning up operation: ${id}`)
          })
          this.socket.onclose = (event) => {
            console.log('WebSocket cleanly closed by disconnect().')
            this.cleanup_connection()
            resolve()
          }
          this.socket.close(1000, 'Client initiated disconnect')
        } else if (this.socket.readyState === WebSocket.CONNECTING) {
          console.log(
            'WebSocket was connecting, aborting connection attempt...'
          )
          this.socket.terminate() // Force close if connecting
          this.cleanup_connection()
          resolve()
        } else {
          this.cleanup_connection() // Already closed or closing
          resolve()
        }
      } else {
        resolve() // No socket to disconnect
      }
    })
  }

  public async subscribe(
    channel: string,
    onDataCallback: (data: any) => void
  ): Promise<string> {
    await this.connect() // Ensure connection is established

    const subscriptionId = randomUUID()
    const requestBody = JSON.stringify({ channel })
    const authorization = await this.get_signed_auth_headers_for_operation(
      requestBody
    )

    const subscribeMessage: WebSocketMessage = {
      type: 'subscribe',
      id: subscriptionId,
      channel,
      authorization
    }

    return new Promise((resolve, reject) => {
      this.operations.set(subscriptionId, {
        resolve: (ackMsg) => {
          // The 'subscribe_success' ack itself is resolved here.
          // The onDataCallback will be called by handle_message for 'data' types.
          resolve(subscriptionId)
        },
        reject,
        onData: onDataCallback // Store the user's data handler
      })
      try {
        this.send_message(subscribeMessage)
      } catch (error) {
        this.operations.delete(subscriptionId) // Clean up if send fails immediately
        reject(error)
      }
    })
  }

  public async publish(channel: string, events: any[]): Promise<any> {
    // Return type can be more specific based on publish_success
    await this.connect() // Ensure connection

    const publishId = randomUUID()
    // Events need to be stringified JSONs
    const stringifiedEvents = events.map((event) => JSON.stringify(event))
    const requestBody = JSON.stringify({ channel, events: stringifiedEvents })
    const authorization = await this.get_signed_auth_headers_for_operation(
      requestBody
    )

    const publishMessage: WebSocketMessage = {
      type: 'publish',
      id: publishId,
      channel,
      events: stringifiedEvents,
      authorization
    }

    return new Promise((resolve, reject) => {
      this.operations.set(publishId, { resolve, reject })
      try {
        this.send_message(publishMessage)
      } catch (error) {
        this.operations.delete(publishId)
        reject(error)
      }
    })
  }

  public async unsubscribe(subscriptionId: string): Promise<any> {
    await this.connect() // Ensure connection, though ideally it's already connected

    if (
      !this.operations.has(subscriptionId) &&
      this.socket?.readyState !== WebSocket.OPEN
    ) {
      // If not connected and no op, it's likely already cleaned up or never subscribed.
      console.warn(
        `Attempted to unsubscribe from ${subscriptionId}, but no active operation found or socket closed.`
      )
      return Promise.resolve({
        type: 'unsubscribe_noop',
        id: subscriptionId,
        message: 'No active subscription or socket closed.'
      })
    }

    const unsubscribeMessage: WebSocketMessage = {
      type: 'unsubscribe',
      id: subscriptionId
    }

    return new Promise((resolve, reject) => {
      // We re-use the existing operation's resolve/reject for the unsubscribe ack,
      // or create a new one if only for unsubscription without prior op storage (e.g. cleaning up)
      const op = this.operations.get(subscriptionId)
      if (op) {
        // Modify the existing operation to expect unsubscribe_success/error
        this.operations.set(subscriptionId, { ...op, resolve, reject })
      } else {
        this.operations.set(subscriptionId, { resolve, reject })
      }

      try {
        this.send_message(unsubscribeMessage)
      } catch (error) {
        this.operations.delete(subscriptionId)
        reject(error)
      }
    }).finally(() => {
      // Always remove from operations map after unsubscribe attempt (success or error handled by handle_message)
      // handle_message will delete it upon 'unsubscribe_success' or error types.
      // This is a fallback if the promise flow somehow misses it.
      // Actually, handle_message should be the one to delete it.
    })
  }
}

// Example Usage (Illustrative - you'll need to integrate this into your CLI)
/*
async function example() {
  const config: AppSyncEndpointConfig = {
    realtimeUrl: 'wss://YOUR_APPSYNC_ID.appsync-realtime-api.YOUR_REGION.amazonaws.com/event/realtime',
    httpUrl: 'https://YOUR_APPSYNC_ID.appsync-api.YOUR_REGION.amazonaws.com/event',
    region: 'YOUR_REGION',
    // profile: 'your-aws-profile' // Optional
  };

  const client = new AppSyncEventWebSocketClient({
    endpointConfig: config,
    onData: (subId, data) => {
      console.log(`Received data for subscription ${subId}:`, data);
    },
    onError: (err) => {
      console.error('Global WebSocket client error:', err);
    },
    onClose: (ev) => {
      console.log('Global WebSocket client closed:', ev.code, ev.reason);
    },
    onOpen: () => {
      console.log('Global WebSocket client connected and AppSync session acknowledged!');
      // Now it's safe to subscribe or publish
    }
  });

  try {
    await client.connect();
    console.log('Client successfully connected.');

    // Example: Subscribe
    const subId = await client.subscribe('/my/test/channel', (data) => {
      console.log('Event on /my/test/channel:', data);
    });
    console.log('Subscribed with ID:', subId);

    // Example: Publish
    await client.publish('/my/test/channel', [{ message: 'Hello from WebSocket client!', timestamp: new Date().toISOString() }]);
    console.log('Published event.');

    // Example: Unsubscribe
    await client.unsubscribe(subId);
    console.log('Unsubscribed from:', subId);

  } catch (error) {
    console.error('Failed to run example:', error);
  } finally {
    // To keep the example running for a bit to receive messages if subscribed:
    // setTimeout(async () => {
    //   await client.disconnect();
    //   console.log('Client disconnected after timeout.');
    // }, 30000); // Disconnect after 30 seconds
    // Or, for immediate disconnect in a script:
    // await client.disconnect();
  }
}

// example();
*/
