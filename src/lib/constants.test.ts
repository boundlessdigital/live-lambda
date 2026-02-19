import { describe, it, expect } from 'vitest'
import {
  CONTEXT_APP_NAME,
  CONTEXT_ENVIRONMENT,
  CONTEXT_APP_ID,
  LAYER_VERSION_NAME,
  LAYER_ARN_SSM_PARAMETER_BASE,
  LAYER_LOGICAL_ID,
  LAYER_DESCRIPTION,
  APPSYNC_STACK_NAME,
  LAYER_STACK_NAME,
  OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN,
  OUTPUT_EVENT_API_HTTP_HOST,
  OUTPUT_EVENT_API_REALTIME_HOST,
  ENV_KEY_LAMBDA_EXEC_WRAPPER,
  ENV_KEY_LRAP_LISTENER_PORT,
  ENV_KEY_EXTENSION_NAME,
  ENV_KEY_APPSYNC_REGION,
  ENV_KEY_APPSYNC_REALTIME_HOST,
  ENV_KEY_APPSYNC_HTTP_HOST,
  LIVE_LAMBDA_ENV_VARS,
  ENV_LAMBDA_EXEC_WRAPPER,
  ENV_LRAP_LISTENER_PORT,
  ENV_EXTENSION_NAME,
  INTERNAL_STACK_BASE_NAMES,
  compute_prefix,
  prefixed_stack_names,
  layer_arn_ssm_path,
  layer_version_name,
  appsync_ssm_paths,
} from './constants.js'

describe('exported constants', () => {
  describe('CDK context keys', () => {
    it('should have correct context key values', () => {
      expect(CONTEXT_APP_NAME).toBe('app_name')
      expect(CONTEXT_ENVIRONMENT).toBe('environment')
      expect(CONTEXT_APP_ID).toBe('app_id')
    })
  })

  describe('layer configuration', () => {
    it('should have correct layer version name base', () => {
      expect(LAYER_VERSION_NAME).toBe('live-lambda-proxy')
    })

    it('should have correct SSM parameter base path', () => {
      expect(LAYER_ARN_SSM_PARAMETER_BASE).toBe('/live-lambda')
    })

    it('should have correct layer logical ID', () => {
      expect(LAYER_LOGICAL_ID).toBe('LiveLambdaProxyLayer')
    })

    it('should have a non-empty layer description', () => {
      expect(LAYER_DESCRIPTION).toBe(
        'Conditionally forwards Lambda invocations to AppSync for live development.'
      )
    })
  })

  describe('stack names', () => {
    it('should have correct appsync stack name', () => {
      expect(APPSYNC_STACK_NAME).toBe('LiveLambda-AppSyncStack')
    })

    it('should have correct layer stack name', () => {
      expect(LAYER_STACK_NAME).toBe('LiveLambda-LayerStack')
    })
  })

  describe('output keys', () => {
    it('should have correct output key values', () => {
      expect(OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN).toBe('LiveLambdaProxyLayerArn')
      expect(OUTPUT_EVENT_API_HTTP_HOST).toBe('LiveLambdaEventApiHttpHost')
      expect(OUTPUT_EVENT_API_REALTIME_HOST).toBe('LiveLambdaEventApiRealtimeHost')
    })
  })

  describe('environment variable keys', () => {
    it('should have correct env var key values', () => {
      expect(ENV_KEY_LAMBDA_EXEC_WRAPPER).toBe('AWS_LAMBDA_EXEC_WRAPPER')
      expect(ENV_KEY_LRAP_LISTENER_PORT).toBe('LRAP_LISTENER_PORT')
      expect(ENV_KEY_EXTENSION_NAME).toBe('AWS_LAMBDA_EXTENSION_NAME')
      expect(ENV_KEY_APPSYNC_REGION).toBe('LIVE_LAMBDA_APPSYNC_REGION')
      expect(ENV_KEY_APPSYNC_REALTIME_HOST).toBe('LIVE_LAMBDA_APPSYNC_REALTIME_HOST')
      expect(ENV_KEY_APPSYNC_HTTP_HOST).toBe('LIVE_LAMBDA_APPSYNC_HTTP_HOST')
    })
  })

  describe('environment variable values', () => {
    it('should have correct env var values', () => {
      expect(ENV_LAMBDA_EXEC_WRAPPER).toBe('/opt/live-lambda-runtime-wrapper.sh')
      expect(ENV_LRAP_LISTENER_PORT).toBe('8082')
      expect(ENV_EXTENSION_NAME).toBe('live-lambda-extension')
    })
  })

  describe('LIVE_LAMBDA_ENV_VARS', () => {
    it('should contain all six env var keys', () => {
      expect(LIVE_LAMBDA_ENV_VARS).toHaveLength(6)
      expect(LIVE_LAMBDA_ENV_VARS).toContain(ENV_KEY_LAMBDA_EXEC_WRAPPER)
      expect(LIVE_LAMBDA_ENV_VARS).toContain(ENV_KEY_LRAP_LISTENER_PORT)
      expect(LIVE_LAMBDA_ENV_VARS).toContain(ENV_KEY_EXTENSION_NAME)
      expect(LIVE_LAMBDA_ENV_VARS).toContain(ENV_KEY_APPSYNC_REGION)
      expect(LIVE_LAMBDA_ENV_VARS).toContain(ENV_KEY_APPSYNC_REALTIME_HOST)
      expect(LIVE_LAMBDA_ENV_VARS).toContain(ENV_KEY_APPSYNC_HTTP_HOST)
    })
  })

  describe('INTERNAL_STACK_BASE_NAMES', () => {
    it('should contain both internal stack names', () => {
      expect(INTERNAL_STACK_BASE_NAMES).toEqual([APPSYNC_STACK_NAME, LAYER_STACK_NAME])
    })

    it('should have exactly two entries', () => {
      expect(INTERNAL_STACK_BASE_NAMES).toHaveLength(2)
    })
  })
})

