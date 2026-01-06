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

// Environment variables set by the aspect
export const ENV_LAMBDA_EXEC_WRAPPER = '/opt/live-lambda-runtime-wrapper.sh'
export const ENV_LRAP_LISTENER_PORT = '8082'
export const ENV_EXTENSION_NAME = 'live-lambda-extension'
