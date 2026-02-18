import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  LIVE_LAMBDA_ENV_VARS,
} from '../lib/constants.js'

const {
  mock_send,
  mock_logger
} = vi.hoisted(() => ({
  mock_send: vi.fn(),
  mock_logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    start: vi.fn()
  }
}))

vi.mock('@aws-sdk/client-lambda', () => {
  return {
    LambdaClient: vi.fn().mockImplementation(function () {
      return { send: mock_send }
    }),
    GetFunctionConfigurationCommand: vi.fn().mockImplementation(function (input: any) {
      return { _type: 'GetFunctionConfiguration', ...input }
    }),
    UpdateFunctionConfigurationCommand: vi.fn().mockImplementation(function (input: any) {
      return { _type: 'UpdateFunctionConfiguration', ...input }
    }),
    paginateListFunctions: vi.fn()
  }
})

vi.mock('../lib/logger.js', () => ({
  logger: mock_logger
}))

import { clean_lambda_functions, extract_region_from_arn } from './lambda_cleanup.js'
import { paginateListFunctions } from '@aws-sdk/client-lambda'

const mock_paginate = vi.mocked(paginateListFunctions)

describe('lambda_cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function setup_paginator(pages: any[][]) {
    mock_paginate.mockImplementation(function* () {
      for (const functions of pages) {
        yield Promise.resolve({ Functions: functions })
      }
    } as any)
  }

  function make_function(name: string, opts: { layer_arn?: string, env?: Record<string, string> } = {}) {
    return {
      FunctionName: name,
      Layers: opts.layer_arn ? [{ Arn: opts.layer_arn }] : [],
      Environment: { Variables: opts.env ?? {} }
    }
  }

  describe('clean_lambda_functions', () => {
    it('should scan all functions and identify affected ones by layer ARN', async () => {
      const layer_arn = 'arn:aws:lambda:us-east-1:123:layer:live-lambda-proxy:5'

      setup_paginator([[
        make_function('affected-fn', { layer_arn }),
        make_function('unrelated-fn', { layer_arn: 'arn:aws:lambda:us-east-1:123:layer:other:1' })
      ]])

      // GetFunctionConfiguration response for affected-fn
      mock_send.mockResolvedValueOnce({
        Layers: [{ Arn: layer_arn }],
        Environment: {
          Variables: {
            AWS_LAMBDA_EXEC_WRAPPER: '/opt/live-lambda-runtime-wrapper.sh',
            LRAP_LISTENER_PORT: '8082',
            MY_CUSTOM_VAR: 'keep-this'
          }
        }
      })
      // UpdateFunctionConfiguration response
      mock_send.mockResolvedValueOnce({})

      const result = await clean_lambda_functions('us-east-1', layer_arn)

      expect(result.functions_scanned).toBe(2)
      expect(result.functions_cleaned).toBe(1)
      expect(result.errors).toHaveLength(0)
    })

    it('should remove live-lambda layers from function configuration', async () => {
      const layer_arn = 'arn:aws:lambda:us-east-1:123:layer:live-lambda-proxy:5'

      setup_paginator([[
        make_function('fn', { layer_arn })
      ]])

      mock_send.mockResolvedValueOnce({
        Layers: [
          { Arn: layer_arn },
          { Arn: 'arn:aws:lambda:us-east-1:123:layer:other-layer:1' }
        ],
        Environment: {
          Variables: {
            AWS_LAMBDA_EXEC_WRAPPER: '/opt/live-lambda-runtime-wrapper.sh',
            MY_VAR: 'keep'
          }
        }
      })
      mock_send.mockResolvedValueOnce({})

      await clean_lambda_functions('us-east-1', layer_arn)

      // Verify the UpdateFunctionConfiguration was called with correct params
      const update_call = mock_send.mock.calls[1][0]
      expect(update_call.FunctionName).toBe('fn')
      expect(update_call.Layers).toEqual(['arn:aws:lambda:us-east-1:123:layer:other-layer:1'])
      expect(update_call.Environment.Variables).toEqual({ MY_VAR: 'keep' })
    })

    it('should remove all 6 live-lambda env vars', async () => {
      const layer_arn = 'arn:aws:lambda:us-east-1:123:layer:live-lambda-proxy:5'

      setup_paginator([[
        make_function('fn', { layer_arn })
      ]])

      const all_env_vars: Record<string, string> = {
        AWS_LAMBDA_EXEC_WRAPPER: '/opt/live-lambda-runtime-wrapper.sh',
        LRAP_LISTENER_PORT: '8082',
        AWS_LAMBDA_EXTENSION_NAME: 'live-lambda-extension',
        LIVE_LAMBDA_APPSYNC_REGION: 'us-east-1',
        LIVE_LAMBDA_APPSYNC_REALTIME_HOST: 'host.appsync.aws',
        LIVE_LAMBDA_APPSYNC_HTTP_HOST: 'http.appsync.aws',
        MY_APP_VAR: 'keep-this',
        DB_CONNECTION: 'also-keep'
      }

      mock_send.mockResolvedValueOnce({
        Layers: [{ Arn: layer_arn }],
        Environment: { Variables: all_env_vars }
      })
      mock_send.mockResolvedValueOnce({})

      await clean_lambda_functions('us-east-1', layer_arn)

      const update_call = mock_send.mock.calls[1][0]
      const remaining_vars = update_call.Environment.Variables

      // All live-lambda vars should be removed
      for (const key of LIVE_LAMBDA_ENV_VARS) {
        expect(remaining_vars).not.toHaveProperty(key)
      }
      // Custom vars should remain
      expect(remaining_vars.MY_APP_VAR).toBe('keep-this')
      expect(remaining_vars.DB_CONNECTION).toBe('also-keep')
    })

    it('should match layer ARN prefix regardless of version', async () => {
      const layer_arn = 'arn:aws:lambda:us-east-1:123:layer:live-lambda-proxy:10'

      setup_paginator([[
        // Function has version 5, but we're looking for prefix match
        make_function('fn', { layer_arn: 'arn:aws:lambda:us-east-1:123:layer:live-lambda-proxy:5' })
      ]])

      mock_send.mockResolvedValueOnce({
        Layers: [{ Arn: 'arn:aws:lambda:us-east-1:123:layer:live-lambda-proxy:5' }],
        Environment: { Variables: {} }
      })
      mock_send.mockResolvedValueOnce({})

      const result = await clean_lambda_functions('us-east-1', layer_arn)

      expect(result.functions_cleaned).toBe(1)
    })

    it('should handle ResourceConflictException gracefully', async () => {
      const layer_arn = 'arn:aws:lambda:us-east-1:123:layer:live-lambda-proxy:5'

      setup_paginator([[
        make_function('fn', { layer_arn })
      ]])

      mock_send.mockResolvedValueOnce({
        Layers: [{ Arn: layer_arn }],
        Environment: { Variables: {} }
      })
      const conflict_error = new Error('Function is being updated')
      ;(conflict_error as any).name = 'ResourceConflictException'
      mock_send.mockRejectedValueOnce(conflict_error)

      const result = await clean_lambda_functions('us-east-1', layer_arn)

      expect(result.functions_cleaned).toBe(0)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('currently being updated')
      expect(mock_logger.warn).toHaveBeenCalled()
    })

    it('should handle other errors and continue', async () => {
      const layer_arn = 'arn:aws:lambda:us-east-1:123:layer:live-lambda-proxy:5'

      setup_paginator([[
        make_function('fn1', { layer_arn }),
        make_function('fn2', { layer_arn })
      ]])

      // fn1: GetFunctionConfiguration fails
      mock_send.mockRejectedValueOnce(new Error('Access Denied'))
      // fn2: succeeds
      mock_send.mockResolvedValueOnce({
        Layers: [{ Arn: layer_arn }],
        Environment: { Variables: {} }
      })
      mock_send.mockResolvedValueOnce({})

      const result = await clean_lambda_functions('us-east-1', layer_arn)

      expect(result.functions_cleaned).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('Failed to clean fn1')
    })

    it('should handle multiple pages of functions', async () => {
      const layer_arn = 'arn:aws:lambda:us-east-1:123:layer:live-lambda-proxy:5'

      setup_paginator([
        [make_function('fn1', { layer_arn })],
        [make_function('fn2', { layer_arn })]
      ])

      // fn1
      mock_send.mockResolvedValueOnce({
        Layers: [{ Arn: layer_arn }],
        Environment: { Variables: {} }
      })
      mock_send.mockResolvedValueOnce({})
      // fn2
      mock_send.mockResolvedValueOnce({
        Layers: [{ Arn: layer_arn }],
        Environment: { Variables: {} }
      })
      mock_send.mockResolvedValueOnce({})

      const result = await clean_lambda_functions('us-east-1', layer_arn)

      expect(result.functions_scanned).toBe(2)
      expect(result.functions_cleaned).toBe(2)
    })

    it('should return zero counts when no functions found', async () => {
      setup_paginator([[]])

      const result = await clean_lambda_functions('us-east-1', 'arn:aws:lambda:us-east-1:123:layer:test:1')

      expect(result.functions_scanned).toBe(0)
      expect(result.functions_cleaned).toBe(0)
      expect(result.errors).toHaveLength(0)
    })

    it('should skip functions without the layer or env var marker', async () => {
      const layer_arn = 'arn:aws:lambda:us-east-1:123:layer:live-lambda-proxy:5'

      setup_paginator([[
        make_function('unrelated', { layer_arn: 'arn:aws:lambda:us-east-1:123:layer:other:1' })
      ]])

      const result = await clean_lambda_functions('us-east-1', layer_arn)

      expect(result.functions_scanned).toBe(1)
      expect(result.functions_cleaned).toBe(0)
      expect(mock_send).not.toHaveBeenCalled()
    })
  })

  describe('extract_region_from_arn', () => {
    it('should extract region from a valid layer ARN', () => {
      expect(extract_region_from_arn('arn:aws:lambda:us-east-1:123456:layer:name:1')).toBe('us-east-1')
    })

    it('should extract region from different regions', () => {
      expect(extract_region_from_arn('arn:aws:lambda:eu-west-1:123456:layer:name:1')).toBe('eu-west-1')
      expect(extract_region_from_arn('arn:aws:lambda:ap-southeast-2:123456:layer:name:1')).toBe('ap-southeast-2')
    })

    it('should throw for invalid ARN format', () => {
      expect(() => extract_region_from_arn('not-an-arn')).toThrow('Invalid ARN format')
    })

    it('should throw for ARN with too few parts', () => {
      expect(() => extract_region_from_arn('arn:aws:lambda')).toThrow('Invalid ARN format')
    })
  })
})
