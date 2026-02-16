import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Use vi.hoisted to create mock functions that can be referenced in vi.mock
const {
  mock_read_file_sync,
  mock_exists_sync,
  mock_write_file_sync,
  mock_unlink_sync,
  mock_esbuild_build,
  mock_lambda_send,
  mock_lambda_client_constructor,
  mock_cred_provider,
  mock_from_temporary_credentials
} = vi.hoisted(() => ({
  mock_read_file_sync: vi.fn(),
  mock_exists_sync: vi.fn(),
  mock_write_file_sync: vi.fn(),
  mock_unlink_sync: vi.fn(),
  mock_esbuild_build: vi.fn(),
  mock_lambda_send: vi.fn(),
  mock_lambda_client_constructor: vi.fn(),
  mock_cred_provider: vi.fn(),
  mock_from_temporary_credentials: vi.fn()
}))

// Mock fs module
vi.mock('fs', () => ({
  readFileSync: mock_read_file_sync,
  existsSync: mock_exists_sync,
  writeFileSync: mock_write_file_sync,
  unlinkSync: mock_unlink_sync,
  default: {
    readFileSync: mock_read_file_sync,
    existsSync: mock_exists_sync,
    writeFileSync: mock_write_file_sync,
    unlinkSync: mock_unlink_sync
  }
}))

// Mock esbuild
vi.mock('esbuild', () => ({
  build: mock_esbuild_build,
  default: {
    build: mock_esbuild_build
  }
}))

// Mock AWS SDK
vi.mock('@aws-sdk/client-lambda', () => {
  return {
    LambdaClient: class MockLambdaClient {
      constructor(config: any) {
        mock_lambda_client_constructor(config)
      }
      send = mock_lambda_send
    },
    GetFunctionConfigurationCommand: class MockGetFunctionConfigurationCommand {
      constructor(public input: any) {}
    }
  }
})

