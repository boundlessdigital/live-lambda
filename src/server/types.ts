export interface ServerConfig {
  region: string
  http: string
  realtime: string
  layer_arn: string
  profile?: string // Add profile
}

export interface ProxiedLambdaInvocation {
  request_id: string // The request_id for AppSync response channel

  event_payload: AWSLambda.APIGatewayProxyEventV2
  context: LambdaContext
}

export interface LambdaContext {
  aws_region: string
  deadline_ms: string
  function_name: string
  function_version: string
  invoked_function_arn: string
  log_group_name: string
  log_stream_name: string
  memory_size_mb: string
  request_id: string
  trace_id: string
  handler_path: string
  handler_name: string
}
