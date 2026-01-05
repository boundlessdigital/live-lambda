import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted to create mock functions that can be referenced in vi.mock
const {
  mock_connect,
  mock_subscribe,
  mock_publish,
  mock_client_constructor,
  mock_execute_handler
} = vi.hoisted(() => ({
  mock_connect: vi.fn(),
  mock_subscribe: vi.fn(),
  mock_publish: vi.fn(),
  mock_client_constructor: vi.fn(),
  mock_execute_handler: vi.fn()
}))

vi.mock('@boundlessdigital/aws-appsync-events-websockets-client', () => ({
  AppSyncEventWebSocketClient: class MockAppSyncEventWebSocketClient {
    constructor(config: any) {
      mock_client_constructor(config)
    }
    connect = mock_connect
    subscribe = mock_subscribe
    publish = mock_publish
  }
}))

vi.mock('./runtime.js', () => ({
  execute_handler: mock_execute_handler
}))

vi.mock('../lib/logger.js', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    start: vi.fn()
  }
}))

// Import after mocks are set up
import { serve } from './index.js'
import { ServerConfig } from './types.js'

describe('server index', () => {
  const mock_config: ServerConfig = {
    region: 'us-east-1',
    http: 'https://test-api.appsync-api.us-east-1.amazonaws.com/event',
    realtime: 'wss://test-api.appsync-realtime-api.us-east-1.amazonaws.com/event/realtime',
    layer_arn: 'arn:aws:lambda:us-east-1:123456789012:layer:live-lambda:1',
    profile: 'test-profile'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mock_connect.mockResolvedValue(undefined)
    mock_subscribe.mockResolvedValue(undefined)
    mock_publish.mockResolvedValue(undefined)
  })

  describe('serve', () => {
    it('should create AppSyncEventWebSocketClient with provided config', async () => {
      await serve(mock_config)

      expect(mock_client_constructor).toHaveBeenCalledWith(mock_config)
    })

    it('should connect to AppSync WebSocket', async () => {
      await serve(mock_config)

      expect(mock_connect).toHaveBeenCalledTimes(1)
    })

    it('should subscribe to /live-lambda/requests channel', async () => {
      await serve(mock_config)

      expect(mock_subscribe).toHaveBeenCalledTimes(1)
      expect(mock_subscribe).toHaveBeenCalledWith(
        '/live-lambda/requests',
        expect.any(Function)
      )
    })

    it('should call handle_request on message and publish response', async () => {
      const mock_request_id = 'test-request-123'
      const mock_event = {
        version: '2.0',
        routeKey: '$default',
        rawPath: '/test',
        rawQueryString: '',
        headers: {},
        requestContext: {
          accountId: '123456789012',
          apiId: 'test-api',
          domainName: 'test.execute-api.us-east-1.amazonaws.com',
          domainPrefix: 'test',
          http: {
            method: 'GET',
            path: '/test',
            protocol: 'HTTP/1.1',
            sourceIp: '127.0.0.1',
            userAgent: 'test'
          },
          requestId: 'test-req-id',
          routeKey: '$default',
          stage: '$default',
          time: '01/Jan/2024:00:00:00 +0000',
          timeEpoch: 1704067200000
        },
        isBase64Encoded: false
      }

      const mock_context = {
        aws_region: 'us-east-1',
        deadline_ms: '1704067260000',
        function_name: 'test-function',
        function_version: '$LATEST',
        invoked_function_arn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        log_group_name: '/aws/lambda/test-function',
        log_stream_name: '2024/01/01/[$LATEST]abcdef123456',
        memory_size_mb: '128',
        request_id: mock_request_id,
        trace_id: 'Root=1-12345678-abcdef',
        handler_path: 'index',
        handler_name: 'handler'
      }

      const mock_payload = JSON.stringify({
        request_id: mock_request_id,
        event_payload: mock_event,
        context: mock_context
      })

      const mock_response = { statusCode: 200, body: JSON.stringify({ message: 'OK' }) }
      mock_execute_handler.mockResolvedValue(mock_response)

      // Capture the subscribe callback
      let subscribe_callback: ((payload: string) => Promise<any>) | undefined

      mock_subscribe.mockImplementation((channel: string, callback: (payload: string) => Promise<any>) => {
        subscribe_callback = callback
        return Promise.resolve()
      })

      await serve(mock_config)

      // Verify subscribe was called and callback was captured
      expect(subscribe_callback).toBeDefined()

      // Simulate receiving a message
      await subscribe_callback!(mock_payload)

      // Verify execute_handler was called with correct arguments
      expect(mock_execute_handler).toHaveBeenCalledWith(mock_event, mock_context)

      // Verify response was published to correct channel
      expect(mock_publish).toHaveBeenCalledWith(
        `/live-lambda/response/${mock_request_id}`,
        [mock_response]
      )
    })

    it('should publish response to correct channel with request_id', async () => {
      const request_id = 'unique-request-456'
      const mock_payload = JSON.stringify({
        request_id: request_id,
        event_payload: { test: 'event' },
        context: { function_name: 'test' }
      })

      const handler_response = { statusCode: 201, body: '{"created": true}' }
      mock_execute_handler.mockResolvedValue(handler_response)

      let subscribe_callback: ((payload: string) => Promise<any>) | undefined
      mock_subscribe.mockImplementation((channel: string, callback: (payload: string) => Promise<any>) => {
        subscribe_callback = callback
        return Promise.resolve()
      })

      await serve(mock_config)
      await subscribe_callback!(mock_payload)

      expect(mock_publish).toHaveBeenCalledWith(
        `/live-lambda/response/${request_id}`,
        [handler_response]
      )
    })

    it('should handle execute_handler errors gracefully', async () => {
      const mock_payload = JSON.stringify({
        request_id: 'error-request-789',
        event_payload: { test: 'event' },
        context: { function_name: 'test' }
      })

      const handler_error = new Error('Handler execution failed')
      mock_execute_handler.mockRejectedValue(handler_error)

      let subscribe_callback: ((payload: string) => Promise<any>) | undefined
      mock_subscribe.mockImplementation((channel: string, callback: (payload: string) => Promise<any>) => {
        subscribe_callback = callback
        return Promise.resolve()
      })

      await serve(mock_config)

      // The error should propagate from handle_request
      await expect(subscribe_callback!(mock_payload)).rejects.toThrow('Handler execution failed')
    })

    it('should handle multiple concurrent requests', async () => {
      const requests = [
        { request_id: 'req-1', event_payload: { path: '/a' }, context: { function_name: 'fn1' } },
        { request_id: 'req-2', event_payload: { path: '/b' }, context: { function_name: 'fn2' } },
        { request_id: 'req-3', event_payload: { path: '/c' }, context: { function_name: 'fn3' } }
      ]

      mock_execute_handler
        .mockResolvedValueOnce({ statusCode: 200, body: 'response-1' })
        .mockResolvedValueOnce({ statusCode: 200, body: 'response-2' })
        .mockResolvedValueOnce({ statusCode: 200, body: 'response-3' })

      let subscribe_callback: ((payload: string) => Promise<any>) | undefined
      mock_subscribe.mockImplementation((channel: string, callback: (payload: string) => Promise<any>) => {
        subscribe_callback = callback
        return Promise.resolve()
      })

      await serve(mock_config)

      // Process all requests concurrently
      await Promise.all(
        requests.map(req => subscribe_callback!(JSON.stringify(req)))
      )

      // Verify each request was handled
      expect(mock_execute_handler).toHaveBeenCalledTimes(3)

      // Verify responses were published to correct channels
      expect(mock_publish).toHaveBeenCalledWith('/live-lambda/response/req-1', [{ statusCode: 200, body: 'response-1' }])
      expect(mock_publish).toHaveBeenCalledWith('/live-lambda/response/req-2', [{ statusCode: 200, body: 'response-2' }])
      expect(mock_publish).toHaveBeenCalledWith('/live-lambda/response/req-3', [{ statusCode: 200, body: 'response-3' }])
    })

    it('should connect before subscribing', async () => {
      const call_order: string[] = []

      mock_connect.mockImplementation(() => {
        call_order.push('connect')
        return Promise.resolve()
      })

      mock_subscribe.mockImplementation(() => {
        call_order.push('subscribe')
        return Promise.resolve()
      })

      await serve(mock_config)

      expect(call_order).toEqual(['connect', 'subscribe'])
    })

    it('should handle connection failure', async () => {
      const connection_error = new Error('WebSocket connection failed')
      mock_connect.mockRejectedValue(connection_error)

      await expect(serve(mock_config)).rejects.toThrow('WebSocket connection failed')
    })

    it('should handle subscription failure', async () => {
      const subscription_error = new Error('Subscription failed')
      mock_subscribe.mockRejectedValue(subscription_error)

      await expect(serve(mock_config)).rejects.toThrow('Subscription failed')
    })
  })

  describe('request payload parsing', () => {
    it('should correctly parse JSON payload with all fields', async () => {
      const complex_event = {
        version: '2.0',
        routeKey: 'POST /users',
        rawPath: '/users',
        rawQueryString: 'page=1&limit=10',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer token123'
        },
        body: JSON.stringify({ name: 'Test User', email: 'test@example.com' }),
        requestContext: {
          accountId: '123456789012',
          apiId: 'api123',
          domainName: 'api.example.com',
          domainPrefix: 'api',
          http: {
            method: 'POST',
            path: '/users',
            protocol: 'HTTP/1.1',
            sourceIp: '10.0.0.1',
            userAgent: 'CustomClient/1.0'
          },
          requestId: 'complex-req-id',
          routeKey: 'POST /users',
          stage: 'prod',
          time: '15/Jan/2024:12:30:45 +0000',
          timeEpoch: 1705322445000
        },
        isBase64Encoded: false
      }

      const complex_context = {
        aws_region: 'eu-west-1',
        deadline_ms: '1705322505000',
        function_name: 'user-api-handler',
        function_version: '5',
        invoked_function_arn: 'arn:aws:lambda:eu-west-1:123456789012:function:user-api-handler:5',
        log_group_name: '/aws/lambda/user-api-handler',
        log_stream_name: '2024/01/15/[5]xyz789',
        memory_size_mb: '512',
        request_id: 'complex-req-id',
        trace_id: 'Root=1-65a5abc0-xyz;Parent=abc123;Sampled=1',
        handler_path: 'src/handlers/users',
        handler_name: 'createUser'
      }

      const payload = JSON.stringify({
        request_id: 'complex-req-id',
        event_payload: complex_event,
        context: complex_context
      })

      mock_execute_handler.mockResolvedValue({ statusCode: 201, body: '{"id": "user-123"}' })

      let subscribe_callback: ((payload: string) => Promise<any>) | undefined
      mock_subscribe.mockImplementation((channel: string, callback: (payload: string) => Promise<any>) => {
        subscribe_callback = callback
        return Promise.resolve()
      })

      await serve(mock_config)
      await subscribe_callback!(payload)

      expect(mock_execute_handler).toHaveBeenCalledWith(complex_event, complex_context)
    })

    it('should handle undefined or null response from handler', async () => {
      const mock_payload = JSON.stringify({
        request_id: 'null-response-req',
        event_payload: { test: 'event' },
        context: { function_name: 'test' }
      })

      mock_execute_handler.mockResolvedValue(undefined)

      let subscribe_callback: ((payload: string) => Promise<any>) | undefined
      mock_subscribe.mockImplementation((channel: string, callback: (payload: string) => Promise<any>) => {
        subscribe_callback = callback
        return Promise.resolve()
      })

      await serve(mock_config)
      await subscribe_callback!(mock_payload)

      // Should still publish even if response is undefined
      expect(mock_publish).toHaveBeenCalledWith(
        '/live-lambda/response/null-response-req',
        [undefined]
      )
    })
  })

  describe('channel naming', () => {
    it('should use correct namespace for requests channel', async () => {
      await serve(mock_config)

      // The requests channel should use the live-lambda namespace
      expect(mock_subscribe).toHaveBeenCalledWith(
        '/live-lambda/requests',
        expect.any(Function)
      )
    })

    it('should use correct namespace for response channel', async () => {
      const request_id = 'channel-test-123'
      const mock_payload = JSON.stringify({
        request_id,
        event_payload: {},
        context: {}
      })

      mock_execute_handler.mockResolvedValue({ ok: true })

      let subscribe_callback: ((payload: string) => Promise<any>) | undefined
      mock_subscribe.mockImplementation((channel: string, callback: (payload: string) => Promise<any>) => {
        subscribe_callback = callback
        return Promise.resolve()
      })

      await serve(mock_config)
      await subscribe_callback!(mock_payload)

      // The response channel should follow the pattern /live-lambda/response/{request_id}
      expect(mock_publish).toHaveBeenCalledWith(
        `/live-lambda/response/${request_id}`,
        expect.any(Array)
      )
    })
  })
})
