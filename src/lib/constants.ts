/**
 * Shared constants for live-lambda project
 * Used by both source code and tests to ensure consistency
 */

// ============================================================================
// Name Formatting Utilities
// ============================================================================

const MAX_STACK_NAME_LENGTH = 128
const MAX_SEGMENT_LENGTH = 64

/**
 * Format app_name for use in stack names and SSM paths.
 * - Lowercase
 * - Trim whitespace
 * - Compress inner whitespace and replace with dashes
 * - Remove invalid characters (only allow alphanumeric and dashes)
 */
export function format_app_name(app_name: string): string {
  return app_name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-') // compress whitespace to single dash
    .replace(/[^a-z0-9-]/g, '') // remove invalid characters
    .replace(/-+/g, '-') // compress multiple dashes
    .replace(/^-|-$/g, '') // trim leading/trailing dashes
    .slice(0, MAX_SEGMENT_LENGTH)
}

/**
 * Format stage for use in stack names and SSM paths.
 * - Lowercase
 * - Trim whitespace
 * - Remove invalid characters (only allow alphanumeric and dashes)
 */
export function format_stage(stage: string): string {
  return stage
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-') // compress whitespace to single dash
    .replace(/[^a-z0-9-]/g, '') // remove invalid characters
    .replace(/-+/g, '-') // compress multiple dashes
    .replace(/^-|-$/g, '') // trim leading/trailing dashes
    .slice(0, MAX_SEGMENT_LENGTH)
}

/**
 * Get the stack name prefix for all stacks.
 * Pattern: {app_name}-{stage}-
 */
export function get_stack_prefix(app_name: string, stage: string): string {
  const formatted_app = format_app_name(app_name)
  const formatted_stage = format_stage(stage)
  return `${formatted_app}-${formatted_stage}-`
}

// ============================================================================
// Layer configuration
// ============================================================================

export const LAYER_VERSION_NAME = 'live-lambda-proxy'
export const LAYER_LOGICAL_ID = 'LiveLambdaProxyLayer'
export const LAYER_DESCRIPTION =
  'Conditionally forwards Lambda invocations to AppSync for live development.'

// ============================================================================
// SSM Parameters for bootstrap discovery
// ============================================================================

export const SSM_PARAM_ROOT = '/live-lambda'

/**
 * Get the default SSM parameter prefix.
 * Pattern: /live-lambda/{app_name}/{stage}
 */
export function get_default_ssm_prefix(app_name: string, stage: string): string {
  const formatted_app = format_app_name(app_name)
  const formatted_stage = format_stage(stage)
  return `${SSM_PARAM_ROOT}/${formatted_app}/${formatted_stage}`
}

/**
 * Get layer ARN SSM parameter path.
 */
export function get_layer_arn_ssm_parameter(ssm_prefix: string): string {
  return `${ssm_prefix}/layer/arn`
}

/**
 * Get AppSync API ARN SSM parameter path.
 */
export function get_ssm_param_appsync_api_arn(ssm_prefix: string): string {
  return `${ssm_prefix}/appsync/api-arn`
}

/**
 * Get AppSync HTTP host SSM parameter path.
 */
export function get_ssm_param_appsync_http_host(ssm_prefix: string): string {
  return `${ssm_prefix}/appsync/http-host`
}

/**
 * Get AppSync realtime host SSM parameter path.
 */
export function get_ssm_param_appsync_realtime_host(ssm_prefix: string): string {
  return `${ssm_prefix}/appsync/realtime-host`
}

/**
 * Get AppSync region SSM parameter path.
 */
export function get_ssm_param_appsync_region(ssm_prefix: string): string {
  return `${ssm_prefix}/appsync/region`
}

/**
 * Get bootstrap version SSM parameter path.
 */
export function get_ssm_param_bootstrap_version(ssm_prefix: string): string {
  return `${ssm_prefix}/bootstrap/version`
}

// ============================================================================
// Stack names
// ============================================================================

/**
 * Get AppSync stack name.
 * Pattern: {app_name}-{stage}-LiveLambdaAppSyncStack
 */
export function get_appsync_stack_name(app_name: string, stage: string): string {
  const prefix = get_stack_prefix(app_name, stage)
  const base = `${prefix}LiveLambdaAppSyncStack`
  return base.slice(0, MAX_STACK_NAME_LENGTH)
}

/**
 * Get Layer stack name.
 * Pattern: {app_name}-{stage}-LiveLambdaLayerStack
 */
export function get_layer_stack_name(app_name: string, stage: string): string {
  const prefix = get_stack_prefix(app_name, stage)
  const base = `${prefix}LiveLambdaLayerStack`
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