describe('compute_prefix', () => {
  it('should join app_name and environment with a dash', () => {
    expect(compute_prefix('myapp', 'dev')).toBe('myapp-dev')
  })

  it('should include app_id when provided', () => {
    expect(compute_prefix('myapp', 'staging', 'abc123')).toBe('myapp-staging-abc123')
  })

  it('should omit app_id when undefined', () => {
    expect(compute_prefix('myapp', 'production', undefined)).toBe('myapp-production')
  })

  it('should handle single-word values', () => {
    expect(compute_prefix('app', 'prod')).toBe('app-prod')
  })

  it('should handle values that already contain dashes', () => {
    expect(compute_prefix('my-app', 'us-east-1')).toBe('my-app-us-east-1')
  })

  it('should handle empty string app_id by filtering it out', () => {
    // empty string is falsy, so filter(Boolean) removes it
    expect(compute_prefix('myapp', 'dev', '')).toBe('myapp-dev')
  })
})

describe('prefixed_stack_names', () => {
  const prefix = 'myapp-dev'

  it('should return appsync stack name with dash separator', () => {
    const result = prefixed_stack_names(prefix)
    expect(result.appsync).toBe('myapp-dev-LiveLambda-AppSyncStack')
  })

  it('should return layer stack name with dash separator', () => {
    const result = prefixed_stack_names(prefix)
    expect(result.layer).toBe('myapp-dev-LiveLambda-LayerStack')
  })

  it('should return all stack names as dash-separated array', () => {
    const result = prefixed_stack_names(prefix)
    expect(result.all).toEqual([
      'myapp-dev-LiveLambda-AppSyncStack',
      'myapp-dev-LiveLambda-LayerStack',
    ])
  })

  it('should return patterns with slash separator for CDK assembly matching', () => {
    const result = prefixed_stack_names(prefix)
    expect(result.patterns).toEqual([
      'myapp-dev/LiveLambda-AppSyncStack',
      'myapp-dev/LiveLambda-LayerStack',
    ])
  })

  it('should work with a prefix containing multiple dashes', () => {
    const result = prefixed_stack_names('my-app-us-east-1-staging')
    expect(result.appsync).toBe('my-app-us-east-1-staging-LiveLambda-AppSyncStack')
    expect(result.layer).toBe('my-app-us-east-1-staging-LiveLambda-LayerStack')
  })

  it('should have all and patterns arrays with the same length as INTERNAL_STACK_BASE_NAMES', () => {
    const result = prefixed_stack_names(prefix)
    expect(result.all).toHaveLength(INTERNAL_STACK_BASE_NAMES.length)
    expect(result.patterns).toHaveLength(INTERNAL_STACK_BASE_NAMES.length)
  })
})

