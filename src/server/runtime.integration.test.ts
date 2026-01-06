/**
 * Integration tests for runtime handler execution.
 *
 * These tests verify actual handler loading and execution without mocking
 * the dynamic import or esbuild transformation. They complement the unit
 * tests which mock these internals.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as esbuild from 'esbuild'
import type { APIGatewayProxyEventV2 } from 'aws-lambda'

// Test the actual handler loading mechanism used by the runtime
async function load_typescript_handler(
  handler_path: string,
  handler_name: string
): Promise<(...args: unknown[]) => Promise<unknown>> {
  const abs_path = path.isAbsolute(handler_path)
    ? handler_path
    : path.resolve(__dirname, handler_path)

  // Transform TypeScript to JavaScript using esbuild (same as runtime.ts)
  const result = await esbuild.build({
    entryPoints: [abs_path],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false,
    sourcemap: 'inline',
    external: ['@aws-sdk/*', 'aws-lambda']
  })

  // Write to temp file and import
  const temp_dir = os.tmpdir()
  const temp_file = path.join(temp_dir, `live-lambda-test-${Date.now()}.mjs`)
  fs.writeFileSync(temp_file, result.outputFiles[0].text)

  const handler_module = await import(temp_file)

  // Clean up temp file
  fs.unlinkSync(temp_file)

  const handler = handler_module[handler_name]
  if (typeof handler !== 'function') {
    throw new Error(
      `Expected ${abs_path} to export a function named "${handler_name}", got ${typeof handler}`
    )
  }

  return handler
}

describe('runtime integration', () => {
  const fixtures_path = path.join(__dirname, '__fixtures__')

  const mock_event: APIGatewayProxyEventV2 = {
    version: '2.0',
    routeKey: '$default',
    rawPath: '/test/integration',
    rawQueryString: 'foo=bar',
    headers: { 'content-type': 'application/json' },
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method: 'POST',
        path: '/test/integration',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'vitest'
      },
      requestId: 'integration-test-req-id',
      routeKey: '$default',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000
    },
    isBase64Encoded: false
  }

  const mock_context = {
    functionName: 'test-function',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
    memoryLimitInMB: '128',
    awsRequestId: 'integration-test-request-id',
    logGroupName: '/aws/lambda/test-function',
    logStreamName: '2024/01/01/[$LATEST]abc123',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
    callbackWaitsForEmptyEventLoop: true
  }

  describe('TypeScript handler loading', () => {
    it('should load and execute a basic handler', async () => {
      const handler = await load_typescript_handler(
        path.join(fixtures_path, 'test-handler.ts'),
        'handler'
      )

      const result = await handler(mock_event, mock_context) as {
        statusCode: number
        body: string
      }

      expect(result.statusCode).toBe(200)

      const body = JSON.parse(result.body)
      expect(body.message).toBe('Hello from test handler')
      expect(body.received_event.rawPath).toBe('/test/integration')
      expect(body.function_name).toBe('test-function')
    })

    it('should load and execute an async handler', async () => {
      const handler = await load_typescript_handler(
        path.join(fixtures_path, 'test-handler.ts'),
        'async_handler'
      )

      const result = await handler(mock_event, mock_context) as {
        statusCode: number
        body: string
      }

      expect(result.statusCode).toBe(201)

      const body = JSON.parse(result.body)
      expect(body.async).toBe(true)
      expect(body.path).toBe('/test/integration')
    })

    it('should propagate handler errors', async () => {
      const handler = await load_typescript_handler(
        path.join(fixtures_path, 'test-handler.ts'),
        'error_handler'
      )

      await expect(handler(mock_event, mock_context)).rejects.toThrow(
        'Intentional test error'
      )
    })

    it('should handle handlers that return undefined', async () => {
      const handler = await load_typescript_handler(
        path.join(fixtures_path, 'test-handler.ts'),
        'returning_undefined'
      )

      const result = await handler(mock_event, mock_context)
      expect(result).toBeUndefined()
    })

    it('should throw when handler export is not a function', async () => {
      await expect(
        load_typescript_handler(
          path.join(fixtures_path, 'test-handler.ts'),
          'not_a_handler'
        )
      ).rejects.toThrow('Expected')
    })

    it('should throw when handler export does not exist', async () => {
      await expect(
        load_typescript_handler(
          path.join(fixtures_path, 'test-handler.ts'),
          'nonexistent_handler'
        )
      ).rejects.toThrow('Expected')
    })
  })

  describe('esbuild transformation', () => {
    it('should correctly transform TypeScript syntax', async () => {
      // The test-handler.ts uses TypeScript-specific syntax (type imports, type annotations)
      // This test verifies esbuild correctly strips them
      const handler = await load_typescript_handler(
        path.join(fixtures_path, 'test-handler.ts'),
        'handler'
      )

      // If we got here without error, the TypeScript was correctly transformed
      expect(typeof handler).toBe('function')
    })

    it('should bundle dependencies correctly', async () => {
      // The handler references aws-lambda types which should be externalized
      const handler = await load_typescript_handler(
        path.join(fixtures_path, 'test-handler.ts'),
        'handler'
      )

      const result = await handler(mock_event, mock_context) as {
        statusCode: number
        body: string
      }

      // If types were bundled incorrectly, the handler would fail
      expect(result.statusCode).toBe(200)
    })
  })

  describe('handler invocation signature', () => {
    it('should pass event as first argument', async () => {
      const handler = await load_typescript_handler(
        path.join(fixtures_path, 'test-handler.ts'),
        'handler'
      )

      const custom_event = {
        ...mock_event,
        rawPath: '/custom/path',
        body: JSON.stringify({ custom: 'data' })
      }

      const result = await handler(custom_event, mock_context) as {
        statusCode: number
        body: string
      }

      const body = JSON.parse(result.body)
      expect(body.received_event.rawPath).toBe('/custom/path')
      expect(body.received_event.body).toBe(JSON.stringify({ custom: 'data' }))
    })

    it('should pass context as second argument', async () => {
      const handler = await load_typescript_handler(
        path.join(fixtures_path, 'test-handler.ts'),
        'handler'
      )

      const custom_context = {
        ...mock_context,
        functionName: 'custom-function-name'
      }

      const result = await handler(mock_event, custom_context) as {
        statusCode: number
        body: string
      }

      const body = JSON.parse(result.body)
      expect(body.function_name).toBe('custom-function-name')
    })
  })
})