vi.mock('@aws-sdk/credential-providers', () => ({
  fromTemporaryCredentials: mock_from_temporary_credentials
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
import {
  execute_handler,
  execute_module_handler,
  ExecuteHandlerOptions
} from './runtime.js'
import { LambdaContext } from './types.js'
import type { APIGatewayProxyEventV2 } from 'aws-lambda'

describe('runtime', () => {
  const mock_event: APIGatewayProxyEventV2 = {
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
        userAgent: 'test-agent'
      },
      requestId: 'test-request-id',
      routeKey: '$default',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000
    },
    isBase64Encoded: false
  }

  const mock_context: LambdaContext = {
    aws_region: 'us-east-1',
    deadline_ms: '1704067260000',
    function_name: 'test-function',
    function_version: '$LATEST',
    invoked_function_arn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
    log_group_name: '/aws/lambda/test-function',
    log_stream_name: '2024/01/01/[$LATEST]abcdef123456',
    memory_size_mb: '128',
    request_id: 'test-request-id',
    trace_id: 'Root=1-12345678-abcdef;Parent=1234abcd;Sampled=1',
    handler_path: 'index',
    handler_name: 'handler'
  }

  const mock_outputs = {
    TestStack: {
      FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
      FunctionHandler: 'index.handler',
      FunctionCdkOutAssetPath: '/path/to/cdk.out/asset.12345'
    }
  }

  const mock_credentials = {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    sessionToken: 'FwoGZXIvYXdzEBYaDEXAMPLETOKEN'
  }

  let original_env: NodeJS.ProcessEnv

  beforeEach(() => {
    vi.clearAllMocks()
    original_env = { ...process.env }

    // Default mock implementations
    mock_lambda_send.mockResolvedValue({
      Role: 'arn:aws:iam::123456789012:role/test-role',
      Environment: { Variables: {} }
    })
    mock_cred_provider.mockResolvedValue(mock_credentials)
    mock_from_temporary_credentials.mockReturnValue(mock_cred_provider)
  })

  afterEach(() => {
    process.env = original_env
  })

  describe('execute_handler', () => {
    it('should call execute_module_handler with correct params from context', async () => {
      mock_read_file_sync.mockReturnValue(JSON.stringify(mock_outputs))
      mock_exists_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('.mjs.map')) return true
        if (file_path.endsWith('.ts')) return true
        return false
      })

      // Mock source map
      const mock_sourcemap = {
        sources: ['../../src/handlers/test.ts', '../node_modules/some-module.ts']
      }
      mock_read_file_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('.mjs.map')) {
          return JSON.stringify(mock_sourcemap)
        }
        if (file_path.endsWith('outputs.json')) {
          return JSON.stringify(mock_outputs)
        }
        return ''
      })

      mock_esbuild_build.mockResolvedValue({
        outputFiles: [{ text: 'export const handler = () => ({ statusCode: 200 })' }]
      })

      // The function will fail on dynamic import since we can't mock it
      // but we can verify the setup code runs correctly
      await expect(execute_handler(mock_event, mock_context)).rejects.toThrow()

      // Verify LambdaClient was instantiated with correct region
      expect(mock_lambda_client_constructor).toHaveBeenCalledWith({ region: 'us-east-1' })
    })
  })

  describe('resolve_handler_from_outputs', () => {
    it('should parse outputs.json and find matching function ARN', async () => {
      mock_read_file_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('outputs.json')) {
          return JSON.stringify(mock_outputs)
        }
        if (file_path.endsWith('.mjs.map')) {
          return JSON.stringify({ sources: ['../../src/test.ts'] })
        }
        return ''
      })

      mock_exists_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('.mjs.map')) return true
        if (file_path.endsWith('.ts')) return true
        return false
      })

      mock_esbuild_build.mockResolvedValue({
        outputFiles: [{ text: 'export const handler = async () => ({ statusCode: 200 })' }]
      })

      const options: ExecuteHandlerOptions = {
        region: 'us-east-1',
        function_arn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        event: mock_event,
        context: mock_context
      }

      // The function will fail on dynamic import, but we verify outputs.json was read
      await expect(execute_module_handler(options)).rejects.toThrow()

      // Verify outputs.json was read
      expect(mock_read_file_sync).toHaveBeenCalledWith(
        expect.stringContaining('outputs.json'),
        'utf-8'
      )
    })

    it('should throw descriptive error for non-matching ARN', async () => {
      mock_read_file_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('outputs.json')) {
          return JSON.stringify(mock_outputs)
        }
        return ''
      })

      const options: ExecuteHandlerOptions = {
        region: 'us-east-1',
        function_arn: 'arn:aws:lambda:us-east-1:123456789012:function:non-existent-function',
        event: mock_event,
        context: mock_context
      }

      const error = await execute_module_handler(options).catch(e => e) as Error

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('Could not find handler info for function ARN')
      expect(error.message).toContain('non-existent-function')
    })
  })

  describe('extract_source_from_sourcemap', () => {
    it('should find .ts source from .mjs.map file', async () => {
      const sourcemap_with_ts = {
        sources: [
          '../node_modules/aws-sdk/lib/index.js',
          '../../src/handlers/my-handler.ts'
        ]
      }

      mock_read_file_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('outputs.json')) {
          return JSON.stringify(mock_outputs)
        }
        if (file_path.endsWith('.mjs.map')) {
          return JSON.stringify(sourcemap_with_ts)
        }
        return ''
      })

      mock_exists_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('.mjs.map')) return true
        if (file_path.endsWith('my-handler.ts')) return true
        return false
      })

      mock_esbuild_build.mockResolvedValue({
        outputFiles: [{ text: 'export const handler = async () => ({ statusCode: 200 })' }]
      })

      const options: ExecuteHandlerOptions = {
        region: 'us-east-1',
        function_arn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        event: mock_event,
        context: mock_context
      }

      // The function will fail on dynamic import, but we verify source map handling
      await expect(execute_module_handler(options)).rejects.toThrow()

      // Verify .mjs.map was read
      expect(mock_read_file_sync).toHaveBeenCalledWith(
        expect.stringContaining('.mjs.map'),
        'utf-8'
      )

      // Verify esbuild was called (indicating TypeScript path was found)
      expect(mock_esbuild_build).toHaveBeenCalled()
    })

    it('should fall back to .js.map when .mjs.map does not exist', async () => {
      const sourcemap_with_ts = {
        sources: ['../../src/handlers/my-handler.ts']
      }

      let mjs_map_checked = false
      let js_map_checked = false

      mock_read_file_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('outputs.json')) {
          return JSON.stringify(mock_outputs)
        }
        if (file_path.endsWith('.js.map')) {
          return JSON.stringify(sourcemap_with_ts)
        }
        return ''
      })

      mock_exists_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('.mjs.map')) {
          mjs_map_checked = true
          return false // .mjs.map doesn't exist
        }
        if (file_path.endsWith('.js.map')) {
          js_map_checked = true
          return true // .js.map exists
        }
        if (file_path.endsWith('my-handler.ts')) return true
        return false
      })

      mock_esbuild_build.mockResolvedValue({
        outputFiles: [{ text: 'export const handler = async () => ({ statusCode: 200 })' }]
      })

      const options: ExecuteHandlerOptions = {
        region: 'us-east-1',
        function_arn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        event: mock_event,
        context: mock_context
      }

      // The function will fail on dynamic import, but we verify fallback behavior
      await expect(execute_module_handler(options)).rejects.toThrow()

      expect(mjs_map_checked).toBe(true)
      expect(js_map_checked).toBe(true)
      expect(mock_read_file_sync).toHaveBeenCalledWith(
        expect.stringContaining('.js.map'),
        'utf-8'
      )
    })

    it('should fall back to compiled .mjs when no source map exists', async () => {
      mock_read_file_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('outputs.json')) {
          return JSON.stringify(mock_outputs)
        }
        return ''
      })

      mock_exists_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('.mjs.map')) return false
        if (file_path.endsWith('.js.map')) return false
        if (file_path.endsWith('.mjs')) return true // Compiled file exists
        return false
      })

      const options: ExecuteHandlerOptions = {
        region: 'us-east-1',
        function_arn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        event: mock_event,
        context: mock_context
      }

      // The function will fail on dynamic import, but we verify compiled file handling
      await expect(execute_module_handler(options)).rejects.toThrow()

      // esbuild should NOT be called for compiled files
      expect(mock_esbuild_build).not.toHaveBeenCalled()
    })
  })

  describe('execute_module_handler', () => {
    it('should assume Lambda role using fromTemporaryCredentials', async () => {
      const mock_role_arn = 'arn:aws:iam::123456789012:role/lambda-execution-role'

      mock_lambda_send.mockResolvedValue({
        Role: mock_role_arn,
        Environment: { Variables: { EXISTING_VAR: 'existing-value' } }
      })

      mock_read_file_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('outputs.json')) {
          return JSON.stringify(mock_outputs)
        }
        if (file_path.endsWith('.mjs.map')) {
          return JSON.stringify({ sources: ['../../src/test.ts'] })
        }
        return ''
      })

      mock_exists_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('.mjs.map')) return true
        if (file_path.endsWith('.ts')) return true
        return false
      })

      mock_esbuild_build.mockResolvedValue({
        outputFiles: [{ text: 'export const handler = async () => ({ statusCode: 200 })' }]
      })

      const options: ExecuteHandlerOptions = {
        region: 'us-east-1',
        function_arn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        event: mock_event,
        context: mock_context
      }

      // The function will fail on dynamic import, but we verify role assumption
      await expect(execute_module_handler(options)).rejects.toThrow()

      // Verify fromTemporaryCredentials was called with correct role
      expect(mock_from_temporary_credentials).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            RoleArn: mock_role_arn
          }),
          clientConfig: { region: 'us-east-1' }
        })
      )

      // Verify credential provider was called
      expect(mock_cred_provider).toHaveBeenCalled()
    })

    it('should assume role and call credential provider', async () => {
      const mock_role_arn = 'arn:aws:iam::123456789012:role/lambda-execution-role'
      const lambda_env_vars = {
        DATABASE_URL: 'postgres://localhost:5432/db',
        API_KEY: 'secret-api-key'
      }

      mock_lambda_send.mockResolvedValue({
        Role: mock_role_arn,
        Environment: { Variables: lambda_env_vars }
      })

      mock_read_file_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('outputs.json')) {
          return JSON.stringify(mock_outputs)
        }
        if (file_path.endsWith('.mjs.map')) {
          return JSON.stringify({ sources: ['../../src/test.ts'] })
        }
        return ''
      })

      mock_exists_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('.mjs.map')) return true
        if (file_path.endsWith('.ts')) return true
        return false
      })

      mock_esbuild_build.mockResolvedValue({
        outputFiles: [{ text: 'export const handler = async () => ({ statusCode: 200 })' }]
      })

      const options: ExecuteHandlerOptions = {
        region: 'us-east-1',
        function_arn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        event: mock_event,
        context: mock_context
      }

      // The function will fail on dynamic import, but we verify credential setup
      await expect(execute_module_handler(options)).rejects.toThrow()

      // Verify fromTemporaryCredentials was set up with the correct role
      expect(mock_from_temporary_credentials).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            RoleArn: mock_role_arn
          })
        })
      )

      // Verify credential provider was invoked
      expect(mock_cred_provider).toHaveBeenCalled()

      // Note: process.env credentials are restored in the finally block,
      // so we verify the credential provider was called rather than checking
      // env vars after the function returns
    })

    it('should throw descriptive error when Lambda config has no Role', async () => {
      mock_lambda_send.mockResolvedValue({
        // No Role property
        Environment: { Variables: {} }
      })

      mock_read_file_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('outputs.json')) {
          return JSON.stringify(mock_outputs)
        }
        if (file_path.endsWith('.mjs.map')) {
          return JSON.stringify({ sources: ['../../src/test.ts'] })
        }
        return ''
      })

      mock_exists_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('.mjs.map')) return true
        if (file_path.endsWith('.ts')) return true
        return false
      })

      const options: ExecuteHandlerOptions = {
        region: 'us-east-1',
        function_arn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        event: mock_event,
        context: mock_context
      }

      const error = await execute_module_handler(options).catch(e => e) as Error

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Lambda configuration did not include execution role ARN.')
    })

    it('should use esbuild with correct config for TypeScript files', async () => {
      mock_read_file_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('outputs.json')) {
          return JSON.stringify(mock_outputs)
        }
        if (file_path.endsWith('.mjs.map')) {
          return JSON.stringify({ sources: ['../../src/handlers/test.ts'] })
        }
        return ''
      })

      mock_exists_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('.mjs.map')) return true
        if (file_path.includes('test.ts')) return true
        return false
      })

      mock_esbuild_build.mockResolvedValue({
        outputFiles: [{ text: 'export const handler = async () => ({ statusCode: 200 })' }]
      })

      const options: ExecuteHandlerOptions = {
        region: 'us-east-1',
        function_arn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        event: mock_event,
        context: mock_context
      }

      // The function will fail on dynamic import, but we verify esbuild was called
      await expect(execute_module_handler(options)).rejects.toThrow()

      // Verify esbuild was called with correct options
      expect(mock_esbuild_build).toHaveBeenCalledWith(
        expect.objectContaining({
          bundle: true,
          format: 'esm',
          platform: 'node',
          target: 'node20',
          write: false,
          sourcemap: 'inline',
          external: ['@aws-sdk/*', 'aws-lambda']
        })
      )

      // Verify temp file was written
      expect(mock_write_file_sync).toHaveBeenCalled()
    })
  })

  describe('handler format parsing', () => {
    it('should correctly parse handler string with dots in file name', async () => {
      const outputs_with_dotted_handler = {
        TestStack: {
          FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
          FunctionHandler: 'src/handlers/api.handler',
          FunctionCdkOutAssetPath: '/path/to/cdk.out/asset.12345'
        }
      }

      mock_read_file_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('outputs.json')) {
          return JSON.stringify(outputs_with_dotted_handler)
        }
        return ''
      })

      mock_exists_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('.mjs.map')) return false
        if (file_path.endsWith('.js.map')) return false
        if (file_path.includes('src/handlers/api.mjs')) return true
        return false
      })

      const options: ExecuteHandlerOptions = {
        region: 'us-east-1',
        function_arn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        event: mock_event,
        context: mock_context
      }

      // The function will fail on dynamic import, but we verify path parsing
      await expect(execute_module_handler(options)).rejects.toThrow()

      // Verify the path includes the full handler file path
      expect(mock_exists_sync).toHaveBeenCalledWith(
        expect.stringContaining('src/handlers/api.mjs')
      )
    })
  })

  describe('error handling', () => {
    it('should include function ARN in error message when handler not found', async () => {
      mock_read_file_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('outputs.json')) {
          return JSON.stringify({
            OtherStack: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:other-function',
              FunctionHandler: 'index.handler',
              FunctionCdkOutAssetPath: '/path/to/cdk.out/asset.12345'
            }
          })
        }
        return ''
      })

      const options: ExecuteHandlerOptions = {
        region: 'us-east-1',
        function_arn: 'arn:aws:lambda:us-east-1:123456789012:function:missing-function',
        event: mock_event,
        context: mock_context
      }

      const error = await execute_module_handler(options).catch(e => e) as Error

      expect(error.message).toContain('missing-function')
      expect(error.message).toContain('Could not find handler info')
    })

    it('should suggest checking outputs.json in error message', async () => {
      mock_read_file_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('outputs.json')) {
          return JSON.stringify({})
        }
        return ''
      })

      const options: ExecuteHandlerOptions = {
        region: 'us-east-1',
        function_arn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        event: mock_event,
        context: mock_context
      }

      const error = await execute_module_handler(options).catch(e => e) as Error

      expect(error.message).toContain('outputs.json')
    })

    it('should handle outputs.json read errors gracefully', async () => {
      mock_read_file_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('outputs.json')) {
          throw new Error('ENOENT: no such file or directory')
        }
        return ''
      })

      const options: ExecuteHandlerOptions = {
        region: 'us-east-1',
        function_arn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        event: mock_event,
        context: mock_context
      }

      const error = await execute_module_handler(options).catch(e => e) as Error

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('ENOENT')
    })

    it('should handle invalid JSON in outputs.json', async () => {
      mock_read_file_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('outputs.json')) {
          return 'invalid json {'
        }
        return ''
      })

      const options: ExecuteHandlerOptions = {
        region: 'us-east-1',
        function_arn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        event: mock_event,
        context: mock_context
      }

      const error = await execute_module_handler(options).catch(e => e)

      expect(error).toBeInstanceOf(SyntaxError)
    })
  })

  describe('region handling', () => {
    it('should pass region to LambdaClient', async () => {
      mock_read_file_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('outputs.json')) {
          return JSON.stringify(mock_outputs)
        }
        return ''
      })

      mock_exists_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('.mjs.map')) return false
        if (file_path.endsWith('.js.map')) return false
        if (file_path.endsWith('.mjs')) return true
        return false
      })

      const options: ExecuteHandlerOptions = {
        region: 'eu-west-1',
        function_arn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        event: mock_event,
        context: mock_context
      }

      await expect(execute_module_handler(options)).rejects.toThrow()

      expect(mock_lambda_client_constructor).toHaveBeenCalledWith({ region: 'eu-west-1' })
    })

    it('should pass region to credential provider', async () => {
      mock_read_file_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('outputs.json')) {
          return JSON.stringify(mock_outputs)
        }
        if (file_path.endsWith('.mjs.map')) {
          return JSON.stringify({ sources: ['../../src/test.ts'] })
        }
        return ''
      })

      mock_exists_sync.mockImplementation((file_path: string) => {
        if (file_path.endsWith('.mjs.map')) return true
        if (file_path.endsWith('.ts')) return true
        return false
      })

      mock_esbuild_build.mockResolvedValue({
        outputFiles: [{ text: 'export const handler = async () => ({ statusCode: 200 })' }]
      })

      const options: ExecuteHandlerOptions = {
        region: 'ap-northeast-1',
        function_arn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        event: mock_event,
        context: mock_context
      }

      await expect(execute_module_handler(options)).rejects.toThrow()

      expect(mock_from_temporary_credentials).toHaveBeenCalledWith(
        expect.objectContaining({
          clientConfig: { region: 'ap-northeast-1' }
        })
      )
    })
  })
})
