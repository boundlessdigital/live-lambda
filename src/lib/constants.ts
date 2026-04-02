/**
 * Shared constants for live-lambda project
 * Used by both source code and tests to ensure consistency
 */

// CDK context keys
export const CONTEXT_APP_NAME = 'app_name'
export const CONTEXT_ENVIRONMENT = 'environment'
export const CONTEXT_APP_ID = 'app_id'

// Layer configuration (base names — prefixed at runtime)
export const LAYER_VERSION_NAME = 'live-lambda-proxy'
export const LAYER_ARN_SSM_PARAMETER_BASE = '/live-lambda'
export const LAYER_LOGICAL_ID = 'LiveLambdaProxyLayer'
export const LAYER_DESCRIPTION =
  'Conditionally forwards Lambda invocations to AppSync for live development.'

// Stack names
export const APPSYNC_STACK_NAME = 'LiveLambda-AppSyncStack'
export const LAYER_STACK_NAME = 'LiveLambda-LayerStack'

// Output keys
export const OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN = 'LiveLambdaProxyLayerArn'
export const OUTPUT_EVENT_API_HTTP_HOST = 'LiveLambdaEventApiHttpHost'
export const OUTPUT_EVENT_API_REALTIME_HOST = 'LiveLambdaEventApiRealtimeHost'

// Environment variable keys set by the LiveLambdaLayerAspect
export const ENV_KEY_LAMBDA_EXEC_WRAPPER = 'AWS_LAMBDA_EXEC_WRAPPER'
export const ENV_KEY_LRAP_LISTENER_PORT = 'LRAP_LISTENER_PORT'
export const ENV_KEY_EXTENSION_NAME = 'AWS_LAMBDA_EXTENSION_NAME'
export const ENV_KEY_APPSYNC_REGION = 'LIVE_LAMBDA_APPSYNC_REGION'
export const ENV_KEY_APPSYNC_REALTIME_HOST = 'LIVE_LAMBDA_APPSYNC_REALTIME_HOST'
export const ENV_KEY_APPSYNC_HTTP_HOST = 'LIVE_LAMBDA_APPSYNC_HTTP_HOST'
export const ENV_KEY_LIVE_LAMBDA_ENABLED = 'LIVE_LAMBDA_ENABLED'
export const ENV_KEY_LIVE_LAMBDA_LAYER_HASH = 'LIVE_LAMBDA_LAYER_HASH'

export const ENV_LIVE_LAMBDA_ENABLED_DEFAULT = 'false'

// All live-lambda env var keys for cleanup operations
export const LIVE_LAMBDA_ENV_VARS = [
  ENV_KEY_LAMBDA_EXEC_WRAPPER,
  ENV_KEY_LRAP_LISTENER_PORT,
  ENV_KEY_EXTENSION_NAME,
  ENV_KEY_APPSYNC_REGION,
  ENV_KEY_APPSYNC_REALTIME_HOST,
  ENV_KEY_APPSYNC_HTTP_HOST,
  ENV_KEY_LIVE_LAMBDA_ENABLED,
  ENV_KEY_LIVE_LAMBDA_LAYER_HASH,
] as const

// Environment variable values set by the aspect
export const ENV_LAMBDA_EXEC_WRAPPER = '/opt/live-lambda-runtime-wrapper.sh'
export const ENV_LRAP_LISTENER_PORT = '8082'
export const ENV_EXTENSION_NAME = 'live-lambda-extension'

// Internal stack base names (used by bootstrap/uninstall to target live-lambda infra)
// At runtime, these are prefixed with the computed prefix: {prefix}-AppSyncStack, etc.
export const INTERNAL_STACK_BASE_NAMES = [APPSYNC_STACK_NAME, LAYER_STACK_NAME] as const

/**
 * Compute the deployment prefix from app_name, environment, and optional app_id.
 * Used by both CDK (live_lambda.ts) and CLI (main.ts) to ensure consistent naming.
 */
export function compute_prefix(app_name: string, environment: string, app_id?: string): string {
  return [app_name, environment, app_id].filter(Boolean).join('-')
}

/**
 * Build prefixed internal stack names for a given prefix.
 *
 * CloudFormation names use `-` (e.g., `prefix-AppSyncStack`) for
 * deployment results, outputs.json keys, and `cdk.list()` names.
 *
 * Assembly patterns use `/` (e.g., `prefix/AppSyncStack`) for
 * CDK Toolkit's PATTERN_MATCH strategy which matches against `hierarchicalId`.
 */
export interface RegionalStackNames {
  appsync: string
  layer: string
}

export function prefixed_stack_names(prefix: string, additional_regions?: string[]) {
  const regional = new Map<string, RegionalStackNames>()

  for (const region of additional_regions ?? []) {
    const region_short = region.replace(/-/g, '')
    regional.set(region, {
      appsync: `${prefix}-${APPSYNC_STACK_NAME}-${region_short}`,
      layer: `${prefix}-${LAYER_STACK_NAME}-${region_short}`,
    })
  }

  const regional_all = [...regional.values()].flatMap(r => [r.appsync, r.layer])
  const regional_patterns = [...regional.values()].flatMap(r => [
    r.appsync.replace(`${prefix}-`, `${prefix}/`),
    r.layer.replace(`${prefix}-`, `${prefix}/`),
  ])

  return {
    appsync: `${prefix}-${APPSYNC_STACK_NAME}`,
    layer: `${prefix}-${LAYER_STACK_NAME}`,
    all: [
      ...INTERNAL_STACK_BASE_NAMES.map(name => `${prefix}-${name}`),
      ...regional_all,
    ],
    patterns: [
      ...INTERNAL_STACK_BASE_NAMES.map(name => `${prefix}/${name}`),
      ...regional_patterns,
    ],
    regional,
  }
}

/**
 * Build the namespaced SSM parameter path for the layer ARN.
 */
export function layer_arn_ssm_path(prefix: string): string {
  return `${LAYER_ARN_SSM_PARAMETER_BASE}/${prefix}/layer/arn`
}

/**
 * Build the namespaced layer version name.
 */
export function layer_version_name(prefix: string): string {
  return `${prefix}-${LAYER_VERSION_NAME}`
}

/**
 * Build the namespaced SSM parameter paths for AppSync values.
 * These are stored in SSM to avoid cross-stack CloudFormation exports,
 * which would prevent the AppSync stack from being destroyed independently.
 */
export function appsync_ssm_paths(prefix: string) {
  const base = `${LAYER_ARN_SSM_PARAMETER_BASE}/${prefix}/appsync`
  return {
    api_arn: `${base}/api-arn`,
    http_dns: `${base}/http-dns`,
    realtime_dns: `${base}/realtime-dns`,
  }
}
