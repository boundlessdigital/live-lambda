/**
 * Shared constants for live-lambda project
 * Used by both source code and tests to ensure consistency
 */

// Layer configuration
export const LAYER_VERSION_NAME = 'live-lambda-proxy'
export const LAYER_ARN_SSM_PARAMETER = '/live-lambda/layer/arn'
export const LAYER_LOGICAL_ID = 'LiveLambdaProxyLayer'
export const LAYER_DESCRIPTION =
  'Conditionally forwards Lambda invocations to AppSync for live development.'

// Stack names
export const APPSYNC_STACK_NAME = 'AppSyncStack'
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

// All live-lambda env var keys for cleanup operations
export const LIVE_LAMBDA_ENV_VARS = [
  ENV_KEY_LAMBDA_EXEC_WRAPPER,
  ENV_KEY_LRAP_LISTENER_PORT,
  ENV_KEY_EXTENSION_NAME,
  ENV_KEY_APPSYNC_REGION,
  ENV_KEY_APPSYNC_REALTIME_HOST,
  ENV_KEY_APPSYNC_HTTP_HOST,
] as const

// Environment variable values set by the aspect
export const ENV_LAMBDA_EXEC_WRAPPER = '/opt/live-lambda-runtime-wrapper.sh'
export const ENV_LRAP_LISTENER_PORT = '8082'
export const ENV_EXTENSION_NAME = 'live-lambda-extension'

// Internal stack names (used by bootstrap/uninstall to target live-lambda infra)
export const INTERNAL_STACK_NAMES = [APPSYNC_STACK_NAME, LAYER_STACK_NAME] as const