describe('layer_arn_ssm_path', () => {
  it('should return the correct SSM path for a given prefix', () => {
    expect(layer_arn_ssm_path('myapp-dev')).toBe('/live-lambda/myapp-dev/layer/arn')
  })

  it('should incorporate the LAYER_ARN_SSM_PARAMETER_BASE constant', () => {
    const result = layer_arn_ssm_path('test')
    expect(result).toMatch(new RegExp(`^${LAYER_ARN_SSM_PARAMETER_BASE}/`))
  })

  it('should handle prefixes with dashes', () => {
    expect(layer_arn_ssm_path('my-app-us-east-1')).toBe('/live-lambda/my-app-us-east-1/layer/arn')
  })
})

describe('layer_version_name', () => {
  it('should return prefix followed by layer version name', () => {
    expect(layer_version_name('myapp-dev')).toBe('myapp-dev-live-lambda-proxy')
  })

  it('should incorporate the LAYER_VERSION_NAME constant', () => {
    const result = layer_version_name('test')
    expect(result).toBe(`test-${LAYER_VERSION_NAME}`)
  })

  it('should handle prefixes with dashes', () => {
    expect(layer_version_name('bng-platform-staging-abc')).toBe('bng-platform-staging-abc-live-lambda-proxy')
  })
})

describe('appsync_ssm_paths', () => {
  it('should return api_arn path', () => {
    const result = appsync_ssm_paths('myapp-dev')
    expect(result.api_arn).toBe('/live-lambda/myapp-dev/appsync/api-arn')
  })

  it('should return http_dns path', () => {
    const result = appsync_ssm_paths('myapp-dev')
    expect(result.http_dns).toBe('/live-lambda/myapp-dev/appsync/http-dns')
  })

  it('should return realtime_dns path', () => {
    const result = appsync_ssm_paths('myapp-dev')
    expect(result.realtime_dns).toBe('/live-lambda/myapp-dev/appsync/realtime-dns')
  })

  it('should share the same base path for all three values', () => {
    const result = appsync_ssm_paths('myapp-prod')
    const base = '/live-lambda/myapp-prod/appsync'
    expect(result.api_arn).toMatch(new RegExp(`^${base}/`))
    expect(result.http_dns).toMatch(new RegExp(`^${base}/`))
    expect(result.realtime_dns).toMatch(new RegExp(`^${base}/`))
  })

  it('should use LAYER_ARN_SSM_PARAMETER_BASE as root', () => {
    const result = appsync_ssm_paths('test')
    expect(result.api_arn.startsWith(LAYER_ARN_SSM_PARAMETER_BASE)).toBe(true)
    expect(result.http_dns.startsWith(LAYER_ARN_SSM_PARAMETER_BASE)).toBe(true)
    expect(result.realtime_dns.startsWith(LAYER_ARN_SSM_PARAMETER_BASE)).toBe(true)
  })

  it('should handle complex prefixes', () => {
    const result = appsync_ssm_paths('bng-platform-development-12345')
    expect(result.api_arn).toBe('/live-lambda/bng-platform-development-12345/appsync/api-arn')
    expect(result.http_dns).toBe('/live-lambda/bng-platform-development-12345/appsync/http-dns')
    expect(result.realtime_dns).toBe('/live-lambda/bng-platform-development-12345/appsync/realtime-dns')
  })
})
