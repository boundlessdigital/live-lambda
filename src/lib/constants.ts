/**
 * Shared constants for live-lambda project
 * Used by both source code and tests to ensure consistency
 */

// ============================================================================
// App Name Formatting Utilities
// ============================================================================

const MAX_STACK_NAME_LENGTH = 128
const MAX_NAMESPACE_LENGTH = 64

/**
 * Format app_name for use in SSM parameter paths.
 * - Lowercase
 * - Trim whitespace
 * - Compress inner whitespace and replace with dashes
 * - Remove invalid characters (only allow alphanumeric and dashes)
 */
export function format_app_name_for_ssm(app_name: string): string {
  return app_name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-') // compress whitespace to single dash
    .replace(/[^a-z0-9-]/g, '') // remove invalid characters
    .replace(/-+/g, '-') // compress multiple dashes
    .replace(/^-|-$/g, '') // trim leading/trailing dashes
    .slice(0, MAX_NAMESPACE_LENGTH)
}

/**
 * Format app_name for use in CloudFormation stack names.
 * - CamelCase
 * - Remove invalid characters
 * - Truncate to fit within stack name limits
 */
export function format_app_name_for_stack(app_name: string): string {
  const words = app_name
    .trim()
    .replace(/[^a-zA-Z0-9\s-_]/g, '') // remove invalid characters
    .split(/[\s-_]+/) // split on whitespace, dashes, underscores
    .filter((word) => word.length > 0)

  const camel_case = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('')

  return camel_case.slice(0, MAX_NAMESPACE_LENGTH)
}

// ============================================================================
// Layer configuration
// ============================================================================

export const LAYER_VERSION_NAME = 'live-lambda-proxy'
export const LAYER_LOGICAL_ID = 'LiveLambdaProxyLayer'
export const LAYER_DESCRIPTION =
  'Conditionally forwards Lambda invocations to AppSync for live development.'

// ============================================================================
// SSM Parameters for bootstrap discovery (namespace-aware)
// ============================================================================

export const SSM_PARAM_ROOT = '/live-lambda'

export function get_ssm_param_prefix(namespace: string): string {
  return `${SSM_PARAM_ROOT}/${namespace}`
}

export function get_layer_arn_ssm_parameter(namespace: string): string {
  return `${get_ssm_param_prefix(namespace)}/layer/arn`
}

export function get_ssm_param_appsync_api_arn(namespace: string): string {
  return `${get_ssm_param_prefix(namespace)}/appsync/api-arn`
}

export function get_ssm_param_appsync_http_host(namespace: string): string {
  return `${get_ssm_param_prefix(namespace)}/appsync/http-host`
}

export function get_ssm_param_appsync_realtime_host(namespace: string): string {
  return `${get_ssm_param_prefix(namespace)}/appsync/realtime-host`
}

export function get_ssm_param_appsync_region(namespace: string): string {
  return `${get_ssm_param_prefix(namespace)}/appsync/region`
}

export function get_ssm_param_bootstrap_version(namespace: string): string {
  return `${get_ssm_param_prefix(namespace)}/bootstrap/version`
}

// ============================================================================
// Stack names (namespace-aware)
// ============================================================================

export function get_appsync_stack_name(namespace: string): string {
  const base = `${namespace}-LiveLambdaAppSyncStack`
  return base.slice(0, MAX_STACK_NAME_LENGTH)
}

export function get_layer_stack_name(namespace: string): string {
  const base = `${namespace}-LiveLambdaLayerStack`
  return base.slice(0, MAX_STACK_NAME_LENGTH)
}

// Current bootstrap version - increment when breaking changes are made
export const BOOTSTRAP_VERSION = '1'

// ============================================================================
// Output keys
// ============================================================================

export const OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN = 'LiveLambdaProxyLayerArn'
export const OUTPUT_EVENT_API_HTTP_HOST = 'LiveLambdaEventApiHttpHost'
export const OUTPUT_EVENT_API_REALTIME_HOST = 'LiveLambdaEventApiRealtimeHost'

// ============================================================================
// Environment variables set by the aspect
// ============================================================================

export const ENV_LAMBDA_EXEC_WRAPPER = '/opt/live-lambda-runtime-wrapper.sh'
export const ENV_LRAP_LISTENER_PORT = '8082'
export const ENV_EXTENSION_NAME = 'live-lambda-extension'
